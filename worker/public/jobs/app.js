// Apply Desk page. Plain JS, no build step. Everything from job sites is inserted as text, never HTML.

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'href' && !/^(https?:\/\/|\/)/i.test(String(v))) continue; // links come from job sites
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/jobs/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/jobs/login';
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

const post = (path, body = {}) => api(path, { method: 'POST', body });

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'bad' ? 6000 : 3500);
}

const SOURCE_NAMES = { greenhouse: 'Greenhouse', lever: 'Lever', amazon: 'Amazon', microsoft: 'Microsoft' };

// ---------- header ----------

let lastState = null;

async function loadState() {
  try {
    const s = await api(`/state?since=${encodeURIComponent(startOfToday())}`);
    lastState = s;
    const sent = s.counts.sent_today;
    $('#goal-count').textContent = sent;
    $('#goal-target').textContent = s.goal;
    $('#goal-fill').style.width = `${Math.min(100, (sent / Math.max(1, s.goal)) * 100)}%`;

    const seen = s.runner?.seen ? Date.now() - Date.parse(s.runner.seen) : Infinity;
    const on = seen < 2 * 60 * 1000;
    const waiting = s.counts.ready + s.counts.submitting;
    $('#helper').classList.toggle('on', on);
    $('#helper-text').textContent = on
      ? waiting ? `Helper: ${waiting} to submit` : 'Helper running'
      : waiting ? `Helper offline · ${waiting} waiting` : 'Helper offline';

    // A code someone's waiting on comes first; otherwise any notice from the helper (e.g. signed out of Amazon).
    const codes = s.counts.needs_code;
    const text = codes === 1
      ? 'An application is waiting for the verification code the site emailed you.'
      : codes > 1 ? `${codes} applications are waiting for verification codes the sites emailed you.` : s.alert?.text || '';
    $('#alert').hidden = !text;
    $('#alert-text').textContent = text;
    $('#alert-go').hidden = !codes;

    $('#n-queue').textContent = s.counts.queue_auto || '';
    $('#n-attn').textContent = s.counts.needs_you + s.counts.failed || '';
    return s;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ---------- tabs ----------

const TABS = { queue: renderQueue, sent: renderSent, profile: renderProfile, settings: renderSettings };
let activeTab = 'queue';

function showTab(name) {
  if (!TABS[name]) name = 'queue';
  activeTab = name;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const key of Object.keys(TABS)) $(`#tab-${key}`).hidden = key !== name;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  TABS[name]();
}

for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#alert-go').addEventListener('click', () => {
  showTab('sent');
  setTimeout(() => $('#tab-sent .codebox input')?.focus(), 400);
});

// ---------- queue ----------

let current = null;

async function renderQueue() {
  const panel = $('#tab-queue');
  panel.replaceChildren(h('div', { class: 'loading' }, 'Finding the next job…'));
  try {
    current = await api('/next?lane=auto');
  } catch (err) {
    panel.replaceChildren(errorCard(err));
    return;
  }
  if (!current.job) {
    panel.replaceChildren(emptyQueue(current.note));
    return;
  }
  panel.replaceChildren(jobCard(current));
  const first = panel.querySelector('.qsection .field input, .qsection .field textarea, .qsection .field select');
  if (first && matchMedia('(min-width: 700px)').matches) first.focus({ preventScroll: true });
}

function jobMeta(job) {
  return h('div', { class: 'job-meta' },
    h('span', { class: 'company' }, job.company),
    job.location && h('span', {}, job.location),
    job.remote && h('span', { class: 'badge remote' }, 'Remote'),
    job.posted_at && h('span', {}, `Posted ${ago(job.posted_at)}`),
    h('span', { class: 'badge' }, SOURCE_NAMES[job.source] || job.source),
  );
}

