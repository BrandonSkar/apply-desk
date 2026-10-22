// Microsoft Careers (apply.careers.microsoft.com, built on Eightfold). A one-page application: your Microsoft
// profile fills your name, phone and resume; each job adds its own questions. Dropdowns are text inputs (id
// "input-N") that open a list of option buttons; radios and checkboxes have stable names.
//
// prepare(): read the questions (and each dropdown's choices) so they can show on your page.
// fill():    put in your answers.        submit(): press "Submit application".
import { isEmpty, pace, settle, sleep, visibleTexts, waitOutcome } from './common.js';

export class SignedOutError extends Error {}

const applyUrl = (job) => `https://apply.careers.microsoft.com/careers/apply?pid=${job.id.split(':')[1]}`;

async function open(page, job) {
  await page.goto(applyUrl(job), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const form = page.locator('[id^="Contact_Information_"]').first();
  if (await form.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    await settle(page, 2500);
    // Scroll down through the form and back so every section has rendered before anything is looked up.
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 900);
      await sleep(300);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);
    return 'form';
  }
  const text = await page.locator('body').innerText().catch(() => '');
  if (/sign in using|create an account/i.test(text)) {
    throw new SignedOutError('Signed out of Microsoft Careers. In the runner folder, stop the helper, run npm run login, and sign in again.');
  }
  if (/already applied|you have applied|application (was|has been) submitted/i.test(text)) return 'applied';
  if (/no longer (available|accepting)|position (is )?(closed|filled)|not found/i.test(text)) return 'closed';
  // A closed posting's apply link lands on the job search instead of the application.
  if (!/\/careers\/apply/i.test(page.url()) || /sort: match score|\d[\d,]* jobs\b/i.test(text)) return 'closed';
  throw new Error('The Microsoft application page didn’t load as expected.');
}

// Every field in page order, with the section heading it sits under. Runs in the page.
function scan(page) {
  return page.evaluate(() => {
    const textOf = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    const labelOf = (el) => {
      const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      return textOf(byFor) || (el.getAttribute('aria-labelledby') || '').split(' ').map((i) => textOf(document.getElementById(i))).join(' ').trim();
    };
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The application's own form (the page header has a separate search form).
    const form = document.querySelector('[id^="Contact_Information_"]')?.closest('form') || document.body;
    const out = [];
    const groups = new Set();
    let section = '';
    for (const el of form.querySelectorAll('h2, h3, input, textarea')) {
      if (/^H[23]$/.test(el.tagName)) {
        if (el.offsetParent) section = textOf(el);
        continue;
      }
      if (el.type === 'hidden' || !el.offsetParent || el.closest('header, nav, [role=search]')) continue;
      const required = el.required || el.getAttribute('aria-required') === 'true';
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (groups.has(el.name)) continue;
        groups.add(el.name);
        const all = [...form.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)];
        const options = all.map((r) => ({ label: labelOf(r) || r.value, value: r.id }));
        // The question: from aria-label "Yes, <question>", or the wrapper's text minus the option labels.
        const aria = el.getAttribute('aria-label') || '';
        let label = aria.includes(', ') ? aria.slice(aria.indexOf(', ') + 2) : '';
        if (!label) {
          let box = el.parentElement;
          const bare = (b) => options.reduce((t, o) => t.replace(new RegExp(`\\b${esc(o.label)}\\b`, 'g'), ''), textOf(b)).trim();
          for (let i = 0; i < 8 && box && bare(box).length < 8; i++) box = box.parentElement;
          label = bare(box);
        }
        const checked = all.map((r, i) => (r.checked ? options[i].label : null)).filter(Boolean);
        out.push({ control: el.type, key: el.name, label, section, required, options,
          preset: el.type === 'radio' ? checked[0] : checked.length ? checked : undefined });
        continue;
      }
      const dropdown = /^input-\d+$/.test(el.id) || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox';
      out.push({ control: dropdown ? 'dropdown' : el.tagName === 'TEXTAREA' ? 'textarea' : 'text', key: el.id,
        label: labelOf(el) || el.getAttribute('aria-label') || '', section, required, preset: el.value || undefined });
    }
    return out;
  });
}

