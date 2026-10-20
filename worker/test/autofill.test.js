import test from 'node:test';
import assert from 'node:assert/strict';
import { autofill, bankKey, fromBank, looseKey, missingRequired, pickOption, pickYears, toBank } from '../src/autofill.js';
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

test('past answers to choice questions are reused without asking; looser wording still matches', () => {
  const yn = [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }];
  const bank = new Map([
    [bankKey('Have you worked at DoorDash?', 'DoorDash', 'select'), toBank('No', 'DoorDash')],
    [bankKey('Applicant Privacy Acknowledgement', 'Acme', 'select'), 'Yes'],
  ]);
  bank.loose = new Map([...bank].map(([k, v]) => [looseKey(k), v]));
  const form = {
    questions: [
      { name: 'a', label: 'Have you worked at Stripe?', type: 'select', required: true, options: yn },
      { name: 'b', label: 'Applicant Privacy Acknowledgement', type: 'select', required: true, options: yn },
      { name: 'c', label: 'Have you ever worked at the Stripe?', type: 'select', required: true, options: yn },
    ],
  };
  const { values, bucket } = autofill(form, profile, bank, 'Stripe');
  assert.equal(values.a, 'No');
  assert.equal(bucket.a, 'auto');
  assert.equal(values.b, 'Yes');
  assert.equal(bucket.b, 'auto');
  assert.equal(values.c, 'No'); // via the looser key
  assert.equal(bucket.c, 'auto');
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

test('voluntary self-ID follows the profile, in the form\'s own wording', () => {
  const sel = (name, label, labels) => ({ name, label, type: 'select', required: false, section: 'demographic', options: labels.map((l) => ({ label: l, value: l })) });
  const form = {
    questions: [
      sel('g', 'Gender', ['Male', 'Female', 'Decline to self-identify']),
      sel('gi', 'How do you identify? (gender identity)', ['Woman', 'Man', 'Non-binary', 'I prefer not to say']),
      sel('v', 'Protected Veteran Status', [
        'I identify as one or more of the classifications of a protected veteran',
        'I identify as a veteran but not a protected veteran',
        'I am not a protected veteran',
        "I don't wish to answer",
      ]),
      sel('d', 'Disability Status', [
        'Yes, I have a disability (or previously had a disability)',
        'No, I do not have a disability and have not had one in the past',
        'I do not want to answer',
      ]),
      sel('r', 'Race', ['Asian', 'Black or African American (Not Hispanic or Latino)', 'White (Not Hispanic or Latino)', 'Decline To Self Identify']),
      sel('h', 'Are you Hispanic/Latino?', ['Yes', 'No', 'Decline To Self Identify']),
      sel('so', 'What sexual orientation do you most closely identify with?', ['Bisexual', 'Gay', 'Straight / Heterosexual', "I don't wish to answer"]),
      sel('t', 'Are you a person of transgender experience?', ['Yes', 'No', "I don't wish to answer"]),
      sel('l', 'Do you identify as a member of the LGBTQ+ community?', ['Yes', 'No', "I don't wish to answer"]),
    ],
  };
  const p = {
    ...profile, gender: 'Male', veteran: 'Not a veteran', disability: 'No disability',
    race: 'Decline', sexual_orientation: 'Decline', transgender: 'Decline',
  };
  const { values } = autofill(form, p);
  assert.equal(values.g, 'Male');
  assert.equal(values.gi, 'Man');
  assert.equal(values.v, 'I am not a protected veteran');
  assert.equal(values.d, 'No, I do not have a disability and have not had one in the past');
  assert.equal(values.r, 'Decline To Self Identify');
  assert.equal(values.h, 'Decline To Self Identify');
  assert.equal(values.so, "I don't wish to answer");
  assert.equal(values.l, "I don't wish to answer");

  const all = autofill(form, { ...p, race: 'White', sexual_orientation: 'Heterosexual', transgender: 'No' }).values;
  assert.equal(all.r, 'White (Not Hispanic or Latino)');
  assert.equal(all.h, 'No');
  assert.equal(all.so, 'Straight / Heterosexual');
  assert.equal(all.t, 'No');
  assert.equal(all.l, 'No');
  assert.equal(all.gi, 'Man');
  // Declining everything still declines.
  const none = autofill(form, profile).values;
  assert.equal(none.g, 'Decline to self-identify');
  assert.equal(none.v, "I don't wish to answer");
});

test('pronouns: dropdowns pick the matching option, text boxes get the profile value', () => {
  const p = { ...profile, pronouns: 'He/him/his' };
  const form = {
    questions: [
      { name: 'a', label: 'Pronouns', type: 'select', required: true,
        options: ['She/her/hers', 'He/him/his', 'They/them/theirs', 'I prefer not to say'].map((l) => ({ label: l, value: l })) },
      { name: 'b', label: 'Pronouns', type: 'select', required: false,
        options: ['she/her', 'he/him', 'they/them'].map((l) => ({ label: l, value: l })) },
      { name: 'c', label: 'How should we refer to you (nickname and/or pronouns)?', type: 'text', required: false },
      { name: 'd', label: 'Name Pronunciation', type: 'text', required: false },
    ],
  };
  const { values, bucket } = autofill(form, p);
  assert.equal(values.a, 'He/him/his');
  assert.equal(values.b, 'he/him');
  assert.equal(values.c, 'He/him/his');
  assert.equal(values.d, undefined);
  assert.equal(bucket.a, 'auto');
  assert.equal(autofill(form, profile).bucket.a, 'open'); // no pronouns in the profile: still asks
});

test('SMS opt-ins are declined or left unchecked; other consent boxes still get acknowledged', () => {
  const opts = (...l) => l.map((x) => ({ label: x, value: x }));
  const form = {
    questions: [
      { name: 'a', label: 'Would you like to receive SMS updates about your application?', type: 'select', required: true, options: opts('Yes', 'No') },
      { name: 'b', label: 'Text message consent', type: 'multiselect', required: false, options: opts('I agree to receive text messages from Acme about my application') },
      { name: 'c', label: 'Opt in to text notifications', type: 'select', required: false, options: opts('Yes, text me', 'No, do not text me') },
      { name: 'd', label: 'By checking this box, I acknowledge the privacy notice', type: 'multiselect', required: true, options: opts('Acknowledge') },
      { name: 'e', label: 'Mobile phone number', type: 'text', required: true },
    ],
  };
  const { values, bucket } = autofill(form, { ...profile, sms_opt_in: 'No' });
  assert.equal(values.a, 'No');
  assert.equal(values.b, undefined);
  assert.equal(bucket.b, 'auto');
  assert.equal(values.c, 'No, do not text me');
  assert.deepEqual(values.d, ['Acknowledge']);
  assert.equal(values.e, '555-0100');
  assert.equal(autofill(form, { ...profile, sms_opt_in: 'Yes' }).values.a, 'Yes');
});

test('government ties: answered No, but clearance and eligibility questions are left alone', () => {
  const yn = (name, label) => ({ name, label, type: 'select', required: true, options: [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }] });
  const form = {
    questions: [
      yn('a', 'Are you a current or former government official?'),
      yn('b', 'Have you ever been employed by a federal, state, or local government entity?'),
      yn('c', 'Is any member of your immediate family a government official?'),
      { name: 'd', label: 'Are you now, or have you been in the last two years, a government employee?', type: 'select', required: true,
        options: ['Yes, I am or have been a government employee', 'No, I have not been a government employee'].map((l) => ({ label: l, value: l })) },
      yn('e', 'Are you eligible to obtain a U.S. government security clearance?'),
      yn('f', 'Are you able to work on government contracts?'),
      { name: 'g', label: 'Do you have any relatives who are government officials? If so, list them.', type: 'text', required: false },
    ],
  };
  const { values, bucket } = autofill(form, { ...profile, government_ties: 'No' });
  assert.equal(values.a, 'No');
  assert.equal(values.b, 'No');
  assert.equal(values.c, 'No');
  assert.equal(values.d, 'No, I have not been a government employee');
  assert.equal(values.e, undefined);
  assert.equal(values.f, undefined);
  assert.equal(values.g, 'No');
  assert.equal(bucket.a, 'auto');
  assert.equal(autofill(form, { ...profile, government_ties: 'Yes' }).values.a, undefined);
});

