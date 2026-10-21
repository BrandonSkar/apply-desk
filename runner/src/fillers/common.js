// Shared browser helpers for the form fillers.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const byId = (id) => `[id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
export const byName = (name) => `[name="${String(name).replace(/["\\]/g, '\\$&')}"]`;

export const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// Pick an option in a searchable dropdown (react-select style: type to filter, then click an option).
export async function pickCombo(page, input, label, { search = false } = {}) {
  const text = String(label);
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill('');
  await input.pressSequentially(search ? text : text.slice(0, 40), { delay: 20 });
  // Scope to this dropdown's own list: pages can hold other hidden role=option lists (e.g. phone country pickers).
  const inputId = await input.getAttribute('id');
  const listId = (await input.getAttribute('aria-controls')) || (inputId && `react-select-${inputId}-listbox`);
  const options = listId
    ? page.locator(`${byId(listId)} [role="option"]`)
    : page.locator('[role="option"]').filter({ visible: true });
  await options.first().waitFor({ timeout: search ? 12_000 : 6_000 });
  if (search) {
    await options.first().click();
    return;
  }
  const texts = (await options.allInnerTexts()).map((t) => t.trim().toLowerCase());
  const want = text.trim().toLowerCase();
  let i = texts.indexOf(want);
  if (i < 0) i = texts.findIndex((t) => t.startsWith(want));
  if (i < 0) i = texts.findIndex((t) => t.includes(want));
  if (i < 0) throw new Error(`no option "${text}"`);
  await options.nth(i).click();
}

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// How well a suggestion matches "City, ST": 3 = the city, 2 = the state, 1 = the country, 0 = somewhere else.
export function locationRank(option, value) {
  const [city = '', st = ''] = String(value).split(',').map((s) => s.trim());
  const state = STATES[st.toUpperCase()] || st;
  const t = option.trim();
  const word = (w) => w && new RegExp(`(^|[\\s,])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s,]|$)`, 'i').test(t);
  const starts = (w) => w && t.toLowerCase().startsWith(w.toLowerCase());
  if (starts(city) && (!st || word(state) || word(st))) return 3;
  // The state itself ("Washington, United States"), not a place named after it ("Washington, District of Columbia").
  if (state && new RegExp(`^${state}(,\\s*(united states( of america)?|usa?))?$`, 'i').test(t)) return 2;
  if (/^(united states( of america)?|usa?)$/i.test(t)) return 1;
  return 0;
}

