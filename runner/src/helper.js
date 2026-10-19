// The Apply Desk helper. Leave it running on your PC: it picks up the applications you sent from the
// page, fills them in a Chrome window it controls, submits them, and reports back.
//
//   npm start          run the helper
//   npm run login      open the helper's browser so you can sign in to job sites, then close it
//
// When an application needs you (an emailed code, a CAPTCHA, a missing answer), its tab stays open and
// the helper keeps going with the rest of the queue, checking back on the waiting tabs as it goes.
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig, makeApi } from './config.js';
import { enterCode, needsCode, sleep, uncheckSmsOptIns } from './fillers/common.js';
import * as greenhouse from './fillers/greenhouse.js';
import * as lever from './fillers/lever.js';

const VERSION = '0.2.0';
const FILLERS = { greenhouse, lever };
const POLL_MS = 15_000;
const WAIT_FOR_YOU_MS = 30 * 60_000;
const MAX_WAITING = 5;
const CODE_NOTE = 'The site emailed you a verification code. Enter it on the page (Sent tab) or in the helper window.';

const cfg = loadConfig();
const api = makeApi(cfg);
const info = { version: VERSION, host: os.hostname() };
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

mkdirSync(cfg.shotsDir, { recursive: true });

const context = await chromium.launchPersistentContext(cfg.profileDir, {
  channel: cfg.browser,
  headless: false,
  viewport: null,
});
context.setDefaultTimeout(15_000);

if (process.argv.includes('--login')) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.amazon.jobs/en/');
  log('This is the helper’s own browser. Sign in to the job sites you use, then close the window.');
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

const report = (id, status, note, needs = null) =>
  api('/runner/result', { method: 'POST', body: { id, status, note, needs, ...info } }).catch((err) => log('Could not report back:', err.message));

async function screenshot(page, job, label) {
  const safe = `${job.company}-${job.id}`.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80);
  const file = path.join(cfg.shotsDir, `${new Date().toISOString().slice(0, 10)}_${safe}_${label}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
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

// ---------- applications waiting on you ----------

const waiting = new Map(); // job id -> { page, job, filler, until, needs, enteredAt }

function wait(page, job, filler, needs = null) {
  waiting.set(job.id, { page, job, filler, needs, until: Date.now() + WAIT_FOR_YOU_MS, enteredAt: 0 });
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
    // A code prompt can also show up after you fix something by hand.
    if (w.needs !== 'code' && (await needsCode(page).catch(() => false))) {
      w.needs = 'code';
      log(`${job.company}: the site emailed a verification code. Enter it on the page or in the helper window.`);
      await report(id, 'needs_you', CODE_NOTE, 'code');
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
    const { missing } = await filler.fill(page, { job, form, answers, resumePath: cfg.resumePath, prefs });
    if (!prefs.smsOptIn) {
      const n = await uncheckSmsOptIns(page).catch(() => 0);
      if (n) log(`  Unchecked ${n} text-message opt-in${n === 1 ? '' : 's'}.`);
    }
    if (missing.length) {
      log('  Needs you:', missing.join('; '));
      await report(job.id, 'needs_you', `Couldn’t fill: ${missing.join('; ')}. Finish it in the helper window and submit there.`);
      return wait(page, job, filler);
    }
    await screenshot(page, job, 'filled');
    const outcome = await filler.submit(page);
    if (outcome === 'submitted') return finish(page, job, true);
    if (outcome === 'code') {
      log('  The site emailed a verification code. Enter it on the page or in the helper window.');
      await report(job.id, 'needs_you', CODE_NOTE, 'code');
      return wait(page, job, filler, 'code');
    }
    const note = outcome === 'captcha'
      ? 'The site wants a CAPTCHA. Solve it in the helper window; it will notice when the application goes through.'
      : outcome.errors
        ? `The form said: ${outcome.errors.join('; ')}. Fix it in the helper window and submit there.`
        : 'Pressed Submit but no confirmation showed up. Check the helper window.';
    log(`  ${note}`);
    await report(job.id, 'needs_you', note);
    return wait(page, job, filler);
  } catch (err) {
    log('  Error:', err.message.split('\n')[0]);
    await screenshot(page, job, 'error');
    await report(job.id, 'failed', err.message.split('\n')[0].slice(0, 300));
    await page.close().catch(() => {});
  }
}

// ---------- main loop ----------

log(`Apply Desk helper ${VERSION}: watching ${cfg.siteUrl}. Leave this running; Ctrl+C to stop.`);
let lastClaim = 0;
while (!stopping) {
  await checkWaiting();
  if (waiting.size < MAX_WAITING && Date.now() - lastClaim >= POLL_MS) {
    lastClaim = Date.now();
    let claim = null;
    try {
      claim = await api('/runner/claim', { method: 'POST', body: info });
    } catch (err) {
      log('Could not reach the site:', err.message);
    }
    if (claim?.job) {
      await handle(claim);
      lastClaim = 0; // look for the next one right away
      continue;
    }
  } else if (waiting.size >= MAX_WAITING && Date.now() - lastClaim >= POLL_MS) {
    lastClaim = Date.now();
    api('/runner/heartbeat', { method: 'POST', body: info }).catch(() => {});
  }
  await sleep(waiting.size ? 4000 : Math.max(1000, POLL_MS - (Date.now() - lastClaim)));
}
