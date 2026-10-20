// Loads a job's application questions and normalizes them to one shape:
// { name, domId?, label, type: text|textarea|select|multiselect|file, required, options?: [{label, value}],
//   kind?: resume|cover_letter|location|file, section?, help? }
// Only Greenhouse and Lever publish their forms; Amazon and Microsoft need a login, so they return null.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyDesk/1.0 (+https://brandonskar.com/jobs)';

export class JobClosedError extends Error {}

export async function loadForm(job) {
  const loaders = { greenhouse: greenhouseForm, lever: leverForm, ashby: ashbyForm };
  const form = loaders[job.source] ? await loaders[job.source](job) : null;
  for (const q of form?.questions || []) q.label = String(q.label || '').replace(/\s+/g, ' ').trim() || q.name;
  return form;
}

// ---------- Greenhouse ----------

const GH_TYPES = {
  input_text: 'text',
  textarea: 'textarea',
  multi_value_single_select: 'select',
  multi_value_multi_select: 'multiselect',
  input_file: 'file',
};

async function greenhouseForm(job) {
  const [, board, jid] = job.id.split(':');
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${jid}?questions=true`, {
    headers: { 'user-agent': UA },
  });
  if (res.status === 404) throw new JobClosedError('posting closed');
  if (!res.ok) throw new Error(`Greenhouse returned ${res.status}`);
  const d = await res.json();

  const questions = [];
  for (const q of d.questions || []) {
    const fields = (q.fields || []).filter((f) => f.type !== 'input_hidden');
    const names = fields.map((f) => f.name);
    if (names.includes('resume')) {
      questions.push({ name: 'resume', label: q.label, type: 'file', kind: 'resume', required: !!q.required });
      continue;
    }
    if (names.includes('cover_letter')) {
      // Optional cover letters are left out; a required one becomes a text box.
      if (q.required) questions.push({ name: 'cover_letter_text', label: q.label, type: 'textarea', kind: 'cover_letter', required: true });
      continue;
    }
    if (fields[0]) questions.push(ghField(fields[0], q.label, q.required, q.description));
  }
  for (const q of d.location_questions || []) {
    if ((q.fields || []).some((f) => f.name === 'location')) {
      questions.push({ name: 'location', label: q.label || 'Location', type: 'text', kind: 'location', required: !!q.required });
    }
  }
  for (const block of d.compliance || []) {
    for (const q of block.questions || []) {
      for (const f of q.fields || []) {
        if (f.type !== 'input_hidden') questions.push({ ...ghField(f, q.label, q.required), section: 'demographic' });
      }
    }
  }
  for (const q of d.demographic_questions?.questions || []) {
    questions.push({
      name: `demographic_${q.id}`,
      domId: String(q.id),
      label: q.label,
      type: q.type === 'multi_value_multi_select' ? 'multiselect' : 'select',
      required: !!q.required,
      options: (q.answer_options || []).map((o) => ({ label: o.label, value: String(o.id) })),
      section: 'demographic',
    });
  }
  return { kind: 'greenhouse', questions, description: htmlToText(decodeEntities(d.content || '')) };
}

function ghField(f, label, required, description) {
  const type = GH_TYPES[f.type] || 'text';
  const q = { name: f.name, domId: f.name.replace(/\[\]$/, ''), label, type, required: !!required };
  if (f.values?.length) q.options = f.values.map((v) => ({ label: v.label, value: String(v.value) }));
  if (type === 'file') q.kind = 'file';
  if (description) q.help = htmlToText(decodeEntities(description)).slice(0, 400);
  return q;
}

// ---------- Lever ----------

const LEVER_TYPES = {
  text: 'text',
  textarea: 'textarea',
  'multiple-choice': 'select',
  dropdown: 'select',
  'multiple-select': 'multiselect',
  'file-upload': 'file',
};

const LEVER_STANDARD = [
  // name, label, type, always required, kind
  ['resume', 'Resume/CV', 'file', true, 'resume'],
  ['name', 'Full name', 'text', true],
  ['email', 'Email', 'text', true],
  ['phone', 'Phone', 'text', false],
  ['location', 'Current location', 'text', false, 'location'],
  ['org', 'Current company', 'text', false],
  ['urls[LinkedIn]', 'LinkedIn URL', 'text', false],
  ['urls[GitHub]', 'GitHub URL', 'text', false],
  ['urls[Portfolio]', 'Portfolio URL', 'text', false],
  ['urls[Other]', 'Other website', 'text', false],
];

const EEO_LABELS = { gender: 'Gender', race: 'Race', veteran: 'Veteran status', disability: 'Disability status' };

async function leverForm(job) {
  const [, board, pid] = job.id.split(':');
  const res = await fetch(job.apply_url, { headers: { 'user-agent': UA } });
  if (res.status === 404) throw new JobClosedError('posting closed');
  if (!res.ok) throw new Error(`Lever returned ${res.status}`);
  const html = await res.text();

  const questions = [];
  for (const [name, label, type, req, kind] of LEVER_STANDARD) {
    if (!html.includes(`name="${name}"`)) continue;
    questions.push({ name, label, type, required: req || hasRequiredAttr(html, name), ...(kind ? { kind } : {}) });
  }

  const cardRe = /<input[^>]*name="cards\[([^\]]+)\]\[baseTemplate\]"[^>]*>/g;
  for (const m of html.matchAll(cardRe)) {
    const value = /value="([^"]*)"/.exec(m[0]);
    if (!value) continue;
    let card;
    try {
      card = JSON.parse(decodeEntities(value[1]));
    } catch {
      continue;
    }
    (card.fields || []).forEach((f, i) => {
      const type = LEVER_TYPES[f.type] || 'text';
      const q = { name: `cards[${m[1]}][field${i}]`, label: f.text, type, required: !!f.required, section: card.text };
      if (f.options?.length) q.options = f.options.map((o) => ({ label: o.text, value: o.text }));
      if (type === 'file') q.kind = 'file';
      if (f.description) q.help = f.description.slice(0, 400);
      questions.push(q);
    });
  }

  const selectRe = /<select[^>]*name="(eeo\[([^\]]+)\])"[^>]*>([\s\S]*?)<\/select>/g;
  for (const m of html.matchAll(selectRe)) {
    const options = [...m[3].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
      .filter((o) => o[1])
      .map((o) => ({ label: decodeEntities(o[2]).trim(), value: decodeEntities(o[1]) }));
    questions.push({ name: m[1], label: EEO_LABELS[m[2]] || m[2], type: 'select', required: false, options, section: 'demographic' });
  }

  if (html.includes('name="comments"')) {
    questions.push({ name: 'comments', label: 'Additional information', type: 'textarea', required: false });
  }

  let description = '';
  try {
    const p = await (await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board)}/${pid}`, { headers: { 'user-agent': UA } })).json();
    const lists = (p.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
    description = [p.descriptionPlain, lists, p.additionalPlain].filter(Boolean).join('\n\n');
  } catch {
    // The description is a nice-to-have.
  }
  return { kind: 'lever', questions, description: description.trim() };
}