function jobCard({ job, form, fill }) {
  const groups = { open: [], suggested: [], auto: [], optional: [] };
  for (const q of form.questions) groups[fill.bucket[q.name] || (q.required ? 'open' : 'optional')].push(q);

  const formEl = h('form', { class: 'qform', novalidate: true, onsubmit: (e) => { e.preventDefault(); sendCurrent(formEl); } });

  if (groups.open.length) {
    formEl.append(h('div', { class: 'qsection' }, h('h3', {}, 'Questions for you'), groups.open.map((q) => field(q, fill.values[q.name]))));
  } else {
    formEl.append(h('p', { class: 'all-set' }, 'Nothing new to answer. Glance over the prefilled answers, then send.'));
  }
  if (groups.suggested.length) {
    formEl.append(h('div', { class: 'qsection' },
      h('h3', {}, 'Check these'),
      h('p', { class: 'muted' }, 'Best guesses for questions you haven’t answered before. Already filled in, so only change what’s wrong.'),
      groups.suggested.map((q) => field(q, fill.values[q.name]))));
  }
  if (groups.optional.length) {
    formEl.append(h('details', { class: 'qgroup' },
      h('summary', {}, `Optional questions (${groups.optional.length})`),
      groups.optional.map((q) => field(q, fill.values[q.name]))));
  }
  if (groups.auto.length) {
    formEl.append(h('details', { class: 'qgroup' },
      h('summary', {}, `Already answered: your profile and past answers (${groups.auto.length})`),
      groups.auto.map((q) => field(q, fill.values[q.name]))));
  }

  formEl.append(h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => moveOn(job, 'skipped', 'Skipped') }, 'Skip'),
    h('button', { type: 'button', class: 'btn', onclick: () => moveOn(job, 'later', 'Moved to the back of the queue') }, 'Later'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'hint' }, 'Ctrl + Enter'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Send & next →'),
  ));

  return h('article', { class: 'card' },
    jobMeta(job),
    h('h2', { class: 'job-title' }, h('a', { href: job.url, target: '_blank', rel: 'noopener noreferrer' }, job.title)),
    form.description && h('details', { class: 'desc' }, h('summary', {}, 'Job description'), h('div', { class: 'desc-body' }, form.description)),
    formEl,
  );
}

let fieldSeq = 0;

function field(q, value) {
  const id = `f${++fieldSeq}`;
  const wrap = h('div', { class: 'field', 'data-name': q.name, 'data-type': q.type, 'data-required': q.required ? '1' : '' });
  const labelText = [q.label, q.required && h('span', { class: 'req', 'aria-hidden': 'true' }, '*')];
  const help = q.help ? h('div', { class: 'help' }, q.help) : '';

  if (q.type === 'file') {
    wrap.dataset.type = 'file';
    wrap.append(h('div', { class: 'label' }, labelText),
      h('div', { class: 'note-file' }, q.kind === 'resume'
        ? 'Your resume. The helper attaches it from your PC.'
        : 'This one needs a file. The helper will stop here so you can attach it.'));
    return wrap;
  }

  if (q.type === 'select' || q.type === 'multiselect') {
    const multi = q.type === 'multiselect';
    const opts = q.options || [];
    const chosen = new Set(Array.isArray(value) ? value : value ? [value] : []);
    const short = opts.length <= 6 && opts.every((o) => o.label.length <= 60);
    if (!multi && !short) {
      const sel = h('select', { id, 'aria-required': q.required ? 'true' : null },
        h('option', { value: '' }, 'Choose…'),
        opts.map((o) => h('option', { value: o.label, selected: chosen.has(o.label) }, o.label)));
      wrap.append(h('label', { for: id }, labelText), help, sel);
      return wrap;
    }
    const stack = opts.some((o) => o.label.length > 24) || opts.length > 4;
    const group = h('div', { class: `choices${stack ? ' stack' : ''}`, role: multi ? 'group' : 'radiogroup', 'aria-labelledby': `${id}-l` },
      opts.map((o) => h('label', { class: 'choice' },
        h('input', { type: multi ? 'checkbox' : 'radio', name: id, value: o.label, checked: chosen.has(o.label) }),
        h('span', {}, o.label))));
    wrap.append(h('div', { class: 'label', id: `${id}-l` }, labelText), help, group);
    return wrap;
  }

  const input = q.type === 'textarea'
    ? h('textarea', { id, rows: 4 })
    : h('input', { id, type: 'text', autocomplete: 'off' });
  input.value = typeof value === 'string' ? value : '';
  if (q.required) input.setAttribute('aria-required', 'true');
  wrap.append(h('label', { for: id }, labelText), help, input);
  return wrap;
}

