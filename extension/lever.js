// Fills a Lever application opened from Apply Desk ("Open and fill"). The answers arrive in the address after
// "#applydesk="; they're taken out right away, before Lever's own scripts run. You check the form, do the CAPTCHA
// and press Submit. When Lever shows its "thanks" page, the job is marked applied on Apply Desk (see page.js).
const JOB_KEY = 'applyDeskJob';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();

async function waitFor(get, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = get();
    if (v) return v;
    await sleep(200);
  }
  return null;
}

function whenReady(run) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

// Lever's uploader and place suggestions are wired up by its scripts after the page loads; fill once they are.
const settled = () => new Promise((resolve) => {
  const done = () => sleep(1500).then(resolve);
  if (document.readyState === 'complete') done();
  else window.addEventListener('load', done, { once: true });
});

function decode(b64url) {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Type into a box the way the page expects: its own value setter, then the events its scripts listen for.
function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Your resume, saved in the extension's options. Lever uploads it and reads it to prefill a few boxes, so it goes
// first and the answers below overwrite what it guessed.
async function attachResume(form) {
  const input = form.querySelector('input[type=file][name="resume"]');
  if (!input) return true;
  const { resume } = await chrome.storage.local.get('resume');
  if (!resume) return false;
  const bytes = Uint8Array.from(atob(resume.data), (c) => c.charCodeAt(0));
  const files = new DataTransfer();
  files.items.add(new File([bytes], resume.name, { type: resume.type || 'application/pdf' }));
  input.files = files.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const ok = await waitFor(() => [...document.querySelectorAll('.resume-upload-success')].some(shown), 25_000);
  await sleep(1500);
  return !!ok;
}

// How well a suggestion matches "City, ST": 3 = the city, 2 = the state, 1 = the country (as the helper ranks them).
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
function locationRank(option, value) {
  const [city = '', st = ''] = String(value).split(',').map((s) => s.trim());
  const state = STATES[st.toUpperCase()] || st;
  const t = option.trim().toLowerCase();
  const has = (w) => w && new RegExp(`(^|[\\s,])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s,]|$)`).test(t);
  if (city && t.startsWith(city.toLowerCase()) && (!st || has(state) || has(st))) return 3;
  if (state && new RegExp(`^${state.toLowerCase()}(,\\s*(united states( of america)?|usa?))?$`).test(t)) return 2;
  if (/^(united states( of america)?|usa?)$/.test(t)) return 1;
  return 0;
}

// Lever's location box suggests places as you type; a typed place only counts once one is picked from the list.
// It searches on a keystroke and clears unpicked text on "change", so the text goes in as a keystroke would.
async function pickLocation(form, value) {
  const input = form.querySelector('input[name="location"]');
  if (!input) return false;
  const key = value.slice(-1);
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: key, inputType: 'insertText' }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }));
  const options = await waitFor(() => {
    const list = [...document.querySelectorAll('.dropdown-location')].filter(shown);
    return list.length ? list : null;
  }, 8000);
  if (!options) return false;
  await sleep(800); // the list refreshes as results arrive
  const latest = [...document.querySelectorAll('.dropdown-location')].filter(shown);
  let best = null;
  let bestRank = 0;
  for (const o of latest) {
    const r = locationRank(text(o), value);
    if (r > bestRank) [best, bestRank] = [o, r];
  }
  if (!best) return false;
  best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  best.click();
  return true;
}

