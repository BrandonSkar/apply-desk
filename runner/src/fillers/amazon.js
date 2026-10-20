// Amazon Jobs (account.amazon.jobs). The application is a multi-step form, and your Amazon profile already
// completes most steps. Each job adds "Job-specific questions" (dropdowns) and "Work Eligibility" (Yes/No),
// which Amazon pre-fills from your earlier applications where it can.
//
// prepare(): read those questions (with Amazon's saved answers) so they can show on your page.
// fill():    put in your answers, save each step.        submit(): walk to Review & submit and submit.
import { isEmpty, sleep, visibleTexts, waitOutcome } from './common.js';

const SECTIONS = ['Job-specific questions', 'Work Eligibility'];

export class SignedOutError extends Error {}

async function open(page, job) {
  await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (/passport\.amazon\.jobs|\/(signin|login)\b/i.test(page.url())) {
    throw new SignedOutError('Signed out of Amazon Jobs. In the runner folder, stop the helper, run npm run login, and sign in again.');
  }
  // The application has a "My progress" sidebar; without it, the job is closed or already applied to.
  const sidebar = page.locator('a.nav-link', { hasText: /^Job-specific questions$|^Work Eligibility$|^Contact information$/i }).first();
  if (await sidebar.waitFor({ timeout: 20_000 }).then(() => true, () => false)) return 'form';
  const text = await page.locator('body').innerText().catch(() => '');
  if (/already applied|you have applied|application (was|has been) (submitted|received)/i.test(text)) return 'applied';
  if (/no longer (available|accepting)|job (is )?closed|not found|page you requested/i.test(text)) return 'closed';
  throw new Error('The Amazon application page didn’t load as expected.');
}