function readFields(root) {
  const answers = {};
  for (const wrap of root.querySelectorAll('.field')) {
    const { name, type } = wrap.dataset;
    if (type === 'file') continue;
    if (type === 'select' || type === 'multiselect') {
      const sel = wrap.querySelector('select');
      if (sel) answers[name] = sel.value || null;
      else {
        const picked = [...wrap.querySelectorAll('input:checked')].map((i) => i.value);
        answers[name] = type === 'multiselect' ? picked : picked[0] || null;
      }
    } else {
      answers[name] = wrap.querySelector('input, textarea').value;
    }
  }
  return answers;
}

function markMissing(root, names) {
  for (const wrap of root.querySelectorAll('.field')) {
    wrap.classList.remove('invalid');
    wrap.querySelector('.err')?.remove();
  }
  let first = null;
  for (const wrap of root.querySelectorAll('.field')) {
    if (!names.has(wrap.dataset.name)) continue;
    wrap.classList.add('invalid');
    wrap.append(h('div', { class: 'err' }, 'Needs an answer'));
    wrap.closest('details')?.setAttribute('open', '');
    first ||= wrap;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  first?.querySelector('input, textarea, select')?.focus({ preventScroll: true });
}

async function sendCurrent(formEl) {
  if (!current?.job) return;
  const answers = readFields(formEl);
  const missing = new Set();
  for (const wrap of formEl.querySelectorAll('.field[data-required="1"]')) {
    const v = answers[wrap.dataset.name];
    if (wrap.dataset.type !== 'file' && (v == null || v === '' || (Array.isArray(v) && !v.length))) missing.add(wrap.dataset.name);
  }
  if (missing.size) {
    markMissing(formEl, missing);
    toast(`${missing.size} required question${missing.size === 1 ? '' : 's'} still empty`, 'bad');
    return;
  }
  const btn = formEl.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await post(`/jobs/${encodeURIComponent(current.job.id)}/answers`, { answers });
    toast(`Sent: ${current.job.company} · ${current.job.title}`);
    loadState();
    renderQueue();
  } catch (err) {
    btn.disabled = false;
    if (err.data?.missing) {
      const labels = new Set(err.data.missing);
      const names = new Set(current.form.questions.filter((q) => labels.has(q.label)).map((q) => q.name));
      markMissing(formEl, names);
    }
    toast(err.message, 'bad');
  }
}

