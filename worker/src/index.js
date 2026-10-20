// Apply Desk: the /jobs page, its API, the scheduled job refresh, and the endpoints the PC helper polls.
import { DEFAULT_SETTINGS, EMPTY_PROFILE, PROFILE_FIELDS } from './defaults.js';
import { buildTasks, runTask } from './sources.js';
import { filterJobs } from './filters.js';
import { loadForm, JobClosedError } from './forms.js';
import { autofill, bankKey, looseKey, missingRequired, PROFILE_DRIVEN, toBank, wantsSms } from './autofill.js';
import { clearCookie, hasSession, hasToken, passwordMatches, sessionCookie } from './auth.js';

const AUTO_SOURCES = ['greenhouse', 'lever', 'amazon', 'microsoft'];
// Greenhouse and Lever forms come from public APIs. Amazon's and Microsoft's need your login, so the helper
// reads them ("prepares" the job) and the job joins the auto queue once its form is in.
const SIGNED_IN_SOURCES = ['amazon', 'microsoft'];
// A site can be paused (Amazon's limit of 10 active applications); its jobs stay out of the queue meanwhile.
const autoWhere = (paused = {}) => {
  const open = SIGNED_IN_SOURCES.filter((s) => !paused[s]);
  const signedIn = open.length ? ` OR (source IN (${open.map((s) => `'${s}'`).join(',')}) AND form IS NOT NULL)` : '';
  return `(source IN ('greenhouse','lever')${signedIn})`;
};
const manualWhere = (paused = {}) => {
  const open = SIGNED_IN_SOURCES.filter((s) => !paused[s]);
  return open.length ? `(source IN (${open.map((s) => `'${s}'`).join(',')}) AND form IS NULL)` : '(0)';
};
// While paused, the helper tries one job from that site this often to see if a spot has opened.
const PAUSE_RECHECK_MS = 24 * 60 * 60 * 1000;
// How many prepared-but-unanswered jobs to keep ready per site. Opening an Amazon application leaves it in progress there.
const PREPARE_BUFFER = 5;
const SENT_STATUSES = ['ready', 'submitting', 'submitted', 'needs_you', 'failed', 'applied_manual'];
// Small batches keep each run well inside the free plan's CPU limit; the cron works through the rest.
const TASKS_PER_RUN = 3;
const STALE_SUBMIT_MS = 20 * 60 * 1000;

const now = () => new Date().toISOString();

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshSlice(env));
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path === '/jobs/login' && method === 'POST') return login(request, env);
  if (path === '/jobs/login') return loginPage();
  if (path === '/jobs/logout') return redirect('/jobs/login', { 'set-cookie': clearCookie });

  if (path.startsWith('/jobs/api/')) {
    const viaToken = hasToken(env, request);
    if (!viaToken && !(await hasSession(env, request))) return json({ error: 'Not signed in.' }, 401);
    if (method !== 'GET' && !(request.headers.get('content-type') || '').includes('application/json')) {
      return json({ error: 'Send JSON.' }, 415);
    }
    return api(request, env, path.slice('/jobs/api'.length), url);
  }

  const session = await hasSession(env, request);
  if (path === '/jobs') return session ? asset(env, request, '/jobs/index.html') : redirect('/jobs/login');
  if (path === '/jobs/app.js' || path === '/jobs/app.css') {
    return session ? asset(env, request, path) : new Response('Not signed in', { status: 401 });
  }
  return new Response('Not found', { status: 404 });
}

// ---------- API ----------

