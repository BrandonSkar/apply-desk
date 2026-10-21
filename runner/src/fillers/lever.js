// Fills Lever application forms (jobs.lever.co/<company>/<id>/apply). Inputs use plain names
// (name, email, cards[<id>][field0], eeo[gender]); choice questions are radios/checkboxes valued by their text.
import { byName, checkValues, isEmpty, pickLocation, sleep, visibleTexts, waitOutcome } from './common.js';

export async function fill(page, { form, answers, resumePath }) {
  await page.locator('input[name="name"]').waitFor({ timeout: 45_000 });
  const missing = [];

  // Resume first: Lever reads it and pre-fills some fields, which the answers below then overwrite.
  if (form.questions.some((q) => q.kind === 'resume')) {
    await page.locator('input[name="resume"]').setInputFiles(resumePath);
    await page.locator('.resume-upload-success').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await sleep(1500);
  }

  for (const q of form.questions) {
    if (q.kind === 'resume') continue;
    const v = answers[q.name];
    try {
      if (isEmpty(v)) {
        if (q.required) missing.push(q.label);
        continue;
      }
      if (q.type === 'file') {
        missing.push(`${q.label} (needs a file)`);
        continue;
      }
      if (q.kind === 'location') {
        await pickLocation(page.locator('input[name="location"]'), v, page.locator('.dropdown-location'));
        continue;
      }
      const el = page.locator(byName(q.name)).first();
      if (q.type === 'text' || q.type === 'textarea') {
        await el.fill(String(v));
        continue;
      }
      const tag = await el.evaluate((e) => e.tagName);
      const labels = Array.isArray(v) ? v : [v];
      if (tag === 'SELECT') await el.selectOption({ label: labels[0] });
      else await checkValues(page, q.name, labels);
    } catch (err) {
      missing.push(`${q.label} (${err.message.split('\n')[0].slice(0, 80)})`);
    }
  }
  return { missing };
}

export async function isDone(page) {
  if (/\/thanks\b/i.test(page.url())) return true;
  return page.getByText(/application submitted|thanks for applying|thank you for applying/i).first().isVisible();
}

const captcha = async (page) => {
  const frames = page.locator('iframe[src*="hcaptcha"][title*="challenge" i], iframe[src*="hcaptcha"][src*="challenge"]');
  const n = await frames.count();
  for (let i = 0; i < n; i++) if (await frames.nth(i).isVisible()) return true;
  return false;
};

const errors = (page) => visibleTexts(page.locator('.error-message, .application-error, [class*="error"]:not(script)'));

export async function submit(page) {
  await page.locator('#btn-submit').click();
  return waitOutcome(page, { isDone, captcha, errors });
}