// Open a dropdown, return its choices, close it without choosing.
async function dropdownOptions(page, id) {
  const input = page.locator(`[id="${id}"]`);
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await sleep(700);
  const listId = await input.getAttribute('aria-controls');
  const options = listId ? await page.locator(`[id="${listId}"] [role="option"]`).allInnerTexts() : [];
  await page.keyboard.press('Escape');
  await sleep(250);
  return options.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const SKIP = /upload your resume|country code|alternate phone/i;

export async function prepare(page, job) {
  const state = await open(page, job);
  if (state !== 'form') return { outcome: state };
  const fields = await scan(page);
  const questions = [];
  const names = new Set();
  for (const f of fields) {
    if (!f.label || SKIP.test(f.label)) continue;
    let name = `ms:${f.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
    while (names.has(name)) name += '-2';
    names.add(name);
    const q = { name, label: f.label, required: !!f.required, control: f.control, key: f.key,
      section: /self-identification/i.test(f.section) ? 'demographic' : f.section };
    if (f.control === 'dropdown') {
      const opts = await dropdownOptions(page, f.key);
      q.type = 'select';
      q.options = opts.map((label) => ({ label, value: label }));
      if (f.preset && opts.includes(f.preset)) q.preset = f.preset;
    } else if (f.control === 'radio') {
      Object.assign(q, { type: 'select', options: f.options, preset: f.preset });
    } else if (f.control === 'checkbox') {
      Object.assign(q, { type: 'multiselect', options: f.options, preset: f.preset });
    } else {
      Object.assign(q, { type: f.control === 'textarea' ? 'textarea' : 'text', preset: f.preset });
    }
    questions.push(q);
  }
  if (questions.length < 5) throw new Error(`Only found ${questions.length} questions on the Microsoft form.`);
  return { form: { kind: 'microsoft', questions, description: '' } };
}

// Find a field's current id by its question text (ids like input-42 can change between page loads). Exact text
// first, then the same text give or take a "*" or a cut-off end.
function idByLabel(page, label) {
  return page.evaluate((label) => {
    const textOf = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    const norm = (s) => (s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(label);
    let loose = null;
    for (const el of document.querySelectorAll('input, textarea')) {
      if (!el.offsetParent || el.type === 'hidden' || !el.id) continue;
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const l = norm(textOf(byFor) || (el.getAttribute('aria-labelledby') || '').split(' ').map((i) => textOf(document.getElementById(i))).join(' ')
        || el.getAttribute('aria-label'));
      if (!l) continue;
      if (l === want) return el.id;
      if (!loose && (l.startsWith(want.slice(0, 60)) || want.startsWith(l.slice(0, 60)))) loose = el.id;
    }
    return loose;
  }, label);
}

// A field's id now: the one read earlier if it's still on the page, else found by its question, trying a few
// times (scrolling on) in case that part of the form is still rendering.
async function findId(page, q) {
  for (let i = 0; i < 6; i++) {
    if (q.key && !/^input-\d+$/.test(q.key) && (await page.locator(`[id="${q.key}"]`).count())) return q.key;
    const id = await idByLabel(page, q.label);
    if (id) return id;
    await page.mouse.wheel(0, 700);
    await sleep(1000);
  }
  return null;
}

// Tick a checkbox or radio. Microsoft's are custom controls that show the change a moment after the click, so
// each try waits for it before the next way of clicking (the box itself, its label, the space bar).
async function setChecked(page, input) {
  const checked = () => input.isChecked().catch(() => false);
  const id = await input.getAttribute('id');
  const ways = [
    () => input.click({ force: true }),
    () => page.locator(`label[for="${id}"]`).first().click(),
    async () => { await input.focus(); await page.keyboard.press('Space'); },
  ];
  for (const way of ways) {
    if (await checked()) return;
    await way().catch(() => {});
    for (let i = 0; i < 6 && !(await checked()); i++) await sleep(250);
  }
  if (!(await checked())) throw new Error('the box won’t stay checked');
}

// A radio or checkbox option: by the id read earlier, else by its group name and label.
async function optionInput(page, q, label) {
  const opt = (q.options || []).find((o) => o.label === label);
  if (!opt) throw new Error(`no option "${label}"`);
  const byOldId = page.locator(`[id="${opt.value}"]`);
  if (await byOldId.count()) return byOldId;
  const id = await page.evaluate(({ name, label }) => {
    const textOf = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    for (const r of document.querySelectorAll(`input[name="${CSS.escape(name)}"]`)) {
      const l = textOf(r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.value;
      if (l === label) return r.id;
    }
    return null;
  }, { name: q.key, label });
  if (!id) throw new Error('option not found');
  return page.locator(`[id="${id}"]`);
}

async function pickDropdown(page, id, label) {
  const input = page.locator(`[id="${id}"]`);
  await input.scrollIntoViewIfNeeded();
  // Open it and wait for its choices; a list that didn't open gets one more try.
  let listId = null;
  for (let i = 0; i < 2 && !listId; i++) {
    await input.click();
    await sleep(800);
    listId = await input.getAttribute('aria-controls');
    if (!listId) await page.keyboard.press('Escape');
  }
  if (!listId) throw new Error('dropdown didn’t open');
  const options = page.locator(`[id="${listId}"] [role="option"]`);
  await options.first().waitFor({ timeout: 8_000 }).catch(() => {});
  const texts = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const i = texts.indexOf(label);
  if (i < 0) throw new Error(`no option "${label}"`);
  await options.nth(i).click();
  await sleep(300);
}

export async function fill(page, { job, form, answers }) {
  const state = await open(page, job);
  if (state === 'applied') return { missing: [], done: true };
  if (state === 'closed') throw new Error('This Microsoft posting is closed.');
  const missing = [];
  for (const q of form.questions) {
    const v = answers[q.name];
    if (isEmpty(v)) {
      if (q.required && isEmpty(q.preset)) missing.push(q.label);
      continue;
    }
    const labels = Array.isArray(v) ? v : [v];
    try {
      if (q.control === 'dropdown') {
        if (q.preset === labels[0]) continue;
        const id = await findId(page, q);
        if (!id) throw new Error('field not found');
        await pickDropdown(page, id, labels[0]);
      } else if (q.control === 'radio' || q.control === 'checkbox') {
        for (const label of labels) {
          const input = await optionInput(page, q, label);
          await input.scrollIntoViewIfNeeded().catch(() => {});
          await setChecked(page, input);
          await sleep(300);
        }
      } else {
        const id = await findId(page, q);
        if (!id) throw new Error('field not found');
        const input = page.locator(`[id="${id}"]`);
        await input.scrollIntoViewIfNeeded().catch(() => {});
        // A field the site locks with a value (your Microsoft account's email) stays as the site has it.
        if (!(await input.isEditable().catch(() => false))) {
          if ((await input.inputValue().catch(() => '')).trim()) continue;
          throw new Error('field is locked');
        }
        await input.click();
        await input.fill(String(labels[0]));
        await input.blur();
      }
      await pace();
    } catch (err) {
      missing.push(`${q.label.slice(0, 80)} (${err.message.split('\n')[0].slice(0, 60)})`);
    }
  }
  return { missing };
}

export async function isDone(page) {
  if (/confirmation|thank|\/applications?\b(?!\?pid)/i.test(new URL(page.url()).pathname)) return true;
  return page.getByText(/thank you for applying|application (has been |was )?(submitted|received)|successfully (applied|submitted)|we('ve| have) received your application/i).first().isVisible();
}

const errors = (page) => visibleTexts(page.locator('[class*="error-message"], [class*="errorMessage"], [class*="field-error"], [role="alert"]'));
const noCaptcha = async () => false;

export async function submit(page) {
  await page.getByRole('button', { name: /^submit application$/i }).click();
  return waitOutcome(page, { isDone, captcha: noCaptcha, errors }, 60_000);
}
