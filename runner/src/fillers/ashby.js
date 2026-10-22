// Fills Ashby application forms (jobs.ashbyhq.com/<company>/<job>/application). Every question sits in a
// wrapper tagged data-field-path="<path>": text inputs, Yes/No buttons (data-option="yes"/"no"), radio or checkbox
// groups with labels, a location box that suggests matches, and a date picker.
import { isEmpty, pace, pickLocation, sleep, visibleTexts, waitOutcome } from './common.js';

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
// Options are clicked with the mouse: Ashby only records an answer from real clicks and typing.
async function chooseByLabel(page, wrapper, label) {
  const forId = await wrapper.evaluate((el, label) => {
    const want = label.trim();
    for (const l of el.querySelectorAll('label[for]')) {
      if (l.innerText.trim() !== want) continue;
      const input = document.getElementById(l.getAttribute('for'));
      if (!input || input.type === 'text') continue;
      return input.checked ? '' : l.getAttribute('for');
    }
    return null;
  }, label);
  if (forId === '') return; // already chosen
  if (forId) {
    await wrapper.locator(`label[for="${forId.replace(/["\\]/g, '\\$&')}"]`).click();
    return;
  }
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
      await answer(page, wrapper, q, v);
      await pace();
    } catch (err) {
      missing.push(`${q.label} (${err.message.split('\n')[0].slice(0, 80)})`);
    }
  }
  return { missing };
}

// Put one answer on the page. `again`: the form didn't take it the first time, so type it key by key.
async function answer(page, wrapper, q, v, again = false) {
  const values = Array.isArray(v) ? v : [v];
  if (q.kind === 'location') {
    await pickLocation(wrapper.locator('input').first(), values[0], page.locator('[role="option"]'));
  } else if (q.kind === 'date') {
    const input = wrapper.locator('input').first();
    await input.fill(toDate(values[0]));
    await input.press('Enter');
    await page.keyboard.press('Escape');
  } else if (q.ashbyType === 'Boolean') {
    const yes = /^\s*y/i.test(values[0]);
    // Clicking the other button first makes sure the form sees a change.
    if (again) await wrapper.locator(`button[data-option="${yes ? 'no' : 'yes'}"]`).click();
    await wrapper.locator(`button[data-option="${yes ? 'yes' : 'no'}"]`).click();
  } else if (q.type === 'select' || q.type === 'multiselect') {
    for (const label of values) await chooseByLabel(page, wrapper, label);
  } else {
    const input = wrapper.locator('input, textarea').first();
    await input.click();
    if (again) {
      await input.fill('');
      await input.pressSequentially(String(values[0]), { delay: 3 });
    } else {
      await input.fill(String(values[0]));
    }
    await input.blur(); // some forms record a field when you leave it
  }
}

// "Missing entry for required field: Why do you want to work at Baseten?" while the page shows an answer there:
// the form didn't record it. Put those answers in again, the slow way. Returns false when it can't.
export const missingLabels = (errs) =>
  [...new Set(errs.flatMap((e) => [...e.matchAll(/missing entry for required field:\s*([^\n]+)/gi)].map((m) => m[1].trim())))];

async function redoMissing(page, errs, ctx) {
  const labels = missingLabels(errs);
  if (!labels.length || !ctx?.form) return false;
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const redo = ctx.form.questions.filter((q) => labels.some((l) => norm(l) === norm(q.label)) && !isEmpty(ctx.answers[q.name]));
  if (redo.length < labels.length) return false; // one we have no answer for: that's for you
  for (const q of redo) {
    await answer(page, box(page, q), q, ctx.answers[q.name], true);
    await sleep(400);
  }
  await sleep(1000);
  return true;
}

export async function isDone(page) {
  if (/\/application\/?(confirmation|success|submitted)/i.test(page.url())) return true;
  // Ashby shows a green "Success" box; companies word the message their own way.
  if (await page.locator('[class*="success" i]:visible').filter({ hasText: /success|thank/i }).first().isVisible().catch(() => false)) return true;
  return page.getByText(/thank(s| you) for (applying|your (interest|application))|application (has been |was )?(submitted|received)|successfully submitted|we('ve| have) received your application/i).first().isVisible();
}

const captcha = async (page) => {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"]');
  const n = await frames.count();
  for (let i = 0; i < n; i++) if (await frames.nth(i).isVisible()) return true;
  return false;
};

const errors = (page) => visibleTexts(page.locator('[class*="_error_"], [class*="errorMessage"], [role="alert"]'), 10, 600);

// `ctx` ({ form, answers }) lets it put back answers the form says are missing, then submit again (twice at most).
export async function submit(page, ctx) {
  for (let round = 0; ; round++) {
    await page.getByRole('button', { name: /submit application/i }).click();
    const outcome = await waitOutcome(page, { isDone, captcha, errors });
    if (!outcome.errors || round >= 2 || !(await redoMissing(page, outcome.errors, ctx))) return outcome;
  }
}
