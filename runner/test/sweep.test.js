import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBoards, dailyDue } from '../src/sweep.js';
import { DEFAULT_SETTINGS } from '../../worker/src/defaults.js';

const settings = (over = {}) => ({
  ...DEFAULT_SETTINGS,
  greenhouse: ['acme', 'globex'],
  lever: [],
  ashby: [],
  amazon: { queries: [], locations: [] },
  microsoft: { queries: [], locations: [], pages: 0 },
  ...over,
});
const job = (board, n, title, location = 'Seattle, WA') => ({
  id: `gh:${board}:${n}`, source: 'greenhouse', board, company: board, title, location, remote: false,
  url: `https://example.com/${n}`, apply_url: `https://example.com/${n}/apply`, posted_at: new Date().toISOString(),
});

// A fake job site: each board has jobs and an ETag; asking with the current ETag gets "not modified".
function site(boards) {
  const calls = [];
  const fetch = async (t, etag) => {
    calls.push({ board: t.board, etag });
    const b = boards[t.board];
    if (b instanceof Error) throw b;
    return etag === b.etag ? { notModified: true } : { jobs: b.jobs, etag: b.etag };
  };
  return { fetch, calls };
}

test('sweep: once a day at 8, or on start when the PC missed it', () => {
  const at = (day, h, m = 0) => new Date(2026, 9, day, h, m);
  assert.equal(dailyDue(at(26, 8, 1).getTime(), 8, at(26, 23)), false); // done this morning
  assert.equal(dailyDue(at(26, 8, 1).getTime(), 8, at(27, 7, 59)), false); // not 8 yet
  assert.equal(dailyDue(at(26, 8, 1).getTime(), 8, at(27, 8)), true);
  assert.equal(dailyDue(at(25, 8, 1).getTime(), 8, at(27, 6)), true); // PC was off yesterday at 8
  assert.equal(dailyDue(0, 8, at(27, 6)), true); // never checked
});

test('sweep: keeps matching jobs, and an unchanged board costs a "not modified"', async () => {
  const boards = {
    acme: { etag: 'a1', jobs: [job('acme', 1, 'Software Engineer'), job('acme', 2, 'Account Executive'), job('acme', 3, 'Software Engineer', 'London, UK')] },
    globex: { etag: 'g1', jobs: [job('globex', 4, 'Frontend Engineer', 'Remote - US')] },
  };
  const { fetch, calls } = site(boards);
  const cache = {};
  const first = await checkBoards(settings(), cache, { fetch });
  assert.deepEqual(first.jobs.map((j) => j.id).sort(), ['gh:acme:1', 'gh:globex:4']);
  assert.equal(first.changed, 2);

  const second = await checkBoards(settings(), cache, { fetch });
  assert.deepEqual(second.jobs.map((j) => j.id).sort(), ['gh:acme:1', 'gh:globex:4']);
  assert.equal(second.changed, 0);
  assert.deepEqual(calls.slice(2).map((c) => c.etag).sort(), ['a1', 'g1']);

  boards.acme = { etag: 'a2', jobs: [job('acme', 5, 'Software Developer')] };
  const third = await checkBoards(settings(), cache, { fetch });
  assert.deepEqual(third.jobs.map((j) => j.id).sort(), ['gh:acme:5', 'gh:globex:4']);
});

test('sweep: a board that fails keeps its jobs from last time; "too many requests" stops that site for the pass', async () => {
  const boards = { acme: { etag: 'a1', jobs: [job('acme', 1, 'Software Engineer')] }, globex: { etag: 'g1', jobs: [] } };
  const { fetch, calls } = site(boards);
  const cache = {};
  await checkBoards(settings(), cache, { fetch });
  boards.acme = new Error('502 from boards-api.greenhouse.io');
  const r = await checkBoards(settings(), cache, { fetch });
  assert.deepEqual(r.jobs.map((j) => j.id), ['gh:acme:1']);
  assert.equal(r.errors.length, 1);

  boards.acme = new Error('429 from boards-api.greenhouse.io');
  calls.length = 0;
  await checkBoards(settings(), cache, { fetch, concurrency: 1 });
  assert.deepEqual(calls.map((c) => c.board), ['acme']);
});

test('sweep: new title rules read every board again; a removed board drops out', async () => {
  const boards = { acme: { etag: 'a1', jobs: [job('acme', 1, 'Software Engineer'), job('acme', 2, 'Data Engineer')] }, globex: { etag: 'g1', jobs: [] } };
  const { fetch, calls } = site(boards);
  const cache = {};
  await checkBoards(settings(), cache, { fetch });
  calls.length = 0;
  const wider = await checkBoards(settings({ titleInclude: [...DEFAULT_SETTINGS.titleInclude, 'data engineer'] }), cache, { fetch });
  assert.ok(calls.every((c) => !c.etag));
  assert.deepEqual(wider.jobs.map((j) => j.id).sort(), ['gh:acme:1', 'gh:acme:2']);

  const fewer = await checkBoards(settings({ greenhouse: ['globex'], titleInclude: [...DEFAULT_SETTINGS.titleInclude, 'data engineer'] }), cache, { fetch });
  assert.deepEqual(fewer.jobs, []);
  assert.deepEqual(Object.keys(cache.boards), ['greenhouse:globex']);
});