async function api(request, env, path, url) {
  const method = request.method;
  const body = method === 'GET' ? {} : await readJSON(request);
  if (body === null) return json({ error: 'Body must be JSON (max 200 KB).' }, 400);

  if (path === '/state' && method === 'GET') return json(await state(env, url.searchParams.get('since')));
  if (path === '/next' && method === 'GET') return json(await next(env, url.searchParams.get('lane') || 'auto'));
  if (path === '/jobs' && method === 'GET') return json(await list(env, url.searchParams.get('view') || 'sent'));
  if (path === '/profile' && method === 'GET') return json({ profile: await getProfile(env), fields: PROFILE_FIELDS });
  if (path === '/profile' && method === 'PUT') return saveProfile(env, body);
  if (path === '/settings' && method === 'GET') return json(await getSettings(env));
  if (path === '/settings' && method === 'PUT') return saveSettings(env, body);
  if (path === '/refresh' && method === 'POST') return json(await refreshSlice(env));
  if (path === '/runner/claim' && method === 'POST') return json(await claim(env, body));
  if (path === '/runner/result' && method === 'POST') return runnerResult(env, body);
  if (path === '/runner/code' && method === 'GET') return json(await takeCode(env, url.searchParams.get('id') || ''));
  if (path === '/runner/prepare' && method === 'POST') return json(await claimPrepare(env));
  if (path === '/runner/form' && method === 'POST') return saveRunnerForm(env, body);
  if (path === '/runner/site' && method === 'POST') {
    await setPaused(env, String(body.source || ''), body.paused === true, body.note);
    return json({ ok: true, paused: await getKV(env, 'paused', {}) });
  }
  if (path === '/runner/heartbeat' && method === 'POST') {
    await setKV(env, 'runner', { seen: now(), ...pickRunnerInfo(body) });
    return json({ ok: true });
  }

  const m = /^\/jobs\/([^/]+)\/(answers|status|code)$/.exec(path);
  if (m && method === 'POST') {
    const id = decodeURIComponent(m[1]);
    if (m[2] === 'answers') return saveAnswers(env, id, body);
    if (m[2] === 'code') return giveCode(env, id, body);
    return setStatus(env, id, body);
  }
  return json({ error: 'Unknown endpoint.' }, 404);
}

async function state(env, since) {
  const start = validISO(since) || new Date(Date.now() - 864e5).toISOString();
  const settings = await getSettings(env);
  const fresh = new Date(Date.now() - settings.maxAgeDays * 864e5).toISOString();
  const paused = await getKV(env, 'paused', {});
  const row = await env.DB.prepare(
    `SELECT
       SUM(status = 'new' AND ${autoWhere(paused)} AND (posted_at IS NULL OR posted_at >= ?1)) AS queue_auto,
       SUM(status = 'new' AND ${manualWhere(paused)} AND (posted_at IS NULL OR posted_at >= ?1)) AS queue_manual,
       SUM(status = 'ready') AS ready,
       SUM(status = 'submitting') AS submitting,
       SUM(status = 'needs_you') AS needs_you,
       SUM(needs = 'code') AS needs_code,
       SUM(status = 'failed') AS failed,
       SUM(status IN ('submitted','applied_manual')) AS submitted_total,
       SUM(sent_at >= ?2) AS sent_today
     FROM jobs`,
  ).bind(fresh, start).first();
  const counts = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, v || 0]));
  const profile = await getProfile(env);
  return {
    counts,
    goal: settings.dailyGoal,
    runner: await getKV(env, 'runner', null),
    refresh: await getKV(env, 'refresh', null),
    alert: await getKV(env, 'alert', null),
    paused,
    profileReady: !!(profile.first_name && profile.last_name && profile.email && profile.phone),
  };
}

