// Fetches job listings from the four sources and returns them in one shape:
// { id, source, board, company, title, location, remote, country, url, apply_url, posted_at }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyDesk/1.0 (+https://brandonskar.com/jobs)';

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`not JSON from ${new URL(url).host}: ${text.slice(0, 60)}`);
  }
}

const titleCase = (s) => s.replace(/(^|[-_ ])(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());

// One task = one HTTP request. A refresh works through the list a slice at a time.
export function buildTasks(s) {
  const tasks = [];
  for (const board of s.greenhouse) tasks.push({ kind: 'greenhouse', board });
  for (const board of s.lever) tasks.push({ kind: 'lever', board });
  for (const q of s.amazon.queries) for (const loc of s.amazon.locations) tasks.push({ kind: 'amazon', q, loc });
  for (const q of s.microsoft.queries)
    for (const loc of s.microsoft.locations)
      for (let p = 0; p < s.microsoft.pages; p++) tasks.push({ kind: 'microsoft', q, loc, start: p * 10 });
  return tasks;
}

export async function runTask(t) {
  switch (t.kind) {
    case 'greenhouse': return greenhouse(t.board);
    case 'lever': return lever(t.board);
    case 'amazon': return amazon(t.q, t.loc);
    case 'microsoft': return microsoft(t.q, t.loc, t.start);
    default: return [];
  }
}

async function greenhouse(board) {
  const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`);
  return (d.jobs || []).map((j) => ({
    id: `gh:${board}:${j.id}`,
    source: 'greenhouse',
    board,
    company: j.company_name || titleCase(board),
    title: j.title,
    location: j.location?.name || '',
    remote: false,
    url: j.absolute_url,
    // The embeddable form works for every company, even ones whose board redirects to their own site.
    apply_url: `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${j.id}`,
    posted_at: j.first_published || j.updated_at || null,
  }));
}

async function lever(board) {
  const d = await getJSON(`https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`);
  return (Array.isArray(d) ? d : []).map((j) => ({
    id: `lever:${board}:${j.id}`,
    source: 'lever',
    board,
    company: titleCase(board),
    title: j.text,
    location: (j.categories?.allLocations || [j.categories?.location]).filter(Boolean).join('; '),
    remote: j.workplaceType === 'remote',
    country: j.country || '',
    url: j.hostedUrl,
    apply_url: j.applyUrl,
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
  }));
}

async function amazon(q, loc) {
  const u = new URL('https://www.amazon.jobs/en/search.json');
  u.search = new URLSearchParams({ base_query: q, loc_query: loc, country: 'USA', result_limit: '100', offset: '0', sort: 'recent' });
  const d = await getJSON(u);
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
    };
  });
}

async function microsoft(q, loc, start) {
  const u = new URL('https://apply.careers.microsoft.com/api/pcsx/search');
  u.search = new URLSearchParams({ domain: 'microsoft.com', query: q, location: loc, start: String(start), num: '10', sort_by: 'timestamp' });
  const d = await getJSON(u);
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
