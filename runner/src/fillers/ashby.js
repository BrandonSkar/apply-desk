// Fills Ashby application forms (jobs.ashbyhq.com/<company>/<job>/application). Every question sits in a
// wrapper tagged data-field-path="<path>": text inputs, Yes/No buttons (data-option="yes"/"no"), radio or checkbox
// groups with labels, a location box that suggests matches, and a date picker.
import { isEmpty, sleep, visibleTexts, waitOutcome } from './common.js';

const box = (page, q) => page.locator(`[data-field-path="${q.path}"]`).first();

// "2 weeks", "1 month", "immediately", or a date -> MM/DD/YYYY for the date picker.
function toDate(value) {
  const s = String(value).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  const d = new Date();
  const m = /(\d+)\s*(day|week|month)/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (/day/i.test(m[2])) d.setDate(d.getDate() + n);
    else if (/week/i.test(m[2])) d.setDate(d.getDate() + 7 * n);
    else d.setMonth(d.getMonth() + n);
  } else if (!/immediate|asap|now/i.test(s) && !Number.isNaN(Date.parse(s))) {
    d.setTime(Date.parse(s));
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

// Pick `label` in a choice question: radio/checkbox groups have a <label> per option; long lists are a dropdown.
async function chooseByLabel(page, wrapper, label) {
  const ok = await wrapper.evaluate((el, label) => {
    const want = label.trim();
    for (const l of el.querySelectorAll('label[for]')) {
      if (l.innerText.trim() !== want) continue;
      const input = document.getElementById(l.getAttribute('for'));
      if (!input || input.type === 'text') continue;
      if (!input.checked) input.click();
      return true;
    }
    return false;
  }, label);
  if (ok) return;
  const select = wrapper.locator('select').first();
  if (await select.count()) {
    await select.selectOption({ label });
    return;
  }
  const combo = wrapper.locator('input[role="combobox"], input[aria-autocomplete]').first();
  if (!(await combo.count())) throw new Error(`no option "${label}"`);
  await combo.click();
  await combo.fill('');
  await combo.pressSequentially(label.slice(0, 40), { delay: 20 });
  const options = page.locator('[role="option"]');
  await options.first().waitFor({ timeout: 6_000 });
  const texts = (await options.allInnerTexts()).map((t) => t.trim());
  const i = texts.indexOf(label.trim()) >= 0 ? texts.indexOf(label.trim()) : texts.findIndex((t) => t.toLowerCase().startsWith(label.trim().toLowerCase()));
  if (i < 0) throw new Error(`no option "${label}"`);
  await options.nth(i).click();
}

export async function fill(page, { form, answers, resumePath }) {
  await page.locator('[data-field-path="_systemfield_email"], [data-field-path]').first().waitFor({ timeout: 45_000 });
  await sleep(1000);
  const missing = [];
  for (const q of form.questions) {
    const v = answers[q.name];
    const wrapper = box(page, q);
    try {
      if (!(await wrapper.count())) {
        if (q.required) missing.push(`${q.label} (not on the page)`);
        continue;
      }
      if (q.kind === 'resume') {
        await wrapper.locator('input[type=file]').first().setInputFiles(resumePath);
        await sleep(1500);
        continue;
      }
      if (isEmpty(v)) {
        if (q.required) missing.push(q.label);
        continue;
      }
      if (q.kind === 'file') {
        missing.push(`${q.label} (needs a file)`);
        continue;
      }
      const values = Array.isArray(v) ? v : [v];
      if (q.kind === 'location') {
        const input = wrapper.locator('input').first();
        await input.fill('');
        await input.pressSequentially(String(values[0]), { delay: 30 });
        const first = page.locator('[role="option"]').first();
        await first.waitFor({ timeout: 10_000 });
        await first.click();
      } else if (q.kind === 'date') {
        const input = wrapper.locator('input').first();
        await input.fill(toDate(values[0]));
        await input.press('Enter');
        await page.keyboard.press('Escape');
      } else if (q.ashbyType === 'Boolean') {
        await wrapper.locator(`button[data-option="${/^\s*y/i.test(values[0]) ? 'yes' : 'no'}"]`).click();
      } else if (q.type === 'select' || q.type === 'multiselect') {
        for (const label of values) await chooseByLabel(page, wrapper, label);
      } else {
        await wrapper.locator('input, textarea').first().fill(String(values[0]));
      }
    } catch (err) {
      missing.push(`${q.label} (${err.message.split('\n')[0].slice(0, 80)})`);
    }
  }
  return { missing };
}

export async function isDone(page) {
  if (/\/application\/?(confirmation|success|submitted)/i.test(page.url())) return true;
  return page.getByText(/thank(s| you) for applying|application (has been |was )?(submitted|received)|successfully submitted|we('ve| have) received your application/i).first().isVisible();
}

const captcha = async (page) => {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"]');
  const n = await frames.count();
  for (let i = 0; i < n; i++) if (await frames.nth(i).isVisible()) return true;
  return false;
};

const errors = (page) => visibleTexts(page.locator('[class*="_error_"], [class*="errorMessage"], [role="alert"]'));

export async function submit(page) {
  await page.getByRole('button', { name: /submit application/i }).click();
  return waitOutcome(page, { isDone, captcha, errors });
}
