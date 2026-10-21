import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatcher, filterJobs, postedLimit, requiredYears } from '../src/filters.js';
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

test('Ashby-style jobs: hybrid elsewhere is out, remote abroad is out, US remote and Seattle are in', () => {
  assert.equal(m.place('San Francisco; New York', { remote: false, country: 'US' }), null);
  assert.equal(m.place('Bucharest', { remote: true, country: 'other' }), null);
  assert.equal(m.place('Remote', { remote: true, country: 'US' }), 'remote');
  assert.equal(m.place('San Francisco; Remote; Seattle', { remote: false, country: 'US' }), 'area');
});

test('requiredYears reads the smallest experience requirement and ignores the rest', () => {
  assert.equal(requiredYears('- 3+ years of non-internship professional software development experience<br/>- 2+ years of design or architecture experience'), 2);
  assert.equal(requiredYears('Are 18 years of age or older. 8+ years of software engineering experience.'), 8);
  assert.equal(requiredYears('You have 5 years of experience programming in Java. Bonus: 10+ years in fintech.'), 5);
  assert.equal(requiredYears('Five or more years of professional experience building web apps.'), 5);
  assert.equal(requiredYears('Experience: 7-10 years in backend development.'), 7);
  assert.equal(requiredYears('Founded 12 years ago, we have offices in 5 countries.'), null);
  assert.equal(requiredYears(''), null);
});

test('filterJobs drops jobs that ask for more years than the limit', () => {
  const s = { ...DEFAULT_SETTINGS, maxYearsRequired: 5 };
  const job = (min_years) => ({ title: 'Senior Software Engineer', location: 'Remote - US', posted_at: null, min_years });
  const allowSenior = { ...s, levelExclude: s.levelExclude.filter((w) => w !== 'senior') };
  assert.equal(filterJobs([job(8)], allowSenior).length, 0);
  assert.equal(filterJobs([job(5)], allowSenior).length, 1);
  assert.equal(filterJobs([job(null)], allowSenior).length, 1);
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

test('postedLimit reads a company’s own cap on applications', () => {
  assert.deepEqual(postedLimit('Application Limit: Candidates may submit a maximum of 5 applications within a 6 month period.'),
    { max: 5, days: 183, label: '6 months' });
  assert.deepEqual(postedLimit('You may apply to up to 3 roles in a 30-day period.'), { max: 3, days: 30, label: '30 days' });
  assert.deepEqual(postedLimit('Candidates can apply for a maximum of three positions per year.'), { max: 3, days: 365, label: '1 year' });
  assert.deepEqual(postedLimit('Please submit no more than 2 applications within any rolling 12-month period.'), { max: 2, days: 366, label: '12 months' });
  for (const none of ['We review a maximum of applications each week.', 'Up to 5 years of experience within a fast-paced team.',
    'Our team reviews applications within 2 weeks.', '']) {
    assert.equal(postedLimit(none), null, none);
  }
});
