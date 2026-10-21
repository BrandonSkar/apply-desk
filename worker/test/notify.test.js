import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySummary, localDay } from '../src/notify.js';

test('localDay: the Pacific date, hour and midnight, across daylight saving', () => {
  // 8:30pm PDT on Oct 21 is 03:30 UTC on Oct 22.
  const pdt = localDay('America/Los_Angeles', new Date('2026-10-22T03:30:00Z'));
  assert.equal(pdt.date, '2026-10-21');
  assert.equal(pdt.hour, 20);
  assert.equal(pdt.start, '2026-10-21T07:00:00.000Z');
  assert.equal(pdt.label, 'Wednesday, October 21');
  // Winter: PST is UTC-8.
  assert.equal(localDay('America/Los_Angeles', new Date('2026-12-02T01:00:00Z')).start, '2026-12-01T08:00:00.000Z');
});

test('dailySummary: what went out, what waits on you, and what’s next', () => {
  const s = dailySummary({
    label: 'Wednesday, October 21',
    goal: 10,
    sent: [
      { company: 'Coinbase', title: 'Senior Frontend Engineer', status: 'submitted' },
      { company: 'Honeycomb.io', title: 'Senior Software Engineer II', status: 'needs_you' },
    ],
    needsYou: [{ company: 'Honeycomb.io', title: 'Senior Software Engineer II', needs: 'code', note: 'x' }],
    queue: 66,
    found: 14,
    total: 75,
    holds: [{ company: 'ElevenLabs', reason: 'their limit', untilLabel: 'Nov 19' }],
  });
  assert.equal(s.subject, 'Apply Desk: 2 applications sent today (goal 10)');
  assert.match(s.text, /Coinbase · Senior Frontend Engineer \(sent\)/);
  assert.match(s.text, /Honeycomb\.io · Senior Software Engineer II: enter the emailed code/);
  assert.match(s.text, /66 jobs ready for you to review/);
  assert.match(s.text, /ElevenLabs until Nov 19 \(their limit\)/);
  assert.match(s.html, /<li>Coinbase · Senior Frontend Engineer \(sent\)<\/li>/);
  assert.equal(s.pushMessage, '2 sent (goal 10) · 1 waiting on you · 66 in your queue');

  const quiet = dailySummary({ label: 'Thursday', goal: 10, sent: [], needsYou: [], queue: 0, found: 0, total: 0, holds: [] });
  assert.ok(!/Waiting on you|On hold/.test(quiet.text));
  assert.match(quiet.text, /0 applications sent today/);
});