async function next(env, lane) {
  const settings = await getSettings(env);
  const fresh = new Date(Date.now() - settings.maxAgeDays * 864e5).toISOString();
  const paused = await getKV(env, 'paused', {});
  const pick = env.DB.prepare(
    `SELECT * FROM jobs WHERE status = 'new' AND ${lane === 'manual' ? manualWhere(paused) : autoWhere(paused)}
       AND (posted_at IS NULL OR posted_at >= ?1)
     ORDER BY later ASC, posted_at DESC LIMIT 1`,
  ).bind(fresh);

  for (let tries = 0; tries < 6; tries++) {
    const job = await pick.first();
    if (!job) return { job: null };
    if (lane === 'manual') return { job: publicJob(job) };

    let form = job.form ? JSON.parse(job.form) : null;
    if (!form) {
      try {
        form = await loadForm(job);
        await env.DB.prepare('UPDATE jobs SET form = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(form), now(), job.id).run();
      } catch (err) {
        if (err instanceof JobClosedError) {
          await env.DB.prepare(`UPDATE jobs SET status = 'closed', note = 'Posting closed', updated_at = ? WHERE id = ?`).bind(now(), job.id).run();
        } else {
          await env.DB.prepare('UPDATE jobs SET later = later + 1, note = ?, updated_at = ? WHERE id = ?')
            .bind(`Couldn't load the form: ${err.message}`.slice(0, 300), now(), job.id).run();
        }
        continue;
      }
    }
    const profile = await getProfile(env);
    const fill = autofill(form, profile, await getBank(env), job.company);
    return { job: publicJob(job), form, fill };
  }
  return { job: null, note: 'Several forms failed to load in a row. Try again in a minute.' };
}

async function list(env, view) {
  if (view === 'manual') {
    const settings = await getSettings(env);
    const fresh = new Date(Date.now() - settings.maxAgeDays * 864e5).toISOString();
    const paused = await getKV(env, 'paused', {});
    const { results } = await env.DB.prepare(
      `SELECT * FROM jobs WHERE status = 'new' AND ${manualWhere(paused)} AND (posted_at IS NULL OR posted_at >= ?)
       ORDER BY posted_at DESC LIMIT 150`,
    ).bind(fresh).all();
    return { jobs: results.map(publicJob) };
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM jobs WHERE status IN (${SENT_STATUSES.map(() => '?').join(',')})
     ORDER BY COALESCE(sent_at, updated_at) DESC LIMIT 300`,
  ).bind(...SENT_STATUSES).all();
  return { jobs: results.map(publicJob) };
}

async function saveAnswers(env, id, body) {
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!job) return json({ error: 'No such job.' }, 404);
  if (!AUTO_SOURCES.includes(job.source) || !job.form) return json({ error: 'This job has no form to fill.' }, 400);

  const form = JSON.parse(job.form);
  const fill = autofill(form, await getProfile(env), await getBank(env), job.company);
  const given = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const answers = { ...fill.values };
  for (const q of form.questions) {
    if (!(q.name in given)) continue;
    const v = cleanAnswer(given[q.name]);
    if (v === null) delete answers[q.name];
    else answers[q.name] = v;
  }
  const missing = missingRequired(form, answers);
  if (missing.length) return json({ error: 'Some required questions are empty.', missing: missing.map((q) => q.label) }, 422);

  const t = now();
  const writes = [
    env.DB.prepare(`UPDATE jobs SET answers = ?, status = 'ready', note = NULL, sent_at = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(answers), t, t, id),
  ];
  // Remember answers to questions that will come up again at other companies.
  for (const q of form.questions) {
    const v = answers[q.name];
    if (PROFILE_DRIVEN.has(q.name) || q.type === 'file' || q.section === 'demographic') continue;
    if (fill.bucket[q.name] === 'auto' && v === fill.values[q.name]) continue;
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    writes.push(
      env.DB.prepare(
        `INSERT INTO answer_bank (qkey, label, answer, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(qkey) DO UPDATE SET label = excluded.label, answer = excluded.answer, updated_at = excluded.updated_at`,
      ).bind(bankKey(q.label, job.company, q.type), q.label.slice(0, 500), JSON.stringify(toBank(v, job.company)), t),
    );
  }
  await env.DB.batch(writes);
  return json({ ok: true });
}

