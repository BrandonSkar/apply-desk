import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationRank } from '../src/fillers/common.js';

test('location suggestions: only your city, state or country count', () => {
  const rank = (t) => locationRank(t, 'Auburn, WA');
  assert.equal(rank('Auburn, Washington, United States'), 3);
  assert.equal(rank('Auburn, WA, USA'), 3);
  // Region-only boxes (ElevenLabs) list "Wales" first for "WA".
  assert.equal(rank('Washington, United States'), 2);
  assert.equal(rank('United States'), 1);
  for (const wrong of ['Wales, United Kingdom', 'Washington, District of Columbia, United States', 'Auburn, New York, United States',
    'Auburn Vale, New South Wales, Australia', 'US Virgin Islands', 'United States Minor Outlying Islands']) {
    assert.equal(rank(wrong), 0, wrong);
  }
});
