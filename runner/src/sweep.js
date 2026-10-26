// Checks every company's job board from this PC and sends the site the jobs that match your search. The site can
// only check a few boards every few minutes (Cloudflare's free plan); from here all of them take a minute or two,
// and a board that hasn't changed since the last check answers "not modified" without sending its jobs again.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildTasks, fetchTask } from '../../worker/src/sources.js';
import { filterJobs, makeMatcher } from '../../worker/src/filters.js';

const CONCURRENCY = 6;
const BATCH = 50; // jobs per request to the site (it takes up to 200 KB)

// Whether the day's check is due: the last one was before the most recent `hour` o'clock (this PC's time). A check
// missed because the PC was off happens as soon as the helper starts.
export function dailyDue(lastAt, hour, now = new Date()) {
  const due = new Date(now);
  due.setHours(hour, 0, 0, 0);
  if (due > now) due.setDate(due.getDate() - 1);
  return lastAt < due.getTime();
}

const taskKey = (t) => (t.board ? `${t.kind}:${t.board}` : `${t.kind}:${t.q}|${t.loc}|${t.start ?? 0}`);
// The settings that decide which of a board's jobs are kept. When they change, every board is read again.
const searchKey = (s) => JSON.stringify([s.titleInclude, s.levelExclude, s.hardExclude, s.areas, s.remoteUS]);

// One pass over every board. `cache` is { key, boards: { [task]: { etag, jobs } } }, where jobs are the board's jobs
// with a fitting title and place; age and experience are checked on the way out, since a job's age changes.
export async function checkBoards(settings, cache, { fetch = fetchTask, concurrency = CONCURRENCY } = {}) {
  const key = searchKey(settings);
  if (cache.key !== key) Object.assign(cache, { key, boards: {} });
  const m = makeMatcher(settings);
  const fits = (j) => m.title(j.title) && m.place(j.location, j);
  const tasks = buildTasks(settings);
  const queue = [...tasks];
  const limited = new Set(); // sites that said "too many requests" are left alone for the rest of this pass
  const errors = [];
  let changed = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (limited.has(t.kind)) continue;
      const k = taskKey(t);
      try {
        const r = await fetch(t, cache.boards[k]?.etag);
        if (r.notModified) continue;
        cache.boards[k] = { etag: r.etag || null, jobs: r.jobs.filter(fits) };
        changed++;
      } catch (err) {
        // The board's jobs from last time stay.
        errors.push(`${t.board || t.kind}: ${err.message}`);
        if (/^429\b/.test(err.message)) limited.add(t.kind);
      }
    }
  }));
  // Boards taken out of your settings.
  const keys = new Set(tasks.map(taskKey));
  for (const k of Object.keys(cache.boards)) if (!keys.has(k)) delete cache.boards[k];
  const jobs = filterJobs(Object.values(cache.boards).flatMap((b) => b.jobs), settings);
  return { jobs, boards: tasks.length, changed, errors };
}

// The helper's side: read your settings from the site, check every board, and send the jobs this helper hasn't
// sent yet (the site ignores ones it already has). The cache file saves a restart from downloading every board again,
// and remembers when the last check got through to the site.
export function makeSweeper({ api, file, log }) {
  let cache = { key: '', boards: {} };
  try {
    cache = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // first run
  }
  const sent = new Set();
  async function sweep() {
    const started = Date.now();
    const settings = await api('/settings');
    const r = await checkBoards(settings, cache);
    const summary = {
      boards: r.boards,
      changed: r.changed,
      matching: r.jobs.length,
      seconds: Math.round((Date.now() - started) / 1000),
      errors: r.errors.slice(0, 8),
    };
    const fresh = r.jobs.filter((j) => !sent.has(j.id));
    let added = 0;
    // The summary rides on the last batch (or on an empty one when there's nothing new).
    for (let i = 0; i === 0 || i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH);
      const last = i + BATCH >= fresh.length;
      const res = await api('/runner/jobs', { method: 'POST', body: { jobs: batch, ...(last ? { sweep: summary } : {}) } });
      added += res.added || 0;
      for (const j of batch) sent.add(j.id);
    }
    cache.checkedAt = Date.now();
    try {
      writeFileSync(file, JSON.stringify(cache));
    } catch (err) {
      log('Couldn’t save the job-board cache:', err.message);
    }
    const unread = r.errors.length ? ` ${r.errors.length} couldn’t be read (${r.errors[0]}${r.errors.length > 1 ? ', …' : ''}).` : '';
    log(`Checked ${r.boards} job boards in ${summary.seconds}s (${r.changed} changed): ${r.jobs.length} open jobs match your search, ${added} new.${unread}`);
    return { ...summary, added };
  }
  return { sweep, lastAt: () => cache.checkedAt || 0 };
}