// The suggestions once they stop changing. Lists refresh per keystroke and go empty ("Loading...") in between,
// so only a non-empty list that holds steady for about a second counts.
async function settledTexts(options, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  let prev = '';
  let steady = 0;
  let texts = [];
  while (Date.now() < end) {
    texts = (await options.allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    const key = texts.join('\n');
    steady = key && key === prev ? steady + 1 : 0;
    if (steady >= 3) return texts;
    prev = key;
    await sleep(350);
  }
  return texts;
}

// Location boxes suggest places as you type, and the first suggestion isn't always yours: a box that only knows
// regions answers "Auburn, WA" with "Wales, United Kingdom". Take the closest real match (city, then state, then
// country), or stop and leave it to you.
export async function pickLocation(input, value, options) {
  const state = STATES[(String(value).split(',')[1] || '').trim().toUpperCase()];
  for (const text of [String(value), state, 'United States'].filter(Boolean)) {
    // A box that's still loading can drop the first keystrokes ("uburn, WA"); type again until it holds the text.
    for (let i = 0; i < 3; i++) {
      await input.click();
      await input.fill('');
      await input.pressSequentially(text, { delay: 25 });
      if ((await input.inputValue().catch(() => text)) === text) break;
      await sleep(700);
    }
    const texts = await settledTexts(options);
    let best = -1;
    let bestRank = 0;
    texts.forEach((t, i) => {
      const r = locationRank(t, value);
      if (r > bestRank) [best, bestRank] = [i, r];
    });
    if (best >= 0) {
      await options.nth(best).click();
      return texts[best];
    }
  }
  throw new Error(`no suggestion matched "${value}"`);
}

// Check the radio/checkbox inputs named `name` whose value is in `values`.
export async function checkValues(page, name, values) {
  const found = await page.locator(`input${byName(name)}`).evaluateAll((els, wanted) => {
    let n = 0;
    for (const el of els) {
      if (wanted.includes(el.value)) {
        if (!el.checked) el.click();
        n++;
      }
    }
    return n;
  }, values);
  if (found < values.length) throw new Error(`option not found among ${values.join(', ')}`);
}

// Uncheck any text-message opt-in a form shows on its own (some come pre-checked under the phone field).
export async function uncheckSmsOptIns(page) {
  return page.evaluate(() => {
    const sms = /\bsms\b|text messag|receive.{0,30}\btexts?\b|opt.?in.{0,30}(text|sms)|(text|sms).{0,30}opt.?in/i;
    let n = 0;
    for (const box of document.querySelectorAll('input[type=checkbox]')) {
      if (!box.checked) continue;
      let text = [...(box.labels || [])].map((l) => l.innerText).join(' ');
      // No <label>: use the nearest small container's text, never a whole section.
      for (let el = box.parentElement, i = 0; !text && el && i < 4; el = el.parentElement, i++) {
        if (el.innerText && el.innerText.length < 400) text = el.innerText;
      }
      if (sms.test(text)) {
        box.click();
        n++;
      }
    }
    return n;
  });
}

// "A verification code was sent to you@... enter the 8-character code to confirm you're a human."
// The code is for you to read and enter (on the page or in the window); the helper never reads your email.
const CODE_PROMPT = /verification code (was|has been) sent|enter the \d+-character code|security code (was|has been) sent|enter (the )?(security|verification) code/i;

export async function needsCode(page) {
  return page.getByText(CODE_PROMPT).first().isVisible();
}

// Type a code you entered into the site's code box (one box, or one box per character), then submit again.
export async function enterCode(page, code) {
  const boxes = page.locator('input[maxlength="1"]:visible');
  if ((await boxes.count()) >= code.length) {
    for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]);
  } else {
    const single = page.locator([
      'input[autocomplete="one-time-code"]:visible',
      'input[id*="code" i]:visible',
      'input[name*="code" i]:visible',
      'input[aria-label*="code" i]:visible',
      'input[id*="security" i]:visible',
    ].join(', ')).first();
    if (!(await single.count())) throw new Error('couldn’t find the code box');
    await single.fill(code);
  }
  await page.locator('button[type=submit]:visible, button:visible', { hasText: /submit|verify|confirm/i }).first().click();
}

// "We are limiting applications to give everyone a chance", "maximum number of applications": the company caps
// how many of its jobs one person can apply to.
export const COMPANY_LIMIT = /limiting applications|maximum number of (job )?applications|reached the (maximum|limit)|application limit|limit of \d+ (job )?applications|too many applications/i;

// Every visible line on the page that talks about an application limit.
export async function limitTexts(page) {
  return page.getByText(COMPANY_LIMIT).evaluateAll((els) =>
    els.filter((e) => e.getClientRects().length).map((e) => e.innerText.trim().slice(0, 200))).catch(() => []);
}

// A limit message that wasn't on the page before (`before` = limitTexts from then). Postings can state their
// limit in the description ("Application Limit: Candidates may submit a maximum of 5 applications..."); that
// line is there all along and isn't a rejection.
export async function companyLimit(page, before = []) {
  return (await limitTexts(page)).find((t) => !before.includes(t)) || '';
}

// After clicking Submit: watch for success, a code prompt, a company limit, a CAPTCHA challenge, or form errors.
export async function waitOutcome(page, { isDone, captcha, errors }, timeoutMs = 45_000) {
  const end = Date.now() + timeoutMs;
  const start = Date.now();
  // What's on the page as Submit is pressed; the site's answer takes a round trip.
  const limitBefore = await limitTexts(page);
  while (Date.now() < end) {
    if (page.isClosed()) return 'unknown';
    if (await isDone(page).catch(() => false)) return 'submitted';
    if (await needsCode(page).catch(() => false)) return 'code';
    const limited = await companyLimit(page, limitBefore);
    if (limited) return { limit: limited };
    if (await captcha(page).catch(() => false)) return 'captcha';
    if (Date.now() - start > 4000) {
      const errs = await errors(page).catch(() => []);
      if (errs.length) return { errors: errs };
    }
    await sleep(1000);
  }
  return 'unknown';
}

export async function visibleTexts(locator, max = 5) {
  const out = [];
  const n = Math.min(await locator.count(), 20);
  for (let i = 0; i < n && out.length < max; i++) {
    const el = locator.nth(i);
    if (await el.isVisible()) {
      const t = (await el.innerText()).trim();
      if (t) out.push(t.slice(0, 120));
    }
  }
  return out;
}