async function goTo(page, section) {
  const link = page.locator('a.nav-link', { hasText: new RegExp(`^${section}$`, 'i') }).first();
  if (!(await link.count())) return false;
  await link.click();
  await page.locator('h1, h2, h3', { hasText: new RegExp(section, 'i') }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  await sleep(1500);
  return true;
}

// Each question is a div.question with a "<id>-label" element and a select, radios, or a text box.
function readQuestions(page, section) {
  return page.evaluate((section) => {
    const seen = new Set();
    const out = [];
    const labelFor = (el) => (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || el.closest('label')?.innerText || el.value || '').trim();
    for (const q of document.querySelectorAll('div.question')) {
      if (!q.offsetParent) continue;
      const labelEl = q.querySelector('[id$="-label"]');
      if (!labelEl || seen.has(labelEl.id)) continue;
      seen.add(labelEl.id);
      const raw = labelEl.innerText.replace(/\s+/g, ' ').trim();
      const base = { domId: labelEl.id.replace(/-label$/, ''), label: raw.replace(/\s*\*\s*$/, ''), section,
        required: /\*\s*$/.test(raw) || !!q.querySelector('[aria-required="true"], [required]') };
      base.name = `amz:${base.domId}`;
      const select = q.querySelector('select');
      const radios = [...q.querySelectorAll('input[type=radio]')];
      const boxes = [...q.querySelectorAll('input[type=checkbox]')];
      const text = q.querySelector('input[type=text], input:not([type]), textarea');
      if (select) {
        const options = [...select.options].filter((o) => o.value && o.text.trim()).map((o) => ({ label: o.text.trim(), value: o.value }));
        const cur = options.find((o) => o.value === select.value);
        out.push({ ...base, type: 'select', control: 'select', options, preset: cur?.label });
      } else if (radios.length) {
        const options = radios.map((r) => ({ label: labelFor(r), value: r.value }));
        const cur = radios.findIndex((r) => r.checked);
        out.push({ ...base, type: 'select', control: 'radio', radioName: radios[0].name, options, preset: cur >= 0 ? options[cur].label : undefined });
      } else if (boxes.length) {
        const options = boxes.map((b) => ({ label: labelFor(b), value: b.value }));
        const cur = options.filter((_, i) => boxes[i].checked).map((o) => o.label);
        out.push({ ...base, type: 'multiselect', control: 'checkbox', options, preset: cur.length ? cur : undefined });
      } else if (text) {
        out.push({ ...base, type: text.tagName === 'TEXTAREA' ? 'textarea' : 'text', control: 'text', preset: text.value || undefined });
      }
    }
    return out;
  }, section);
}

export async function prepare(page, job) {
  const state = await open(page, job);
  if (state !== 'form') return { outcome: state };
  const questions = [];
  for (const section of SECTIONS) {
    if (await goTo(page, section)) questions.push(...(await readQuestions(page, section)));
  }
  return { form: { kind: 'amazon', questions, description: '' } };
}

const question = (page, q) => page.locator(`div.question:has([id="${q.domId}-label"])`).first();

async function saveStep(page, section, missing) {
  await page.locator('button.btn-primary:visible', { hasText: /^\s*continue\s*$/i }).first().click();
  await sleep(3000);
  const errs = await visibleTexts(page.locator('.invalid-feedback, .error-message, .alert-danger, [class*="error"]:not(script)'));
  if (errs.length) missing.push(...errs.map((e) => `${section}: ${e}`));
}

export async function fill(page, { job, form, answers }) {
  const state = await open(page, job);
  if (state === 'applied') return { missing: [], done: true };
  if (state === 'closed') throw new Error('This Amazon posting is closed.');
  const missing = [];
  for (const section of SECTIONS) {
    const qs = form.questions.filter((q) => q.section === section);
    if (!qs.length || !(await goTo(page, section))) continue;
    for (const q of qs) {
      const v = answers[q.name];
      if (isEmpty(v)) {
        if (q.required) missing.push(q.label);
        continue;
      }
      const labels = Array.isArray(v) ? v : [v];
      const optionFor = (label) => (q.options || []).find((o) => o.label === label);
      try {
        if (q.control === 'select') {
          const opt = optionFor(labels[0]);
          const sel = question(page, q).locator('select').first();
          await sel.selectOption(opt ? { value: opt.value } : { label: labels[0] }, { force: true });
          // The styled dropdown (select2) redraws from the real <select> on a jQuery change event.
          await sel.evaluate((el) => window.jQuery && window.jQuery(el).trigger('change'));
        } else if (q.control === 'radio') {
          const opt = optionFor(labels[0]);
          if (!opt) throw new Error(`no option "${labels[0]}"`);
          await page.locator(`input[type=radio][name="${q.radioName}"][value="${opt.value}"]`).check({ force: true });
        } else if (q.control === 'checkbox') {
          for (const label of labels) {
            const opt = optionFor(label);
            if (opt) await question(page, q).locator(`input[type=checkbox][value="${opt.value}"]`).check({ force: true });
          }
        } else {
          await question(page, q).locator('input, textarea').first().fill(String(labels[0]));
        }
      } catch (err) {
        missing.push(`${q.label} (${err.message.split('\n')[0].slice(0, 80)})`);
      }
    }
    await saveStep(page, section, missing);
  }
  return { missing };
}

export async function isDone(page) {
  if (/\/applicant\/applications|\/confirmation/i.test(page.url())) return true;
  return page.getByText(/application (has been |was )?(submitted|received)|thank(s| you) for applying|successfully (applied|submitted)/i).first().isVisible();
}

const errors = (page) => visibleTexts(page.locator('.invalid-feedback, .error-message, .alert-danger'));
const noCaptcha = async () => false;

// Walk forward through the steps your profile already completes, then submit on Review & submit.
export async function reachReview(page) {
  for (let i = 0; i < 14; i++) {
    const submitBtn = page.locator('button:visible', { hasText: /^\s*submit( application)?\s*$/i }).first();
    if (await submitBtn.count()) return submitBtn;
    const review = page.locator('a.nav-link', { hasText: /^Review & submit$/i }).first();
    if (await review.count()) {
      await review.click();
      await sleep(3000);
      continue;
    }
    const next = page.locator('button.btn-primary:visible', { hasText: /^\s*continue\s*$/i }).first();
    if (!(await next.count())) break;
    await next.click();
    await sleep(3000);
  }
  return null;
}

export async function submit(page) {
  const btn = await reachReview(page);
  if (!btn) return { errors: ['Couldn’t reach the Review & submit step. Check the helper window.'] };
  await btn.click();
  return waitOutcome(page, { isDone, captcha: noCaptcha, errors }, 60_000);
}