async function moveOn(job, status, msg) {
  try {
    await post(`/jobs/${encodeURIComponent(job.id)}/status`, { status });
    toast(msg);
    loadState();
    renderQueue();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

document.addEventListener('keydown', (e) => {
  if (activeTab === 'queue' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    const f = $('#tab-queue form.qform');
    if (f) {
      e.preventDefault();
      sendCurrent(f);
    }
  }
});

function emptyQueue(note) {
  const r = lastState?.refresh;
  const status = h('p', { class: 'muted small' },
    r?.lastCycleAt ? `Last full check of every company ${ago(r.lastCycleAt)}.` : 'The first check of every company is still running.',
    ' New jobs are pulled in automatically every few minutes.');
  const progress = h('div', { class: 'progress', hidden: true }, h('div'));
  const btn = h('button', { class: 'btn btn-primary', onclick: async () => {
    btn.disabled = true;
    progress.hidden = false;
    const added = await runRefresh((p) => (progress.firstChild.style.width = `${p * 100}%`));
    toast(added ? `Found ${added} new job${added === 1 ? '' : 's'}` : 'No new matching jobs right now');
    loadState();
    renderQueue();
  } }, 'Check every company now');
  // Amazon and Microsoft jobs reach the queue once the helper has read their questions (a few at a time).
  const lined = lastState?.counts.queue_manual || 0;
  const helperOn = lastState?.runner?.seen && Date.now() - Date.parse(lastState.runner.seen) < 2 * 60 * 1000;
  const sites = lined > 0 && h('p', { class: 'small muted' }, helperOn
    ? `${lined} Amazon and Microsoft job${lined === 1 ? ' is' : 's are'} lined up. The helper reads a few at a time, so more show up here every couple of minutes.`
    : `${lined} Amazon and Microsoft job${lined === 1 ? ' is' : 's are'} waiting. Start the helper on your PC to bring them in.`);
  return h('div', { class: 'card center' },
    h('h2', {}, 'You’re caught up'),
    note && h('p', { class: 'muted' }, note),
    status, sites, btn, progress);
}

async function runRefresh(onProgress = () => {}) {
  let added = 0;
  let first;
  try {
    first = await post('/refresh');
  } catch (err) {
    toast(err.message, 'bad');
    return 0;
  }
  added += first.added;
  const runs = Math.ceil(first.total / 3);
  onProgress(1 / runs);
  for (let i = 1; i < runs; i++) {
    try {
      const r = await post('/refresh');
      added += r.added;
    } catch (err) {
      console.error(err);
    }
    onProgress((i + 1) / runs);
  }
  return added;
}

function errorCard(err) {
  return h('div', { class: 'card' }, h('p', {}, 'Something went wrong: ', err.message),
    h('button', { class: 'btn', onclick: () => TABS[activeTab]() }, 'Try again'));
}

// ---------- Sent ----------

const STATUS = {
  ready: ['Waiting for helper', ''],
  submitting: ['Submitting…', ''],
  submitted: ['Submitted', 'good'],
  applied_manual: ['Applied (by you)', 'good'],
  needs_you: ['Needs you', 'warn'],
  failed: ['Didn’t go through', 'bad'],
};

async function renderSent() {
  const panel = $('#tab-sent');
  if (!panel.childElementCount) panel.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  let data;
  try {
    data = await api('/jobs?view=sent');
  } catch (err) {
    panel.replaceChildren(errorCard(err));
    return;
  }
  if (!data.jobs.length) {
    panel.replaceChildren(h('div', { class: 'card center muted' }, 'Nothing sent yet. Applications you send show up here with their status.'));
    return;
  }
  const attention = data.jobs.filter((j) => j.status === 'needs_you' || j.status === 'failed');
  const rest = data.jobs.filter((j) => !attention.includes(j));
  const out = [];
  if (attention.length) {
    out.push(h('div', { class: 'list-head' }, 'Needs your attention'), h('div', { class: 'list' }, attention.map(sentRow)));
  }
  out.push(h('div', { class: 'list-head' }, `Sent (${rest.length})`), h('div', { class: 'list' }, rest.map(sentRow)));
  panel.replaceChildren(...out);
}

function codeBox(job) {
  const input = h('input', {
    type: 'text', autocomplete: 'one-time-code', autocapitalize: 'off', spellcheck: 'false',
    maxlength: 12, placeholder: 'Code', 'aria-label': `Verification code for ${job.company}`,
  });
  const send = async () => {
    try {
      await post(`/jobs/${encodeURIComponent(job.id)}/code`, { code: input.value.trim() });
      toast('Code sent. The helper will enter it and submit.');
      loadState();
      renderSent();
    } catch (err) {
      toast(err.message, 'bad');
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && send());
  return h('div', { class: 'codebox' }, input, h('button', { class: 'btn btn-small btn-primary', onclick: send }, 'Send code'));
}

function sentRow(job) {
  const [label, tone] = job.needs === 'code' ? ['Needs your code', 'warn'] : STATUS[job.status] || [job.status, ''];
  const when = job.submitted_at || job.sent_at || job.updated_at;
  const acts = [];
  const act = (text, status, primary) =>
    h('button', { class: `btn btn-small${primary ? ' btn-primary' : ''}`, onclick: async () => {
      try {
        await post(`/jobs/${encodeURIComponent(job.id)}/status`, { status });
        loadState();
        renderSent();
      } catch (err) {
        toast(err.message, 'bad');
      }
    } }, text);
  if (job.status === 'needs_you' || job.status === 'failed') {
    acts.push(act('Retry', 'ready', true), act('I finished it', 'submitted'),
      h('a', { class: 'btn btn-small', href: job.apply_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open form ↗'));
  }
  if (job.status === 'ready') acts.push(act('Undo', 'new'));
  return h('div', { class: 'row' },
    h('div', { class: 'main' },
      h('a', { class: 'title', href: job.url, target: '_blank', rel: 'noopener noreferrer' }, job.title),
      h('div', { class: 'sub' }, [job.company, job.location, when && ago(when)].filter(Boolean).join(' · ')),
      job.note && h('div', { class: 'rnote' }, job.note),
      job.needs === 'code' && codeBox(job)),
    h('div', { class: 'acts' }, h('span', { class: `chip ${tone}` }, label), acts));
}

// ---------- Profile ----------

const YES_NO = new Set(['work_authorized', 'needs_sponsorship', 'willing_to_relocate', 'sms_opt_in', 'government_ties', 'job_current']);

async function renderProfile() {
  const panel = $('#tab-profile');
  panel.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  let data;
  try {
    data = await api('/profile');
  } catch (err) {
    panel.replaceChildren(errorCard(err));
    return;
  }
  const groups = new Map();
  for (const [key, label, group] of data.fields) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([key, label]);
  }
  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const body = {};
    for (const el of form.querySelectorAll('[name]')) body[el.name] = el.value;
    try {
      await api('/profile', { method: 'PUT', body });
      toast('Profile saved');
      loadState();
    } catch (err) {
      toast(err.message, 'bad');
    }
  } });
  form.append(h('p', { class: 'muted small' },
    'Used to fill in applications. Your resume file stays on your PC: the helper attaches it from the path in its config.'));
  for (const [group, fields] of groups) {
    const fs = h('fieldset', {}, h('legend', {}, group));
    if (group === 'Voluntary self-ID') fs.append(h('p', { class: 'muted small' }, 'Leave these as “Decline” to answer “I don’t wish to answer” wherever it’s offered.'));
    const grid = h('div', { class: 'grid' });
    for (const [key, label] of fields) {
      const id = `p-${key}`;
      const value = data.profile[key] ?? '';
      const input = YES_NO.has(key)
        ? h('select', { id, name: key }, ['Yes', 'No'].map((v) => h('option', { value: v, selected: value === v }, v)))
        : h('input', { id, name: key, type: 'text', autocomplete: 'off' });
      if (!YES_NO.has(key)) input.value = value;
      grid.append(h('div', { class: `field${key === 'address' ? ' wide' : ''}` }, h('label', { for: id }, label), input));
    }
    fs.append(grid);
    form.append(fs);
  }
  form.append(h('div', { class: 'actions' }, h('span', { class: 'spacer' }), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save profile')));
  panel.replaceChildren(form);
}

// ---------- Settings ----------

async function renderSettings() {
  const panel = $('#tab-settings');
  panel.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  let s;
  try {
    s = await api('/settings');
  } catch (err) {
    panel.replaceChildren(errorCard(err));
    return;
  }
  const lines = (name, label, help, rows = 6) => {
    const ta = h('textarea', { id: `s-${name}`, name, rows });
    ta.value = (s[name] || []).join('\n');
    return h('div', { class: 'field' }, h('label', { for: `s-${name}` }, label), help && h('div', { class: 'help' }, help), ta);
  };
  const number = (name, label) => {
    const el = h('input', { id: `s-${name}`, name, type: 'number', min: 1 });
    el.value = s[name];
    return h('div', { class: 'field' }, h('label', { for: `s-${name}` }, label), el);
  };
  const remote = h('input', { type: 'checkbox', id: 's-remote', checked: s.remoteUS });

  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const body = { ...s, remoteUS: remote.checked };
    for (const el of form.querySelectorAll('textarea[name]')) body[el.name] = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
    for (const el of form.querySelectorAll('input[type=number]')) body[el.name] = Number(el.value);
    try {
      await api('/settings', { method: 'PUT', body });
      toast('Settings saved. New searches use them from the next refresh.');
      loadState();
    } catch (err) {
      toast(err.message, 'bad');
    }
  } },
  h('fieldset', {}, h('legend', {}, 'Goal and freshness'),
    h('div', { class: 'grid' }, number('dailyGoal', 'Applications per day'), number('maxAgeDays', 'Only jobs posted in the last N days'))),
  h('fieldset', {}, h('legend', {}, 'Where'),
    h('label', { class: 'check' }, remote, 'Include remote jobs anywhere in the US'),
    lines('areas', 'Seattle-area places', 'One per line. Jobs whose location mentions one of these count as local.', 5)),
  h('fieldset', {}, h('legend', {}, 'Companies'),
    lines('greenhouse', 'Greenhouse companies', 'The company’s Greenhouse board name: the part after job-boards.greenhouse.io/ in its job links.', 8),
    lines('lever', 'Lever companies', 'The part after jobs.lever.co/ in its job links.', 4)),
  h('details', { class: 'qgroup' }, h('summary', {}, 'Job title rules (advanced)'),
    lines('titleInclude', 'Titles to include', 'Patterns (regular expressions). A title matches if any part matches one.', 8),
    lines('levelExclude', 'Too-senior words', null, 4),
    lines('hardExclude', 'Always skip titles with', null, 4)),
  h('div', { class: 'actions' }, h('span', { class: 'spacer' }), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save settings')));

  const r = lastState?.refresh;
  const progress = h('div', { class: 'progress', hidden: true }, h('div'));
  const refreshBtn = h('button', { class: 'btn', onclick: async () => {
    refreshBtn.disabled = true;
    progress.hidden = false;
    const added = await runRefresh((p) => (progress.firstChild.style.width = `${p * 100}%`));
    toast(added ? `Found ${added} new job${added === 1 ? '' : 's'}` : 'No new matching jobs right now');
    refreshBtn.disabled = false;
    loadState();
  } }, 'Check every company now');

  const refreshCard = h('div', { class: 'card' },
    h('h3', {}, 'Job refresh'),
    h('p', { class: 'muted small' },
      r?.lastCycleAt ? `Last full check ${ago(r.lastCycleAt)}. ` : '',
      r ? `Working through source ${r.cursor || 0} of ${r.total}.` : 'Not started yet.'),
    r?.errors?.length ? h('details', {}, h('summary', {}, `Recent errors (${r.errors.length})`), h('pre', { class: 'code' }, r.errors.join('\n'))) : null,
    refreshBtn, progress);

  const helperCard = h('div', { class: 'card' },
    h('h3', {}, 'The helper on your PC'),
    h('p', { class: 'muted small' }, 'It submits what you send from this page, using a Chrome window it controls. Start it from the project folder:'),
    h('pre', { class: 'code' }, 'cd runner\nnpm start'),
    h('p', { class: 'muted small' }, 'If a site shows a CAPTCHA, the helper waits for you to solve it in that window.'),
    h('p', {}, h('a', { href: '/jobs/logout', class: 'linkish' }, 'Sign out')));

  panel.replaceChildren(form, refreshCard, helperCard);
}

// ---------- start ----------

await loadState();
showTab(location.hash.slice(1) || 'queue');
setInterval(async () => {
  await loadState();
  if (activeTab === 'sent' && !document.hidden) renderSent();
}, 20000);
