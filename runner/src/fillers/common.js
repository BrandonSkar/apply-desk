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

// After clicking Submit: watch for success, a CAPTCHA challenge, or form errors.
export async function waitOutcome(page, { isDone, captcha, errors }, timeoutMs = 45_000) {
  const end = Date.now() + timeoutMs;
  const start = Date.now();
  while (Date.now() < end) {
    if (page.isClosed()) return 'unknown';
    if (await isDone(page).catch(() => false)) return 'submitted';
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
