// Fills Greenhouse application forms (job-boards.greenhouse.io). Field ids match the question names from
// Greenhouse's public API: text fields are inputs, single choices are searchable dropdowns, multi choices
// are checkboxes, demographic questions use the question id.
import { byId, checkValues, isEmpty, pickCombo, pickLocation, visibleTexts, waitOutcome } from './common.js';

export async function fill(page, { form, answers, resumePath, prefs = {} }) {
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
        await pickLocation(page.locator('#candidate-location'), v,
          page.locator('[id^="react-select-candidate-location"][id$="listbox"] [role="option"]'));
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
  await fillHistory(page, prefs.history || {}, missing);
  return { missing };
}

// Greenhouse's built-in Employment and Education sections. They aren't in the public question list,
// so they're filled from the profile whenever the form has them.
const DEGREES = [
  [/bachelor/i, "Bachelor's Degree"],
  [/master.*business|mba/i, 'Master of Business Administration (M.B.A.)'],
  [/master/i, "Master's Degree"],
  [/associate/i, "Associate's Degree"],
  [/ph\.?d|doctor of philosophy/i, 'Doctor of Philosophy (Ph.D.)'],
  [/high school|ged/i, 'High School'],
];

async function fillHistory(page, p, missing) {
  const field = async (id, label, value, kind = 'text') => {
    const el = page.locator(byId(id));
    if (!(await el.count()) || !(await el.isVisible().catch(() => false)) || (await el.isDisabled().catch(() => false))) return;
    const required = (await el.getAttribute('aria-required')) === 'true';
    try {
      if (!value) throw new Error('not in your profile');
      if (kind === 'combo' || (await el.getAttribute('role')) === 'combobox') await pickCombo(page, el, value);
      else await el.fill(String(value));
    } catch (err) {
      if (required) missing.push(`${label} (${err.message.split('\n')[0].slice(0, 60)})`);
    }
  };

  if (await page.locator(byId('company-name-0')).count()) {
    await field('company-name-0', 'Employment: company', p.current_company);
    await field('title-0', 'Employment: title', p.current_title);
    await field('start-date-month-0', 'Employment: start month', p.job_start_month, 'combo');
    await field('start-date-year-0', 'Employment: start year', p.job_start_year);
    const current = page.locator(byId('current-role-0_1'));
    if (/^\s*y/i.test(p.job_current || '') && (await current.count()) && !(await current.isChecked())) await current.check();
    // With "Current role" checked these are disabled and skipped.
    await field('end-date-month-0', 'Employment: end month', '', 'combo');
    await field('end-date-year-0', 'Employment: end year', '');
  }

  if (await page.locator(byId('school--0')).count()) {
    // Each company has its own school list; "Other" is "0 - Other" on some and "Other" on others.
    const school = page.locator(byId('school--0'));
    let picked = false;
    for (const name of [p.school, '0 - Other', 'Other'].filter(Boolean)) {
      picked = await pickCombo(page, school, name).then(() => true, () => false);
      if (picked) break;
    }
    if (!picked && (await school.getAttribute('aria-required')) === 'true') missing.push('Education: school');
  }
  const degree = DEGREES.find(([re]) => re.test(p.degree || ''))?.[1] || p.degree;
  await field('degree--0', 'Education: degree', degree, 'combo');
  // Greenhouse's list of fields has no "Software Development"; Computer Science is the closest it offers.
  const discipline = page.locator(byId('discipline--0'));
  if (p.discipline && (await discipline.count()) && (await discipline.isVisible().catch(() => false))) {
    let picked = false;
    for (const name of [...new Set([p.discipline, 'Computer Science'])]) {
      picked = await pickCombo(page, discipline, name).then(() => true, () => false);
      if (picked) break;
    }
    if (!picked && (await discipline.getAttribute('aria-required')) === 'true') missing.push('Education: field of study');
  }
  await field('end-year--0', 'Education: graduation year', p.grad_year);
  await field('end-month--0', 'Education: graduation month', '', 'combo');
  await field('start-year--0', 'Education: start year', '');
  await field('start-month--0', 'Education: start month', '', 'combo');
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
