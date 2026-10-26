// The Apply Desk helper. Leave it running on your PC: it picks up the applications you sent from the
// page, fills them in a Chrome window it controls, submits them, and reports back.
//
//   npm start          run the helper (it restarts itself, between applications, when its code is updated)
//   npm run login      open the helper's browser so you can sign in to job sites, then close it
//
// When an application needs you (an emailed code, a CAPTCHA, a missing answer), its tab stays open and
// the helper keeps going with the rest of the queue, checking back on the waiting tabs as it goes.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig, makeApi, ROOT } from './config.js';
import { dailyDue, makeSweeper } from './sweep.js';
import { boxesForYou, companyLimit, enterCode, limitTexts, needsCode, settle, sleep, tickBoxes, uncheckSmsOptIns } from './fillers/common.js';
import * as amazon from './fillers/amazon.js';
import * as ashby from './fillers/ashby.js';
import * as greenhouse from './fillers/greenhouse.js';
import * as lever from './fillers/lever.js';
import * as microsoft from './fillers/microsoft.js';

const VERSION = '0.10.0';
const FILLERS = { greenhouse, lever, ashby, amazon, microsoft };
const signedOut = (err) => err instanceof amazon.SignedOutError || err instanceof microsoft.SignedOutError;
// Reading an Amazon or Microsoft job's questions opens its application, so it's paced and only done while idle.
const PREPARE_EVERY_MS = 90_000;
const POLL_MS = 15_000;
const WAIT_FOR_YOU_MS = 30 * 60_000;
const MAX_WAITING = 5;
const CODE_NOTE = 'The site emailed you a verification code. Enter it on the page (Sent tab) or in the helper window.';
// Settings → "Send automatically": while idle, ask the site for an application with nothing new to answer.
const AUTOSEND_EVERY_MS = 60_000;
const UPDATE_CHECK_MS = 60_000;
// Every company's job board is checked once a day at this hour (this PC's time), and right away when the page asks.
// A check that couldn't reach the site is tried again this often.
const SWEEP_HOUR = 8;
const SWEEP_RETRY_MS = 60 * 60_000;
const RESTART_CODE = 75; // run.js starts the helper again
const SUPERVISED = process.env.APPLY_DESK_SUPERVISED === '1';

const cfg = loadConfig();
const api = makeApi(cfg);
const info = { version: VERSION, host: os.hostname() };
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

mkdirSync(cfg.shotsDir, { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(cfg.profileDir, {
    channel: cfg.browser,
    headless: false,
    viewport: null,
  });
} catch (err) {
  // Its browser profile can only be open once: another helper (e.g. the one that started with Windows) has it.
  if (/ProcessSingleton|already running|in use|lock/i.test(err.message)) {
    log('Another helper is already running on this PC (its browser has the profile open). This one is closing.');
    process.exit(0);
  }
  throw err;
}
context.setDefaultTimeout(15_000);

if (process.argv.includes('--login')) {
  // The sites' home pages look the same signed in or out; an application from the queue goes to the real sign-in.
  const { jobs = [] } = await api('/jobs?view=manual').catch(() => ({}));
  const amazon = jobs.find((j) => j.source === 'amazon')?.apply_url || 'https://account.amazon.jobs/';
  const microsoft = jobs.find((j) => j.source === 'microsoft')?.apply_url || 'https://apply.careers.microsoft.com/careers';
  const first = context.pages()[0] || (await context.newPage());
  await first.goto(amazon);
  const ms = await context.newPage();
  await ms.goto(microsoft);
  await ms.getByRole('button', { name: /apply now/i }).or(ms.getByRole('link', { name: /apply now/i })).first().click().catch(() => {});
  log('This is the helper’s own browser. Sign in on both tabs (Amazon Jobs and Microsoft Careers).');
  log('Once each tab shows the application form, close the window. Don’t submit anything here.');
  await new Promise((resolve) => context.on('close', resolve));
  process.exit(0);
}

if (!cfg.resumePath || !existsSync(cfg.resumePath)) {
  log(`Warning: resume not found at "${cfg.resumePath}". Set resumePath in config.local.json.`);
}

let stopping = false;
process.on('SIGINT', async () => {
  stopping = true;
  log('Stopping…');
  await context.close().catch(() => {});
  process.exit(0);
});
context.on('close', () => {
  if (!stopping) {
    log('The helper browser was closed. Start the helper again with npm start.');
    process.exit(0);
  }
});

const report = (id, status, note, needs = null, extra = {}) =>
  api('/runner/result', { method: 'POST', body: { id, status, note, needs, ...extra, ...info } }).catch((err) => log('Could not report back:', err.message));

// An application needs you: a beep here, and for an emailed code (which expires) its tab comes to the front.
// The site also pushes it to your phone.
function callYou(page, urgent = false) {
  process.stdout.write('\u0007');
  if (urgent) page.bringToFront().catch(() => {});
}

// Phone pushes the site queued (a code needed, the evening summary). They go out from this PC: ntfy turns away
// requests from Cloudflare's shared addresses.
async function deliver(outbox = []) {
  for (const { at, ...msg } of outbox) {
    const r = await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...msg, message: String(msg.message || '').slice(0, 3800) }),
    }).catch((err) => ({ ok: false, status: err.message }));
    if (!r.ok) log(`Couldn’t send a phone notification (${r.status}): ${msg.title}`);
  }
}