test('Amazon: experience ranges, degree yes/no, presets from the site, and work eligibility', () => {
  const sel = (name, label, labels, extra = {}) => ({ name, label, type: 'select', required: true, options: labels.map((l) => ({ label: l, value: l })), ...extra });
  const twoYear = ['less than 2 years', '2 years to less than 3 years', '3 years to less than 4 years', '4 years to less than 5 years', 'more than 5 years'];
  const tenMonth = ['less than 10 months', '10 months to less than 1 year', '1 year to less than 2 years', '2 years to less than 3 years', 'more than 3 years'];
  const form = {
    questions: [
      sel('a', 'Which option best describes your total non-internship professional software development experience?', twoYear),
      sel('b', 'Which option best describes your total software development engineer or related occupational experience?', tenMonth),
      sel('c', 'Which option best describes your total Object Oriented Design experience?', tenMonth),
      sel('d', "Do you have a Bachelor's degree or foreign equivalent in Computer Science, Engineering, Mathematics, or a related field?", ['Yes', 'No']),
      sel('e', 'Have you previously applied to Amazon or any Amazon subsidiary or affiliate?', ['Yes', 'No'], { preset: 'Yes' }),
      sel('f', 'If offered employment by Amazon, would you be legally eligible to begin employment immediately?', ['Yes', 'No']),
      sel('g', 'In which country/region do you have citizenship?', ['Afghanistan', 'United States Minor Outlying Islands', 'United States Of America']),
      sel('h', 'Are you currently or, in the past three years, have you been a direct employee of any government entity?',
        ['No, I was NEVER a government employee.', 'Yes, I am a FORMER government employee.', 'Yes, I am a CURRENT government employee']),
    ],
  };
  const p = { ...profile, years_experience: '4', degree: "Bachelor's Degree", citizenship: 'United States of America', government_ties: 'No' };
  const { values, bucket } = autofill(form, p, new Map(), 'Amazon');
  assert.equal(values.a, '4 years to less than 5 years');
  assert.equal(values.b, 'more than 3 years');
  assert.equal(bucket.c, 'open'); // skill-specific: from your answer bank, or you
  assert.equal(values.d, 'Yes');
  assert.equal(values.e, 'Yes');
  assert.equal(bucket.e, 'auto');
  assert.equal(values.f, 'Yes');
  assert.equal(values.g, 'United States Of America');
  assert.equal(values.h, 'No, I was NEVER a government employee.');
  assert.equal(pickYears(tenMonth.map((l) => ({ label: l })), 0.5), 'less than 10 months');
  assert.equal(pickYears(tenMonth.map((l) => ({ label: l })), 0.9), '10 months to less than 1 year');
  assert.equal(pickYears(twoYear.map((l) => ({ label: l })), 3), '3 years to less than 4 years');
});