async function setStatus(env, id, body) {
  const status = String(body.status || '');
  const t = now();
  let stmt;
  if (status === 'later') {
    stmt = env.DB.prepare('UPDATE jobs SET later = later + 1, updated_at = ? WHERE id = ?').bind(t, id);
  } else if (status === 'skipped' || status === 'new') {
    stmt = env.DB.prepare('UPDATE jobs SET status = ?, sent_at = NULL, note = NULL, needs = NULL, code = NULL, updated_at = ? WHERE id = ?')
      .bind(status, t, id);
  } else if (status === 'applied_manual' || status === 'submitted') {
    stmt = env.DB.prepare(
      'UPDATE jobs SET status = ?, needs = NULL, code = NULL, sent_at = COALESCE(sent_at, ?), submitted_at = ?, updated_at = ? WHERE id = ?',
    ).bind(status, t, t, t, id);
  } else if (status === 'ready') {
    stmt = env.DB.prepare(`UPDATE jobs SET status = 'ready', note = NULL, needs = NULL, code = NULL, updated_at = ? WHERE id = ? AND answers IS NOT NULL`)
      .bind(t, id);
  } else {
    return json({ error: 'Unknown status.' }, 400);
  }
  const r = await stmt.run();
  return r.meta.changes ? json({ ok: true }) : json({ error: 'No such job (or nothing to retry).' }, 404);
}

// ---------- PC helper ----------

async function claim(env, body) {
  const t = now();
  await setKV(env, 'runner', { seen: t, ...pickRunnerInfo(body) });
  const stale = new Date(Date.now() - STALE_SUBMIT_MS).toISOString();
  await env.DB.prepare(`UPDATE jobs SET status = 'ready', note = 'Retrying: the helper stopped mid-submit' WHERE status = 'submitting' AND updated_at < ?`)
    .bind(stale).run();

  const job = await env.DB.prepare(`SELECT * FROM jobs WHERE status = 'ready' ORDER BY updated_at ASC LIMIT 1`).first();
  if (!job) return { job: null };
  const r = await env.DB.prepare(`UPDATE jobs SET status = 'submitting', updated_at = ? WHERE id = ? AND status = 'ready'`).bind(t, job.id).run();
  if (!r.meta.changes) return { job: null };
  const profile = await getProfile(env);
  return {
    job: { ...publicJob(job), apply_url: job.apply_url, board: job.board },
    form: JSON.parse(job.form),
    answers: JSON.parse(job.answers),
    // Preferences the helper applies to parts of a form that aren't in the question list.
    prefs: {
      smsOptIn: wantsSms(profile),
      email: profile.email,
      // For forms' built-in Employment / Education sections, which Greenhouse's API doesn't list.
      history: Object.fromEntries(
        ['current_company', 'current_title', 'job_start_month', 'job_start_year', 'job_current', 'school', 'degree', 'discipline', 'grad_year']
          .map((k) => [k, profile[k] || '']),
      ),
    },
  };
}

async function runnerResult(env, body) {
  // 'new' puts a job back in the queue (e.g. the site was at its application limit); your answers are kept.
  const allowed = ['submitted', 'needs_you', 'failed', 'ready', 'new'];
  if (!allowed.includes(body.status)) return json({ error: 'Unknown status.' }, 400);
  const t = now();
  const note = body.note ? String(body.note).slice(0, 1000) : null;
  const needs = body.needs === 'code' ? 'code' : null;
  // Only jobs the helper is working on: a late report never undoes what you did on the page
  // ("I finished it", Skip, Retry).
  await env.DB.prepare(
    `UPDATE jobs SET status = ?, note = ?, needs = ?, code = NULL, updated_at = ?,
       submitted_at = CASE WHEN ? THEN ? ELSE submitted_at END,
       sent_at = CASE WHEN ? THEN NULL ELSE sent_at END
     WHERE id = ? AND status IN ('submitting', 'needs_you')`,
  ).bind(body.status, note, needs, t, body.status === 'submitted' ? 1 : 0, t, body.status === 'new' ? 1 : 0, String(body.id)).run();
  await setKV(env, 'runner', { seen: t, ...pickRunnerInfo(body) });
  return json({ ok: true });
}