// ---------- updates ----------

// The newest change time across the helper's own code (and the job-board code it shares with the site): when it
// moves, there's an update to load.
const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));
const SHARED = ['sources.js', 'filters.js'].map((f) => fileURLToPath(new URL(`../../worker/src/${f}`, import.meta.url)));
function codeStamp() {
  let newest = 0;
  for (const f of readdirSync(SRC_DIR, { recursive: true })) {
    if (String(f).endsWith('.js')) newest = Math.max(newest, statSync(path.join(SRC_DIR, String(f))).mtimeMs);
  }
  for (const f of SHARED) newest = Math.max(newest, statSync(f).mtimeMs);
  return newest;
}
const startedStamp = codeStamp();
let lastUpdateCheck = Date.now();
let updateNoted = false;

// Between applications, with nothing waiting on you: restart into the new code (run.js starts it again).
async function restartIfUpdated() {
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
  lastUpdateCheck = Date.now();
  if (codeStamp() === startedStamp) return;
  if (!SUPERVISED) {
    if (!updateNoted) log('An update is ready. Restart the helper to load it (Ctrl+C, then npm start).');
    updateNoted = true;
    return;
  }
  if (waiting.size || sweeping) return; // finish what's open first
  log('Updated code found. Restarting to load it…');
  stopping = true;
  await context.close().catch(() => {});
  process.exit(RESTART_CODE);
}

