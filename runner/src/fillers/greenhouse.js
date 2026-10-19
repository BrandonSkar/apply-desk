// Fills Greenhouse application forms (job-boards.greenhouse.io). Field ids match the question names from
// Greenhouse's public API: text fields are inputs, single choices are searchable dropdowns, multi choices
// are checkboxes, demographic questions use the question id.
import { byId, checkValues, isEmpty, pickCombo, visibleTexts, waitOutcome } from './common.js';

export async function fill(page, { form, answers, resumePath }) {
  await page.locator('#first_name').waitFor({ timeout: 45_000 });
  const missing = [];

  // Phone country first, so the phone number is read as a US number.
  const country = page.locator('#country');
  if (await country.count()) await pickCombo(page, country, 'United States').catch(() => {});

  for (const q of form.questions) {
    const v = answers[q.name];
    try {
      if (q.kind === 'resume') {
        await page.locator('#resume').setInputFiles(resumePath);
        continue;
      }
      if (isEmpty(v)) {
        if (q.required) missing.push(q.label);
        continue;
      }
      if (q.type === 'file') {
        missing.push(`${q.label} (needs a file)`);
        continue;
      }
      if (q.kind === 'cover_letter') {
        const manual = page.locator('[aria-labelledby*="cover_letter"] button, button', { hasText: /enter manually/i }).last();
        if (await manual.count()) await manual.click();
        await page.locator('#cover_letter_text').fill(String(v));
        continue;
      }
      if (q.kind === 'location') {
        await pickCombo(page, page.locator('#candidate-location'), String(v), { search: true });
        continue;
      }
      const id = q.domId || q.name;
      const boxes = page.locator(`input[type=checkbox][name="${q.name}"]`);
      const target = q.type === 'multiselect' && (await boxes.count()) ? boxes.first() : page.locator(byId(id)).first();
      // Some optional questions only appear after another answer (e.g. race after ethnicity). Skip them if hidden.
      if (!q.required && !(await target.isVisible().catch(() => false))) continue;
      if (q.type === 'text' || q.type === 'textarea') {
        await page.locator(byId(id)).fill(String(v));
      } else if (q.type === 'select') {
        await pickCombo(page, page.locator(byId(id)), String(v));
      } else if (q.type === 'multiselect') {
        const labels = Array.isArray(v) ? v : [v];
        if (await page.locator(`input[type=checkbox][name="${q.name}"]`).count()) {
          const values = labels.map((label) => {
            const opt = (q.options || []).find((o) => o.label === label);
            if (!opt) throw new Error(`no option "${label}"`);
            return opt.value;
          });
          await checkValues(page, q.name, values);
        } else {
          for (const label of labels) await pickCombo(page, page.locator(byId(id)), label);
        }
      }
    } catch (err) {
      missing.push(`${q.label} (${err.message.split('\n')[0].slice(0, 80)})`);
    }
  }
  return { missing };
}

export async function isDone(page) {
  if (/confirmation|thank/i.test(page.url())) return true;
  return page.getByText(/thank you for (applying|your application|your interest)|application (has been |was )?(received|submitted)/i).first().isVisible();
}

const captcha = async (page) => {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[title*="challenge" i]');
  const n = await frames.count();
  for (let i = 0; i < n; i++) if (await frames.nth(i).isVisible()) return true;
  return false;
};

const errors = (page) => visibleTexts(page.locator('.helper-text--error, [class*="error-message"], [role="alert"]'));

export async function submit(page) {
  await page.locator('button[type=submit]', { hasText: /submit/i }).first().click();
  return waitOutcome(page, { isDone, captcha, errors });
}