// Amazon and Microsoft: the helper reads a job's questions while you're signed in. Keeps a few ready per site.
async function claimPrepare(env) {
  const settings = await getSettings(env);
  const fresh = new Date(Date.now() - settings.maxAgeDays * 864e5).toISOString();
  const { results: counts } = await env.DB.prepare(
    `SELECT source, COUNT(*) AS n FROM jobs WHERE status = 'new' AND source IN ('amazon','microsoft') AND form IS NOT NULL
       AND (posted_at IS NULL OR posted_at >= ?) GROUP BY source`,
  ).bind(fresh).all();
  const full = new Set(counts.filter((c) => c.n >= PREPARE_BUFFER).map((c) => c.source));
  // A paused site gets one try a day, to notice when a spot has opened.
  const paused = await getKV(env, 'paused', {});
  const recheckDue = (s) => Date.now() - Date.parse(paused[s].checkedAt || paused[s].since) >= PAUSE_RECHECK_MS;
  const sources = SIGNED_IN_SOURCES.filter((s) => !full.has(s) && (!paused[s] || recheckDue(s)));
  if (!sources.length) return { job: null };
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const job = await env.DB.prepare(
    `SELECT * FROM jobs WHERE status = 'new' AND source IN (${sources.map(() => '?').join(',')}) AND form IS NULL
       AND (posted_at IS NULL OR posted_at >= ?) AND (needs IS NULL OR (needs = 'preparing' AND updated_at < ?))
     ORDER BY later ASC, posted_at DESC LIMIT 1`,
  ).bind(...sources, fresh, stale).first();
  if (!job) return { job: null };
  await env.DB.prepare(`UPDATE jobs SET needs = 'preparing', updated_at = ? WHERE id = ?`).bind(now(), job.id).run();
  return { job: { ...publicJob(job), apply_url: job.apply_url } };
}

async function saveRunnerForm(env, body) {
  const id = String(body.id || '');
  const t = now();
  if (body.form && Array.isArray(body.form.questions) && !body.form.questions.length) {
    // A form with no questions means the reader missed them; don't put it in front of you as "nothing to answer".
    await env.DB.prepare(`UPDATE jobs SET needs = NULL, later = later + 1, note = 'Couldn’t read the questions', updated_at = ? WHERE id = ?`)
      .bind(t, id).run();
  } else if (body.form && Array.isArray(body.form.questions)) {
    await env.DB.prepare(`UPDATE jobs SET form = ?, needs = NULL, note = NULL, updated_at = ? WHERE id = ? AND status = 'new'`)
      .bind(JSON.stringify(body.form).slice(0, 200_000), t, id).run();
    // The site let us in, so it isn't at its limit any more.
    const job = await env.DB.prepare('SELECT source FROM jobs WHERE id = ?').bind(id).first();
    if (job) await setPaused(env, job.source, false);
  } else if (body.outcome === 'limit') {
    const job = await env.DB.prepare('SELECT source FROM jobs WHERE id = ?').bind(id).first();
    await env.DB.prepare(`UPDATE jobs SET needs = NULL, updated_at = ? WHERE id = ?`).bind(t, id).run();
    if (job) await setPaused(env, job.source, true, body.note);
  } else if (body.outcome === 'applied') {
    await env.DB.prepare(`UPDATE jobs SET status = 'applied_manual', needs = NULL, note = 'Already applied on the site', sent_at = COALESCE(sent_at, ?), submitted_at = ?, updated_at = ? WHERE id = ?`)
      .bind(t, t, t, id).run();
  } else if (body.outcome === 'closed') {
    await env.DB.prepare(`UPDATE jobs SET status = 'closed', needs = NULL, note = 'Posting closed', updated_at = ? WHERE id = ?`).bind(t, id).run();
  } else {
    // Couldn't read it (e.g. signed out): park it and say why.
    await env.DB.prepare(`UPDATE jobs SET needs = NULL, later = later + 1, note = ?, updated_at = ? WHERE id = ?`)
      .bind(String(body.note || 'Couldn’t read the application').slice(0, 300), t, id).run();
  }
  if (body.alert !== undefined) await setKV(env, 'alert', body.alert ? { text: String(body.alert).slice(0, 300), at: t } : null);
  return json({ ok: true });
}