test('Microsoft: profile email beats the site\'s, other site text is kept, legal name, address line 2', () => {
  const yn = [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }];
  const form = {
    questions: [
      { name: 'e', label: 'Email', type: 'text', required: true, preset: 'someone@hotmail.com' },
      { name: 'ph', label: 'Phone number', type: 'text', required: true, preset: '2065550100' },
      { name: 'ln', label: 'Preferred Last Name', type: 'text', required: true, preset: 'Rivera' },
      { name: 'leg', label: 'Is your legal name the same as your preferred name?', type: 'select', required: true, options: yn },
      { name: 'a1', label: 'Address', type: 'text', required: true },
      { name: 'a2', label: 'Address Line 2', type: 'text', required: false },
      { name: 'af', label: 'U.S. Armed Forces Status', type: 'select', required: true,
        options: ['I am currently serving (or have served)', 'I have not served', 'I prefer not to answer'].map((l) => ({ label: l, value: l })) },
      { name: 'gov', label: 'Are you currently or have you ever been a member of the military, a civilian employee, or an official of any government, whether national, state, local, or foreign?', type: 'select', required: true, options: yn },
      { name: 'loc', label: 'Where would you like to apply for Software Engineer II', type: 'select', required: true, options: [{ label: 'United States, Washington, Redmond', value: 'x' }] },
    ],
  };
  const p = { ...profile, address: '123 Main St', veteran: 'Not a veteran', government_ties: 'No' };
  const { values } = autofill(form, p);
  assert.equal(values.e, 'sam@example.com');
  assert.equal(values.ph, '2065550100');
  assert.equal(values.ln, 'Rivera');
  assert.equal(values.leg, 'Yes');
  assert.equal(values.a1, '123 Main St');
  assert.equal(values.a2, undefined);
  assert.equal(values.af, 'I have not served');
  assert.equal(values.gov, 'No');
  assert.equal(values.loc, 'United States, Washington, Redmond');
  assert.equal(autofill(form, { ...p, preferred_name: 'Sammy' }).values.leg, undefined);
});

test('pickOption and pickYears', () => {
  const opts = ['No, I will not require sponsorship', 'Yes, I will'].map((l) => ({ label: l, value: l }));
  assert.equal(pickOption(opts, [/^\s*no\b/i]), 'No, I will not require sponsorship');
  assert.equal(pickYears(['Less than 1 year', '1-2 years', '3+ years'].map((l) => ({ label: l })), '3'), '3+ years');
  assert.equal(pickYears(['0', '1', '2', '3', '4'].map((l) => ({ label: l })), 3), '3');
});
