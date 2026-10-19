import test from 'node:test';
import assert from 'node:assert/strict';
import { autofill, bankKey, fromBank, missingRequired, pickOption, pickYears, toBank } from '../src/autofill.js';
import { EMPTY_PROFILE } from '../src/defaults.js';

const profile = {
  ...EMPTY_PROFILE,
  first_name: 'Sam', last_name: 'Rivera', email: 'sam@example.com', phone: '555-0100',
  city: 'Renton', state: 'WA', linkedin: 'https://linkedin.com/in/sam',
  current_company: 'Acme', current_title: 'Application Developer', years_experience: '3',
  desired_salary: '$140,000',
};

const yn = [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }];

// Modeled on a real Greenhouse form (Twilio).
const ghForm = {
  questions: [
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true },
    { name: 'preferred_name', label: 'Preferred First Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'text', required: true },
    { name: 'resume', label: 'Resume/CV', type: 'file', kind: 'resume', required: true },
    { name: 'question_1', label: 'LinkedIn Profile URL', type: 'text', required: false },
    { name: 'question_2[]', label: 'How did you hear about Twilio?', type: 'multiselect', required: true,
      options: [{ label: 'Careers Website', value: '1' }, { label: 'LinkedIn', value: '2' }, { label: 'Other', value: '3' }] },
    { name: 'question_3', label: 'Are you legally authorized to work in the United States?', type: 'select', required: true, options: yn },
    { name: 'question_4', label: 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?', type: 'select', required: true, options: yn },
    { name: 'question_5', label: 'Briefly describe your experience with Ads products', type: 'textarea', required: true },
    { name: 'demographic_9', label: 'Voluntary Self-Identification of Gender', type: 'select', required: true, section: 'demographic',
      options: [{ label: 'Male', value: 'a' }, { label: 'Female', value: 'b' }, { label: "I don't wish to answer", value: 'c' }] },
    { name: 'location', label: 'Location', type: 'text', kind: 'location', required: true },
  ],
};

test('fills identity and eligibility from the profile, leaves real questions open', () => {
  const { values, bucket } = autofill(ghForm, profile, new Map(), 'Twilio');
  assert.equal(values.first_name, 'Sam');
  assert.equal(values.preferred_name, 'Sam');
  assert.equal(values.resume, '__resume__');
  assert.equal(values.question_1, 'https://linkedin.com/in/sam');
  assert.equal(values.question_3, 'Yes');
  assert.equal(values.question_4, 'No');
  assert.equal(values.demographic_9, "I don't wish to answer");
  assert.equal(values.location, 'Renton, WA');
  assert.deepEqual(values['question_2[]'], ['Careers Website']);
  assert.equal(bucket.question_3, 'auto');
  assert.equal(bucket['question_2[]'], 'suggested');
  assert.equal(bucket.question_5, 'open');
  assert.deepEqual(missingRequired(ghForm, values).map((q) => q.name), ['question_5']);
});

test('uses past answers, swapping the company name', () => {
  const q = { name: 'x', label: 'Why do you want to work at Twilio?', type: 'textarea', required: true };
  const stored = toBank('I like what Twilio builds.', 'Twilio');
  const bank = new Map([[bankKey(q.label, 'Twilio', 'textarea'), stored]]);
  const other = { ...q, label: 'Why do you want to work at Stripe?' };
  const { values, bucket } = autofill({ questions: [other] }, profile, new Map([[bankKey(other.label, 'Stripe', 'textarea'), stored]]), 'Stripe');
  assert.equal(values.x, 'I like what Stripe builds.');
  assert.equal(bucket.x, 'suggested');
  assert.equal(fromBank(stored, 'Twilio'), 'I like what Twilio builds.');
  assert.ok(bank.size === 1);
});

test('lever-style questions: radio years buckets and live-near-Seattle', () => {
  const form = {
    questions: [
      { name: 'name', label: 'Full name', type: 'text', required: true },
      { name: 'org', label: 'Current company', type: 'text', required: false },
      { name: 'c1', label: 'How many years of professional software development experience do you have?', type: 'select', required: true,
        options: ['0-1 year', '1-3 years', '4-6 years', 'Over 6 years'].map((l) => ({ label: l, value: l })) },
      { name: 'c2', label: 'Do you currently live in or near Seattle? If not, are you willing to relocate to Seattle for the right opportunity?', type: 'select', required: true,
        options: [{ label: 'YES', value: 'YES' }, { label: 'NO', value: 'NO' }] },
      { name: 'c3', label: 'What is your desired salary?', type: 'text', required: true },
      { name: 'c4', label: 'Do you or will you require sponsorship in the future to work in the U.S.?', type: 'select', required: true,
        options: [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }] },
    ],
  };
  const { values } = autofill(form, profile);
  assert.equal(values.name, 'Sam Rivera');
  assert.equal(values.org, 'Acme');
  assert.equal(values.c1, '1-3 years');
  assert.equal(values.c2, 'YES');
  assert.equal(values.c3, '$140,000');
  assert.equal(values.c4, 'No');
});

test('pickOption and pickYears', () => {
  const opts = ['No, I will not require sponsorship', 'Yes, I will'].map((l) => ({ label: l, value: l }));
  assert.equal(pickOption(opts, [/^\s*no\b/i]), 'No, I will not require sponsorship');
  assert.equal(pickYears(['Less than 1 year', '1-2 years', '3+ years'].map((l) => ({ label: l })), '3'), '3+ years');
  assert.equal(pickYears(['0', '1', '2', '3', '4'].map((l) => ({ label: l })), 3), '3');
});