// Pause or resume a site (e.g. Amazon's 10-application limit). Pausing again just records the latest check.
async function setPaused(env, source, on, note) {
  if (!SIGNED_IN_SOURCES.includes(source)) return;
  const paused = await getKV(env, 'paused', {});
  if (on) {
    const t = now();
    paused[source] = { since: paused[source]?.since || t, checkedAt: t, note: String(note || paused[source]?.note || 'Paused').slice(0, 300) };
  } else if (paused[source]) {
    delete paused[source];
  } else {
    return;
  }
  await setKV(env, 'paused', paused);
}

// You read the emailed code and enter it on the page (or give it to Claude); the helper picks it up.
async function giveCode(env, id, body) {
  const code = String(body.code || '').replace(/[\s-]/g, '');
  if (!/^[A-Za-z0-9]{4,12}$/.test(code)) return json({ error: 'That doesn’t look like a code (4–12 letters or numbers).' }, 400);
  const r = await env.DB.prepare(`UPDATE jobs SET code = ?, updated_at = ? WHERE id = ? AND needs = 'code'`).bind(code, now(), id).run();
  return r.meta.changes ? json({ ok: true }) : json({ error: 'That application isn’t waiting for a code.' }, 409);
}

async function takeCode(env, id) {
  const row = await env.DB.prepare(`SELECT code FROM jobs WHERE id = ? AND needs = 'code' AND code IS NOT NULL`).bind(id).first();
  if (!row) return { code: null };
  await env.DB.prepare('UPDATE jobs SET code = NULL WHERE id = ?').bind(id).run();
  return { code: row.code };
}

const pickRunnerInfo = (b) => ({ version: String(b.version || '').slice(0, 20), host: String(b.host || '').slice(0, 60) });

// ---------- refresh ----------

async function refreshSlice(env) {
  const settings = await getSettings(env);
  const tasks = buildTasks(settings);
  const prev = await getKV(env, 'refresh', { cursor: 0 });
  const start = prev.cursor >= tasks.length ? 0 : prev.cursor || 0;
  const slice = tasks.slice(start, start + TASKS_PER_RUN);
  const cursor = start + slice.length;
  const cycleDone = cursor >= tasks.length;
  // Move the cursor before the work, so a source that crashes the run gets skipped next time.
  const info = { ...prev, cursor: cycleDone ? 0 : cursor, total: tasks.length, at: now() };
  if (cycleDone) info.lastCycleAt = now();
  await setKV(env, 'refresh', info);

  const found = [];
  const errors = [];
  for (const t of slice) {
    try {
      found.push(...(await runTask(t)));
    } catch (err) {
      errors.push(`${t.board || t.kind}: ${err.message}`);
    }
  }
  const kept = filterJobs(found, settings);
  const added = await insertJobs(env, kept);
  if (errors.length) await setKV(env, 'refresh', { ...info, errors: [...errors, ...(prev.errors || [])].slice(0, 8) });
  return { added, scanned: found.length, matched: kept.length, cursor, total: tasks.length, cycleDone, errors };
}

const JOB_COLS = ['id', 'source', 'board', 'company', 'title', 'location', 'remote', 'url', 'apply_url', 'posted_at', 'found_at'];