function fillField(form, f) {
  const els = [...form.querySelectorAll(`[name="${CSS.escape(f.name)}"]`)];
  if (!els.length) return false;
  if (f.type === 'text' || f.type === 'textarea') {
    setValue(els[0], String(f.value));
    return true;
  }
  const wanted = (Array.isArray(f.value) ? f.value : [f.value]).map((v) => String(v).trim());
  if (els[0].tagName === 'SELECT') {
    const opt = [...els[0].options].find((o) => o.text.trim() === wanted[0] || o.value === wanted[0]);
    if (!opt) return false;
    els[0].value = opt.value;
    els[0].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  let found = 0;
  for (const want of wanted) {
    const box = els.find((el) => el.value.trim() === want);
    if (!box) continue;
    if (!box.checked) box.click();
    found++;
  }
  return found === wanted.length;
}

// Boxes you agree to on every form ("I have read and acknowledged...", "By checking this box, I consent..."), as the
// helper ticks them. Not answer choices, not "I'm not a robot", and a text-message or marketing opt-in only when it's
// the one required box.
function tickAgreements(form) {
  const consent = /agree|consent|acknowledg|certif|attest|confirm|accept|understand|authori[sz]|i have read|checking this box|terms|privacy/i;
  const optIn = /\bsms\b|text messag|receive.{0,30}\btexts?\b|opt.?in.{0,30}(text|sms)|(text|sms).{0,30}opt.?in|newsletter|marketing|promotional/i;
  const robot = /captcha|not a robot|i('| a)?m (a )?human/i;
  const ticked = [];
  for (const box of form.querySelectorAll('input[type=checkbox]')) {
    const labels = [...(box.labels || [])];
    if (box.checked || box.disabled || !(shown(box) || labels.some(shown))) continue;
    let label = labels.map(text).join(' ');
    for (let el = box.parentElement, i = 0; !label && el && i < 4; el = el.parentElement, i++) {
      if (text(el) && text(el).length < 400) label = text(el);
    }
    const holder = box.closest('.application-question, fieldset');
    const question = text(holder?.querySelector('.application-label, legend'));
    const alone = !holder || holder.querySelectorAll('input[type=checkbox]').length === 1;
    const required = box.required || /[*✱]\s*$/.test(question);
    const both = `${label} ${question}`;
    if (robot.test(both) || /^(yes|no)( (yes|no))?$/i.test(label)) continue;
    if (optIn.test(both) ? !(required && alone) : !(consent.test(label) || (consent.test(question) && alone))) continue;
    box.click();
    ticked.push(label);
  }
  return ticked;
}

function banner(message, warn = false) {
  document.getElementById('apply-desk-banner')?.remove();
  const bar = document.createElement('div');
  bar.id = 'apply-desk-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:min(680px,calc(100vw - 32px));
    padding:12px 16px;border-radius:10px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgb(0 0 0/.25);
    background:${warn ? '#fbf0d9' : '#e2efe9'};color:${warn ? '#6b4500' : '#14402f'};display:flex;gap:12px;align-items:flex-start`;
  const words = document.createElement('div');
  words.textContent = message;
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.style.cssText = 'border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:inherit';
  close.onclick = () => bar.remove();
  bar.append(words, close);
  document.body.append(bar);
}

async function fill(job) {
  const form = await waitFor(() => document.querySelector('#application-form') || document.querySelector('form'));
  if (!form) return banner('Apply Desk couldn’t find the application form on this page.', true);
  banner(`Apply Desk is filling in your application to ${job.company}…`);
  await settled();
  const missed = [];
  if (!(await attachResume(form))) missed.push('your resume (pick it in the Apply Desk extension’s options, or attach it here)');
  for (const f of job.fields) {
    try {
      const ok = f.kind === 'location' ? await pickLocation(form, String(f.value)) : fillField(form, f);
      if (!ok) missed.push(f.kind === 'location' ? `${f.label} (pick it from Lever’s list)` : f.label);
    } catch {
      missed.push(f.label);
    }
  }
  tickAgreements(form);
  banner(missed.length
    ? `Filled in, except: ${missed.join('; ')}. Fill those, then do the CAPTCHA and press Submit.`
    : 'Filled in by Apply Desk. Check it over, do the CAPTCHA, and press Submit.', missed.length > 0);
}

// Opened from Apply Desk: take the answers out of the address before anything else sees them.
const hash = /^#applydesk=([A-Za-z0-9_-]+)$/.exec(location.hash);
if (hash) {
  history.replaceState(history.state, '', location.pathname + location.search);
  let job = null;
  try {
    job = JSON.parse(decode(hash[1]));
  } catch {
    // not ours, or cut short
  }
  if (job?.v === 1) {
    sessionStorage.setItem(JOB_KEY, JSON.stringify({ id: job.id, company: job.company }));
    whenReady(() => fill(job));
  }
} else if (/\/thanks\/?$/.test(location.pathname)) {
  // Lever took it: tell Apply Desk (page.js passes it on to the page).
  const saved = JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null');
  if (saved) {
    sessionStorage.removeItem(JOB_KEY);
    chrome.storage.local.get({ applied: [] }).then(({ applied }) =>
      chrome.storage.local.set({ applied: [...applied, { id: saved.id, at: Date.now() }] }));
    whenReady(() => banner(`Sent to ${saved.company}. Apply Desk marks it applied.`));
  }
}
