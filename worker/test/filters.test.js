import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatcher, filterJobs } from '../src/filters.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';

const m = makeMatcher(DEFAULT_SETTINGS);

test('titles: keeps mid-level and entry software roles', () => {
  for (const t of [
    'Software Development Engineer II, DynamoDB',
    'Software Engineer',
    'Software Engineer II and Senior Software Engineer',
    'Senior Software Engineer/Software Engineer II',
    'Software Engineer/Sr. Software Engineer',
    'Frontend Engineer, Ads',
    'Full Stack Engineer, Experimentation',
    'Entry Level Software Engineer, Recommendations',
    'Software Engineer I, Backend (Collections)',
    'Application Developer',
  ]) assert.equal(m.title(t), true, t);
});

test('titles: drops senior, non-software and clearance roles', () => {
  for (const t of [
    'Senior Software Engineer',
    'Senior Software Engineer/ Principal Software Engineer - Copilot CLI',
    'Staff Software Engineer, Payments',
    'Software Engineer III',
    'Principal Firmware Validation Engineer',
    'Software Engineer II - CTJ - TS/SCI',
    'High School Internship, Software Engineering (Summer 2027)',
    'Account Executive 3',
    'Systems PhD - Software Engineer',
    'Engineering Manager, Platform',
  ]) assert.equal(m.title(t), false, t);
});

test('places: Seattle area and US remote, not foreign remote', () => {
  assert.equal(m.place('Seattle, WA'), 'area');
  assert.equal(m.place('US, WA, Redmond'), 'area');
  assert.equal(m.place('San Francisco, CA; Seattle, WA'), 'area');
  assert.equal(m.place('Kent, WA'), 'area');
  assert.equal(m.place('Kent, United Kingdom'), null);
  assert.equal(m.place('Washington, D.C.'), null);
  assert.equal(m.place('Spokane, WA'), 'area');
  assert.equal(m.place('United States, Washington, Vancouver'), 'area');
  assert.equal(m.place('Vancouver, BC'), null);
  assert.equal(m.place('Ottawa, ON'), null);
  assert.equal(m.place('Washington, DC; New York, NY'), null);
  assert.equal(m.place('Remote - US'), 'remote');
  assert.equal(m.place('Remote, Canada; Remote, United States'), 'remote');
  assert.equal(m.place(' -REMOTE, USA-'), 'remote');
  assert.equal(m.place('Remote Spain'), null);
  assert.equal(m.place('Canada - Remote (ON, AB, BC, or NS Only)'), null);
  assert.equal(m.place('San Francisco, CA'), null);
  assert.equal(m.place('Anywhere', { remote: true, country: 'US' }), 'remote');
  assert.equal(m.place('Toronto', { remote: true, country: 'CA' }), null);
});

test('filterJobs drops stale postings and marks remote', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const jobs = [
    { title: 'Software Engineer', location: 'Remote - US', posted_at: '2026-10-10T00:00:00Z' },
    { title: 'Software Engineer', location: 'Seattle, WA', posted_at: '2026-08-01T00:00:00Z' },
    { title: 'Software Engineer', location: 'Bellevue, WA', posted_at: null },
  ];
  const kept = filterJobs(jobs, DEFAULT_SETTINGS, now);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].remote, 1);
  assert.equal(kept[1].remote, 0);
});
