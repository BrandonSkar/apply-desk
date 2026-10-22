import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingLabels } from '../src/fillers/ashby.js';

test('reads which required fields Ashby says are missing', () => {
  // The error box as a whole, plus each line on its own (both show up on the page).
  const errs = [
    'Your form needs corrections\n\nMissing entry for required field: Why do you want to work at Baseten?\n\nMissing entry for required field: Have you ever interviewed at Baseten before?',
    'Missing entry for required field: Why do you want to work at Baseten?',
    'Missing entry for required field: Have you ever interviewed at Baseten before?',
  ];
  assert.deepEqual(missingLabels(errs), ['Why do you want to work at Baseten?', 'Have you ever interviewed at Baseten before?']);
  assert.deepEqual(missingLabels(['Please enter a valid email']), []);
});