// ---------- Ashby ----------
// The application page loads its questions from this public GraphQL query; each field has a path (its id on the
// page), a type, and its choices. Voluntary self-ID comes as a separate "survey" form.

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id title descriptionHtml
    applicationForm { sections { title isHidden fieldEntries { id field isRequired isHidden descriptionHtml } } }
    surveyForms { sections { title isHidden fieldEntries { id field isRequired isHidden descriptionHtml } } }
  }
}`;

const ASHBY_TYPES = {
  String: 'text', Email: 'text', Phone: 'text', Number: 'text', Location: 'text', Date: 'text',
  LongText: 'textarea', Boolean: 'select', ValueSelect: 'select', MultiValueSelect: 'multiselect', File: 'file',
};

async function ashbyForm(job) {
  const [, board, pid] = job.id.split(':');
  const res = await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ operationName: 'ApiJobPosting', variables: { organizationHostedJobsPageName: board, jobPostingId: pid }, query: ASHBY_QUERY }),
  });
  if (!res.ok) throw new Error(`Ashby returned ${res.status}`);
  const jp = (await res.json()).data?.jobPosting;
  if (!jp) throw new JobClosedError('posting closed');

  const questions = [];
  const add = (entry, section) => {
    const f = entry.field;
    const type = f && ASHBY_TYPES[f.type];
    if (!type || entry.isHidden) return;
    const q = { name: f.path, path: f.path, label: f.title, type, required: !!entry.isRequired, ashbyType: f.type };
    if (section) q.section = section;
    if (f.type === 'Boolean') q.options = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
    if (f.selectableValues?.length) q.options = f.selectableValues.map((v) => ({ label: v.label, value: String(v.value) }));
    if (f.path === '_systemfield_resume') q.kind = 'resume';
    else if (f.type === 'File') q.kind = 'file';
    if (f.type === 'Location') q.kind = 'location';
    if (f.type === 'Date') q.kind = 'date';
    if (entry.descriptionHtml) q.help = htmlToText(entry.descriptionHtml).slice(0, 400);
    questions.push(q);
  };
  for (const s of jp.applicationForm?.sections || []) if (!s.isHidden) for (const e of s.fieldEntries || []) add(e);
  for (const sf of jp.surveyForms || []) for (const s of sf.sections || []) if (!s.isHidden) for (const e of s.fieldEntries || []) add(e, 'demographic');
  return { kind: 'ashby', questions, description: htmlToText(jp.descriptionHtml || '') };
}

function hasRequiredAttr(html, name) {
  const esc = name.replace(/[[\]]/g, '\\$&');
  const tag = new RegExp(`<(input|textarea|select)[^>]*name="${esc}"[^>]*>`).exec(html);
  return !!tag && /\srequired(\s|=|>|\/)/.test(tag[0]);
}

// ---------- text helpers ----------

export function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
}