async function screenshot(page, job, label) {
  const safe = `${job.company}-${job.id}`.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80);
  const file = path.join(cfg.shotsDir, `${new Date().toISOString().slice(0, 10)}_${safe}_${label}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

// The likeliest message on the page after Submit: a line mentioning success, thanks, errors or verification.
async function pageMessage(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /thank|success|submitted|received|error|invalid|required|verif|spam|try again|unable|problem|captcha/i.test(l));
  return (hit || lines.slice(0, 3).join(' · ')).slice(0, 200);
}

async function finish(page, job, ok) {
  if (ok) {
    const file = await screenshot(page, job, 'confirmation');
    await report(job.id, 'submitted', `Confirmation screenshot: ${file}`);
    log(`Submitted ✓ ${job.company} · ${job.title}`);
    await page.close().catch(() => {});
  } else {
    await screenshot(page, job, 'stuck');
    await report(job.id, 'needs_you', 'Still not submitted. The form is open in the helper window; finish it there, then press “I finished it”.');
    log(`Gave up waiting on ${job.company} · ${job.title}; its tab is still open.`);
  }
}

// The company caps applications per person: this one wasn't sent, and the site holds the company's jobs for a while.
async function holdCompany(page, job, message) {
  log(`  ${job.company} turned it away: “${message}”. Its jobs are on hold for 30 days.`);
  await screenshot(page, job, 'limit');
  await report(job.id, 'limited', message);
  await page.close().catch(() => {});
}

// ---------- applications waiting on you ----------

const waiting = new Map(); // job id -> { page, job, filler, ctx, until, needs, enteredAt }

// ctx: { form, answers }, for pressing Submit again once you've ticked the boxes.
async function wait(page, job, filler, ctx, needs = null) {
  // Limit wording already on the page (e.g. in the job description) isn't a rejection; only new wording is.
  const limitBefore = await limitTexts(page);
  waiting.set(job.id, { page, job, filler, ctx, needs, limitBefore, until: Date.now() + WAIT_FOR_YOU_MS, enteredAt: 0 });
}

// The form is stuck on something for you. Boxes it won't go without show on the page (Sent tab), so they can be
// ticked from your phone; the helper then ticks them here and presses Submit again.
async function stuck(page, job, filler, ctx, note, urgent = false) {
  const boxes = await boxesForYou(page).catch(() => []);
  log(`  ${note}`);
  if (boxes.length) log(`  Boxes to tick on the page: ${boxes.map((b) => `“${b.label.slice(0, 70)}”`).join(', ')}`);
  await report(job.id, 'needs_you', note, boxes.length ? 'boxes' : null, { boxes });
  callYou(page, urgent);
  return wait(page, job, filler, ctx, boxes.length ? 'boxes' : null);
}

// What pressing Submit led to.
async function afterSubmit(page, job, filler, ctx, outcome) {
  if (outcome === 'submitted') return finish(page, job, true);
  if (outcome === 'code') {
    log('  The site emailed a verification code. Enter it on the page or in the helper window.');
    await report(job.id, 'needs_you', CODE_NOTE, 'code');
    callYou(page, true);
    return wait(page, job, filler, ctx, 'code');
  }
  if (outcome.limit) return holdCompany(page, job, outcome.limit);
  // Record what the page shows, so an unexpected message can be diagnosed from the Sent tab.
  await screenshot(page, job, 'after-submit');
  const shown = outcome === 'unknown' ? await pageMessage(page) : '';
  const note = outcome === 'captcha'
    ? 'The site wants a CAPTCHA. Solve it in the helper window; it will notice when the application goes through.'
    : outcome.errors
      ? `The form said: ${outcome.errors.join('; ')}. Fix it in the helper window and submit there.`
      : `Pressed Submit but no confirmation showed up. Check the helper window.${shown ? ` The page says: “${shown}”` : ''}`;
  return stuck(page, job, filler, ctx, note, outcome === 'captcha');
}

async function checkWaiting() {
  for (const [id, w] of waiting) {
    const { page, job, filler } = w;
    if (page.isClosed()) {
      waiting.delete(id);
      continue;
    }
    if (await filler.isDone(page).catch(() => false)) {
      waiting.delete(id);
      await finish(page, job, true);
      continue;
    }
    const limited = await companyLimit(page, w.limitBefore);
    if (limited) {
      waiting.delete(id);
      await holdCompany(page, job, limited);
      continue;
    }
    if (w.needs === 'boxes') {
      // Only the boxes you ticked on the page; then Submit again.
      const { code } = await api(`/runner/code?id=${encodeURIComponent(id)}`).catch(() => ({}));
      if (code) {
        waiting.delete(id);
        try {
          await tickBoxes(page, JSON.parse(code));
          log(`${job.company}: ticked the boxes you ticked. Submitting.`);
          await afterSubmit(page, job, filler, w.ctx, await filler.submit(page, w.ctx));
        } catch (err) {
          await report(id, 'needs_you', `Couldn’t tick the boxes (${err.message}). Tick them in the helper window and submit there.`);
          await wait(page, job, filler, w.ctx);
        }
        continue;
      }
    }
    // A code prompt can also show up after you fix something by hand.
    if (w.needs !== 'code' && (await needsCode(page).catch(() => false))) {
      w.needs = 'code';
      log(`${job.company}: the site emailed a verification code. Enter it on the page or in the helper window.`);
      await report(id, 'needs_you', CODE_NOTE, 'code');
      callYou(page, true);
    }
    if (w.needs === 'code') {
      // Only a code you entered on the page (or gave Claude). The helper never reads your email.
      const { code } = await api(`/runner/code?id=${encodeURIComponent(id)}`).catch(() => ({}));
      if (code) {
        try {
          await enterCode(page, code);
          w.enteredAt = Date.now();
          log(`${job.company}: entered the code you sent.`);
        } catch (err) {
          w.needs = null;
          await report(id, 'needs_you', `Couldn’t enter the code (${err.message}). Type it in the helper window.`);
        }
      } else if (w.enteredAt && Date.now() - w.enteredAt > 30_000 && (await needsCode(page).catch(() => false))) {
        w.enteredAt = 0;
        await report(id, 'needs_you', 'That code didn’t go through. Check the email and enter it again.', 'code');
      }
    }
    if (Date.now() > w.until) {
      waiting.delete(id);
      await finish(page, job, false);
    }
  }
}

// ---------- one application ----------

async function handle({ job, form, answers, prefs = {} }) {
  const filler = FILLERS[job.source];
  if (!filler) return report(job.id, 'failed', `The helper can’t fill ${job.source} forms yet.`);
  // Retried from the page while its old tab was still waiting: start fresh.
  if (waiting.has(job.id)) {
    await waiting.get(job.id).page.close().catch(() => {});
    waiting.delete(job.id);
  }
  log(`Applying: ${job.company} · ${job.title}`);
  const page = await context.newPage();
  try {
    await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(page);
    const { missing, done } = await filler.fill(page, { job, form, answers, resumePath: cfg.resumePath, prefs });
    if (done) return finish(page, job, true); // the site says it's already submitted
    if (!prefs.smsOptIn) {
      const n = await uncheckSmsOptIns(page).catch(() => 0);
      if (n) log(`  Unchecked ${n} text-message opt-in${n === 1 ? '' : 's'}.`);
    }
    const ctx = { form, answers };
    if (missing.length) return stuck(page, job, filler, ctx, `Couldn’t fill: ${missing.join('; ')}. Finish it in the helper window and submit there.`);
    await screenshot(page, job, 'filled');
    return afterSubmit(page, job, filler, ctx, await filler.submit(page, ctx));
  } catch (err) {
    if (err instanceof amazon.LimitError) {
      // At Amazon's cap: put the job back (your answers are kept) and pause Amazon until a spot opens.
      log(`  ${err.message}`);
      await report(job.id, 'new', err.message);
      await api('/runner/site', { method: 'POST', body: { source: job.source, paused: true, note: err.message } }).catch(() => {});
      await page.close().catch(() => {});
      return;
    }
    log('  Error:', err.message.split('\n')[0]);
    await screenshot(page, job, 'error');
    await report(job.id, 'failed', err.message.split('\n')[0].slice(0, 300));
    if (signedOut(err)) await api('/runner/form', { method: 'POST', body: { id: '', alert: err.message } }).catch(() => {});
    await page.close().catch(() => {});
  }
}

// ---------- reading Amazon / Microsoft questions ahead of you ----------

let lastPrepare = 0;

async function prepareNext() {
  if (Date.now() - lastPrepare < PREPARE_EVERY_MS) return;
  lastPrepare = Date.now();
  const { job } = await api('/runner/prepare', { method: 'POST', body: info }).catch(() => ({}));
  if (!job) return;
  log(`Reading questions: ${job.company} · ${job.title}`);
  const page = await context.newPage();
  try {
    const r = await FILLERS[job.source].prepare(page, job);
    const body = r.form ? { id: job.id, form: r.form, alert: null } : { id: job.id, outcome: r.outcome, note: r.outcome === 'limit' ? amazon.LIMIT_NOTE : undefined };
    await api('/runner/form', { method: 'POST', body });
    const said = { applied: 'Already applied.', closed: 'Posting closed.', limit: `${amazon.LIMIT_NOTE} Checking again in a few hours.` };
    log(r.form ? `  Ready on your page (${r.form.questions.length} questions).` : `  ${said[r.outcome] || r.outcome}`);
  } catch (err) {
    // Signed out: the server shows a banner; the job is parked (pushed back) so the next try picks another.
    log('  Couldn’t read it:', err.message.split('\n')[0]);
    await api('/runner/form', { method: 'POST', body: { id: job.id, note: err.message.split('\n')[0], ...(signedOut(err) ? { alert: err.message } : {}) } }).catch(() => {});
    if (signedOut(err)) lastPrepare = Date.now() + 30 * 60_000;
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- checking every company for new jobs ----------

const sweeper = makeSweeper({ api, file: path.join(ROOT, '.sweep-cache.json'), log });
let lastTry = 0;
let sweeping = null;

// It's only downloads, so it runs alongside applications (and while paused from the page).
function sweepSoon(now = false) {
  if (sweeping) return;
  if (!now && (!dailyDue(sweeper.lastAt(), SWEEP_HOUR) || Date.now() - lastTry < SWEEP_RETRY_MS)) return;
  lastTry = Date.now();
  sweeping = sweeper.sweep()
    .catch((err) => log('Couldn’t check the job boards:', err.message))
    .finally(() => (sweeping = null));
}

// ---------- main loop ----------

// Settings → "Send automatically": the site picks an application with nothing new to answer and hands it over
// on the next claim.
let lastAutosend = 0;
async function autoSend() {
  if (Date.now() - lastAutosend < AUTOSEND_EVERY_MS) return false;
  lastAutosend = Date.now();
  const { job } = await api('/runner/autosend', { method: 'POST', body: info }).catch(() => ({}));
  if (job) log(`Nothing new to answer, sending automatically: ${job.company} · ${job.title}`);
  return !!job;
}

log(`Apply Desk helper ${VERSION}: watching ${cfg.siteUrl}. Leave this running; Ctrl+C to stop.`);
let lastClaim = 0;
let wasPaused = false;
while (!stopping) {
  await restartIfUpdated();
  await checkWaiting();
  if (waiting.size < MAX_WAITING && Date.now() - lastClaim >= POLL_MS) {
    lastClaim = Date.now();
    let claim = null;
    try {
      claim = await api('/runner/claim', { method: 'POST', body: info });
    } catch (err) {
      log('Could not reach the site:', err.message);
    }
    await deliver(claim?.outbox);
    if (claim) sweepSoon(claim.sweep);
    // Paused from the page: stay running, take no work.
    if (claim?.paused !== wasPaused) {
      wasPaused = !!claim?.paused;
      log(wasPaused ? 'Paused from the page. Waiting until you resume.' : 'Resumed.');
    }
    if (claim?.paused) {
      await sleep(POLL_MS);
      continue;
    }
    if (claim?.job) {
      await handle(claim);
      lastClaim = 0; // look for the next one right away
      continue;
    }
    if (claim && (await autoSend())) {
      lastClaim = 0; // it's ready now: claim it right away
      continue;
    }
    if (claim && waiting.size === 0) await prepareNext();
  } else if (waiting.size >= MAX_WAITING && Date.now() - lastClaim >= POLL_MS) {
    lastClaim = Date.now();
    await api('/runner/heartbeat', { method: 'POST', body: info }).then((r) => deliver(r.outbox)).catch(() => {});
    sweepSoon();
  }
  await sleep(waiting.size ? 4000 : Math.max(1000, POLL_MS - (Date.now() - lastClaim)));
}
