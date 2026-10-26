// Fetches job listings from the sources and returns them in one shape:
// { id, source, board, company, title, location, remote, country, url, apply_url, posted_at, min_years }
// min_years (smallest experience requirement) is read here when the listing includes the description;
// for Greenhouse it's read later, when the job's form is loaded.
import { requiredYears } from './filters.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyDesk/1.0 (+https://brandonskar.com/jobs)';

// With the ETag from last time, an unchanged board answers 304 and sends nothing: { notModified: true }. fetch adds
// "Cache-Control: no-cache" to a request with an ETag unless it already has one, and Lever then always resends.
async function getJSON(url, etag) {
  const conditional = etag ? { 'if-none-match': etag, 'cache-control': 'max-age=0' } : {};
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...conditional } });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  try {
    return { data: JSON.parse(text), etag: res.headers.get('etag') };
  } catch {
    throw new Error(`not JSON from ${new URL(url).host}: ${text.slice(0, 60)}`);
  }
}

const titleCase = (s) => s.replace(/(^|[-_ ])(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());
// Board names that don't title-case into the company's real name.
const NAMES = {
  openai: 'OpenAI', elevenlabs: 'ElevenLabs', posthog: 'PostHog', workos: 'WorkOS', clickhouse: 'ClickHouse',
  lancedb: 'LanceDB', andurilindustries: 'Anduril', grafanalabs: 'Grafana Labs', customerio: 'Customer.io',
  coreweave: 'CoreWeave', zoominfo: 'ZoomInfo', shieldai: 'Shield AI', scaleai: 'Scale AI', doordashusa: 'DoorDash',
};
const companyName = (board) => NAMES[board] || titleCase(board);

// One task = one HTTP request. The helper on your PC runs all of them once a day; the site's own refresh works
// through the list a slice at a time when the helper hasn't.
export function buildTasks(s) {
  const tasks = [];
  for (const board of s.greenhouse) tasks.push({ kind: 'greenhouse', board });
  for (const board of s.lever) tasks.push({ kind: 'lever', board });
  for (const board of s.ashby || []) tasks.push({ kind: 'ashby', board });
  for (const q of s.amazon.queries) for (const loc of s.amazon.locations) tasks.push({ kind: 'amazon', q, loc });
  for (const q of s.microsoft.queries)
    for (const loc of s.microsoft.locations)
      for (let p = 0; p < s.microsoft.pages; p++) tasks.push({ kind: 'microsoft', q, loc, start: p * 10 });
  return tasks;
}

export async function runTask(t) {
  return (await fetchTask(t)).jobs;
}

// { jobs, etag }, or { notModified: true } when `etag` is given and the board hasn't changed since.
export async function fetchTask(t, etag) {
  const source = SOURCES[t.kind];
  if (!source) return { jobs: [] };
  const r = await getJSON(source.url(t), etag);
  return r.notModified ? r : { jobs: source.jobs(t, r.data), etag: r.etag };
}

// Each kind of task: the address it asks, and how the answer becomes jobs.
const SOURCES = {
  greenhouse: { url: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t.board)}/jobs`, jobs: (t, d) => greenhouse(t.board, d) },
  lever: { url: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t.board)}?mode=json`, jobs: (t, d) => lever(t.board, d) },
  ashby: { url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t.board)}?includeCompensation=false`, jobs: (t, d) => ashby(t.board, d) },
  amazon: { url: (t) => amazonUrl(t.q, t.loc), jobs: (_t, d) => amazon(d) },
  microsoft: { url: (t) => microsoftUrl(t.q, t.loc, t.start), jobs: (_t, d) => microsoft(d) },
};

function greenhouse(board, d) {
  return (d.jobs || []).map((j) => ({
    id: `gh:${board}:${j.id}`,
    source: 'greenhouse',
    board,
    company: j.company_name || companyName(board),
    title: j.title,
    location: j.location?.name || '',
    remote: false,
    url: j.absolute_url,
    // The embeddable form works for every company, even ones whose board redirects to their own site.
    apply_url: `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${j.id}`,
    posted_at: j.first_published || j.updated_at || null,
  }));
}

function lever(board, d) {
  return (Array.isArray(d) ? d : []).map((j) => ({
    id: `lever:${board}:${j.id}`,
    source: 'lever',
    board,
    company: companyName(board),
    title: j.text,
    location: (j.categories?.allLocations || [j.categories?.location]).filter(Boolean).join('; '),
    remote: j.workplaceType === 'remote',
    country: j.country || '',
    url: j.hostedUrl,
    apply_url: j.applyUrl,
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    min_years: requiredYears([j.descriptionPlain, ...(j.lists || []).map((l) => l.content), j.additionalPlain].join('. ')),
  }));
}

function ashby(board, d) {
  return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => {
    // Ashby's isRemote is true even for hybrid jobs, so go by workplaceType (Remote / Hybrid / OnSite) and the
    // job's country instead; a "Remote" entry among its locations still counts.
    const country = String(j.address?.postalAddress?.addressCountry || '').trim();
    return {
      id: `ashby:${board}:${j.id}`,
      source: 'ashby',
      board,
      company: companyName(board),
      title: j.title,
      location: [j.location, ...(j.secondaryLocations || []).map((s) => s.location)].filter(Boolean).join('; '),
      remote: /^remote$/i.test(j.workplaceType || ''),
      country: /^(united states|united states of america|usa|us|u\.s\.)$/i.test(country) ? 'US' : country ? 'other' : '',
      url: j.jobUrl,
      apply_url: j.applyUrl || `${j.jobUrl}/application`,
      posted_at: j.publishedAt || null,
      min_years: requiredYears(j.descriptionPlain),
    };
  });
}

function amazonUrl(q, loc) {
  const u = new URL('https://www.amazon.jobs/en/search.json');
  u.search = new URLSearchParams({ base_query: q, loc_query: loc, country: 'USA', result_limit: '100', offset: '0', sort: 'recent' });
  return String(u);
}

function amazon(d) {
  return (d.jobs || []).map((j) => {
    const posted = Date.parse(j.posted_date);
    return {
      id: `amazon:${j.id_icims}`,
      source: 'amazon',
      board: null,
      company: 'Amazon',
      title: j.title,
      location: j.normalized_location || j.location || '',
      remote: /virtual|remote/i.test(j.location || ''),
      url: `https://www.amazon.jobs${j.job_path}`,
      apply_url: j.url_next_step || `https://www.amazon.jobs${j.job_path}`,
      posted_at: Number.isNaN(posted) ? null : new Date(posted).toISOString(),
      min_years: requiredYears(j.basic_qualifications),
    };
  });
}

function microsoftUrl(q, loc, start) {
  const u = new URL('https://apply.careers.microsoft.com/api/pcsx/search');
  u.search = new URLSearchParams({ domain: 'microsoft.com', query: q, location: loc, start: String(start), num: '10', sort_by: 'timestamp' });
  return String(u);
}

function microsoft(d) {
  return (d.data?.positions || []).map((j) => ({
    id: `microsoft:${j.id}`,
    source: 'microsoft',
    board: null,
    company: 'Microsoft',
    title: j.name,
    location: (j.locations || []).join('; '),
    remote: j.workLocationOption === 'remote',
    url: `https://apply.careers.microsoft.com${j.positionUrl}`,
    apply_url: `https://apply.careers.microsoft.com${j.positionUrl}`,
    posted_at: j.postedTs ? new Date(j.postedTs * 1000).toISOString() : null,
  }));
}