async function insertJobs(env, jobs) {
  if (!jobs.length) return 0;
  const t = now();
  const perStmt = Math.floor(100 / JOB_COLS.length); // D1 allows 100 bound values per statement
  const stmts = [];
  for (let i = 0; i < jobs.length; i += perStmt) {
    const chunk = jobs.slice(i, i + perStmt);
    const row = `(${JOB_COLS.map(() => '?').join(',')})`;
    const values = chunk.flatMap((j) => [
      j.id, j.source, j.board, String(j.company).slice(0, 200), String(j.title).slice(0, 300),
      String(j.location || '').slice(0, 300), j.remote ? 1 : 0, j.url, j.apply_url, j.posted_at, t,
    ]);
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO jobs (${JOB_COLS.join(',')}) VALUES ${chunk.map(() => row).join(',')}`).bind(...values));
  }
  const results = await env.DB.batch(stmts);
  return results.reduce((n, r) => n + (r.meta?.changes || 0), 0);
}

// ---------- storage ----------

async function getKV(env, key, fallback) {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : fallback;
}

async function setKV(env, key, value) {
  await env.DB.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

async function getSettings(env) {
  return { ...DEFAULT_SETTINGS, ...(await getKV(env, 'settings', {})) };
}

async function getProfile(env) {
  return { ...EMPTY_PROFILE, ...(await getKV(env, 'profile', {})) };
}

async function getBank(env) {
  const { results } = await env.DB.prepare('SELECT qkey, answer FROM answer_bank ORDER BY updated_at').all();
  const bank = new Map(results.map((r) => [r.qkey, JSON.parse(r.answer)]));
  // Second index on the looser key; later (newer) answers win.
  bank.loose = new Map(results.map((r) => [looseKey(r.qkey), JSON.parse(r.answer)]));
  return bank;
}

async function saveProfile(env, body) {
  const profile = {};
  for (const [key] of PROFILE_FIELDS) profile[key] = String(body[key] ?? '').trim().slice(0, 500);
  await setKV(env, 'profile', profile);
  return json({ ok: true, profile });
}

async function saveSettings(env, body) {
  const s = { ...DEFAULT_SETTINGS };
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  const strings = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 200) : null);
  s.dailyGoal = num(body.dailyGoal, 1, 200, s.dailyGoal);
  s.maxAgeDays = num(body.maxAgeDays, 1, 120, s.maxAgeDays);
  s.remoteUS = body.remoteUS !== false;
  for (const k of ['titleInclude', 'levelExclude', 'hardExclude', 'areas', 'greenhouse', 'lever']) {
    const v = strings(body[k]);
    if (v) s[k] = v;
  }
  for (const k of ['titleInclude', 'levelExclude', 'hardExclude', 'areas']) {
    for (const re of s[k]) {
      try {
        new RegExp(re);
      } catch {
        return json({ error: `Not a valid pattern in ${k}: ${re}` }, 400);
      }
    }
  }
  for (const k of ['greenhouse', 'lever']) s[k] = s[k].map((b) => b.toLowerCase()).filter((b) => /^[a-z0-9-]+$/.test(b));
  await setKV(env, 'settings', s);
  return json({ ok: true, settings: s });
}

// ---------- helpers ----------

function publicJob(j) {
  return {
    id: j.id, source: j.source, company: j.company, title: j.title, location: j.location, remote: !!j.remote,
    url: j.url, apply_url: j.apply_url, posted_at: j.posted_at, status: j.status, note: j.note, needs: j.needs,
    sent_at: j.sent_at, submitted_at: j.submitted_at, updated_at: j.updated_at,
  };
}

function cleanAnswer(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const a = v.map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 50);
    return a.length ? a : null;
  }
  const s = String(v).slice(0, 20000);
  return s.trim() ? s : null;
}

function validISO(s) {
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
}

async function readJSON(request) {
  const text = await request.text();
  if (text.length > 200_000) return null;
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { location, ...headers, ...SECURITY_HEADERS } });
}

async function asset(env, request, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { headers: request.headers }));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  out.headers.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  return out;
}

async function login(request, env) {
  const form = await request.formData();
  if (await passwordMatches(env, String(form.get('password') || ''))) {
    return redirect('/jobs', { 'set-cookie': await sessionCookie(env) });
  }
  await new Promise((r) => setTimeout(r, 800));
  return loginPage('That password didn’t match.');
}

function loginPage(error = '') {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apply Desk</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f6f5f2;--card:#fff;--text:#1d1c1a;--muted:#6b6862;--line:#e3e0da;--accent:#1f5f4a;--bad:#a33}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--card:#1f1f1d;--text:#ecebe7;--muted:#a19e97;--line:#34332f;--accent:#5fbf9a;--bad:#e88}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:360px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:var(--muted);font-size:14px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--text);font:inherit}
button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}
.err{color:var(--bad);font-size:14px;margin-top:10px}
</style></head>
<body><form method="post" action="/jobs/login">
<h1>Apply Desk</h1><p>Private. Sign in to continue.</p>
<input type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus>
<button type="submit">Sign in</button>
${error ? `<div class="err" role="alert">${error}</div>` : ''}
</form></body></html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}
