// The Apply Desk helper. Leave it running on your PC: it picks up the applications you sent from the
// page, fills them in a Chrome window it controls, submits them, and reports back.
//
//   npm start          run the helper
//   npm run login      open the helper's browser so you can sign in to job sites, then close it
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig, makeApi } from './config.js';
import { sleep } from './fillers/common.js';
import * as greenhouse from './fillers/greenhouse.js';
import * as lever from './fillers/lever.js';

const VERSION = '0.1.0';
const FILLERS = { greenhouse, lever };
const POLL_MS = 15_000;
const WAIT_FOR_YOU_MS = 15 * 60_000;

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

const report = (id, status, note) =>
  api('/runner/result', { method: 'POST', body: { id, status, note, ...info } }).catch((err) => log('Could not report back:', err.message));

async function screenshot(page, job, label) {
  const safe = `${job.company}-${job.id}`.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80);
  const file = path.join(cfg.shotsDir, `${new Date().toISOString().slice(0, 10)}_${safe}_${label}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

// Give you time to finish a form by hand (CAPTCHA, a missing file); notice when it goes through.
async function waitForYou(page, filler) {
  const end = Date.now() + WAIT_FOR_YOU_MS;
  let beat = 0;
  while (Date.now() < end && !page.isClosed()) {
    if (await filler.isDone(page).catch(() => false)) return true;
    if (Date.now() - beat > 30_000) {
      beat = Date.now();
      api('/runner/heartbeat', { method: 'POST', body: info }).catch(() => {});
    }
    await sleep(3000);
  }
  return false;
}

async function finish(page, job, ok) {
  if (ok) {
    const file = await screenshot(page, job, 'confirmation');
    await report(job.id, 'submitted', `Confirmation screenshot: ${file}`);
    log('  Submitted ✓');
    await page.close().catch(() => {});
  } else {
    await report(job.id, 'needs_you', 'No confirmation yet. The form is still open in the helper window; finish it there, then press “I finished it”.');
    log('  Waiting on you: left the form open.');
  }
}

async function handle({ job, form, answers }) {
  const filler = FILLERS[job.source];
  if (!filler) return report(job.id, 'failed', `The helper can’t fill ${job.source} forms yet.`);
  log(`Applying: ${job.company} · ${job.title}`);
  const page = await context.newPage();
  try {
    await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const { missing } = await filler.fill(page, { job, form, answers, resumePath: cfg.resumePath });
    if (missing.length) {
      log('  Needs you:', missing.join('; '));
      await report(job.id, 'needs_you', `Couldn’t fill: ${missing.join('; ')}. Finish it in the helper window and submit there.`);
      return finish(page, job, await waitForYou(page, filler));
    }
    await screenshot(page, job, 'filled');
    const outcome = await filler.submit(page);
    if (outcome === 'submitted') return finish(page, job, true);
    const note = outcome === 'captcha'
      ? 'The site wants a CAPTCHA. Solve it in the helper window; it will notice when the application goes through.'
      : outcome.errors
        ? `The form said: ${outcome.errors.join('; ')}. Fix it in the helper window and submit there.`
        : 'Pressed Submit but no confirmation showed up. Check the helper window.';
    log(`  ${note}`);
    await report(job.id, 'needs_you', note);
    return finish(page, job, await waitForYou(page, filler));
  } catch (err) {
    log('  Error:', err.message.split('\n')[0]);
    await screenshot(page, job, 'error');
    await report(job.id, 'failed', err.message.split('\n')[0].slice(0, 300));
    await page.close().catch(() => {});
  }
}

log(`Apply Desk helper ${VERSION}: watching ${cfg.siteUrl}. Leave this running; Ctrl+C to stop.`);
while (!stopping) {
  let claim;
  try {
    claim = await api('/runner/claim', { method: 'POST', body: info });
  } catch (err) {
    log('Could not reach the site:', err.message);
    await sleep(POLL_MS);
    continue;
  }
  if (!claim.job) {
    await sleep(POLL_MS);
    continue;
  }
  await handle(claim);
  await sleep(2000);
}
