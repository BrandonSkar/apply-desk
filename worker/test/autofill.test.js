import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAnswers, autofill, bankKey, fromBank, looseKey, missingRequired, pickOption, pickYears, toBank, todayFor } from '../src/autofill.js';
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
  assert.equal(values.c, 'more than 3 years'); // any skill counts as your total years
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

test('work authorization vs. sponsorship vs. "have you worked at" wording', () => {
  const yn = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
  const sel = (name, label) => ({ name, label, type: 'select', required: true, options: yn });
  const form = {
    questions: [
      sel('a', 'Do you currently have unrestricted work authorization in the United States?'),
      sel('b', 'Will you require sponsorship to obtain work authorization in the US?'),
      sel('c', 'Have you previously worked at Stripe?'),
      sel('d', 'Are you currently employed by a Microsoft subsidiary?'),
      { name: 'e', label: 'How long have you been working with Python or Golang in a professional setting?', type: 'text', required: true },
      // ClickHouse: a sponsorship question that also says "right to work".
      sel('f', 'Do you require sponsorship by an employer for your right to work in your current location?'),
      sel('g', 'Are you legally authorized to work in the United States without the need for visa sponsorship?'),
      sel('h', 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, O-1, etc.)?'),
    ],
  };
  const { values } = autofill(form, { ...profile, work_authorized: 'Yes', needs_sponsorship: 'No' });
  assert.equal(values.a, 'Yes');
  assert.equal(values.b, 'No');
  assert.equal(values.c, 'No');
  assert.equal(values.d, 'No');
  assert.notEqual(values.e, 'No');
  assert.equal(values.f, 'No');
  assert.equal(values.g, 'Yes');
  assert.equal(values.h, 'No');
});

test('written questions use the profile answers (with the company name), plus location and country of residence', () => {
  const p = {
    ...profile, city: 'Auburn', state: 'WA', country: 'United States',
    essay_why: 'I want to work at {company} because of its product.',
    essay_built: 'I built Apply Desk.', essay_problem: 'Five platforms, one filler.', essay_fit: 'Four years shipping features.',
  };
  const t = (name, label, type = 'textarea') => ({ name, label, type, required: true });
  const form = {
    questions: [
      t('a', 'Why ElevenLabs, and why now?'),
      t('b', 'What makes you excited about the ElevenLabs mission?'),
      t('c', "What's the most impactful thing you've built? What was your specific contribution?"),
      t('d', 'Finally, tell us about a hard problem in your past!'),
      t('e', 'Why are you a good fit for this role?'),
      t('f', 'Briefly describe your experience with Ads products'),
      t('g', 'Location', 'text'),
      { name: 'h', label: "Country you're currently residing in", type: 'select', required: true,
        options: ['Canada', 'United States', 'Mexico'].map((l) => ({ label: l, value: l })) },
    ],
  };
  const { values, bucket } = autofill(form, p, new Map(), 'ElevenLabs');
  assert.equal(values.a, 'I want to work at ElevenLabs because of its product.');
  assert.equal(values.b, 'I want to work at ElevenLabs because of its product.');
  assert.equal(values.c, 'I built Apply Desk.');
  assert.equal(values.d, 'Five platforms, one filler.');
  assert.equal(values.e, 'Four years shipping features.');
  assert.equal(bucket.a, 'suggested');
  assert.equal(bucket.f, 'open');
  assert.equal(values.g, 'Auburn, WA');
  assert.equal(values.h, 'United States');

  // Other wordings of the same four questions.
  const more = autofill({ questions: [
    t('a', 'Walk us through your proudest achievement and how it relates to the role you are applying for.'),
    t('b', 'What made you decide to apply?'),
    t('c', 'What is the toughest bug you have tracked down?'),
    t('d', 'What makes you a strong candidate for this position?'),
    t('e', 'Tell us about an accomplishment you are most proud of.'),
    t('f', 'Describe a project where you used Kubernetes in production.'),
  ] }, p, new Map(), 'Baseten');
  assert.equal(more.values.a, 'I built Apply Desk.');
  assert.equal(more.values.b, 'I want to work at Baseten because of its product.');
  assert.equal(more.values.c, 'Five platforms, one filler.');
  assert.equal(more.values.d, 'Four years shipping features.');
  assert.equal(more.values.e, 'I built Apply Desk.');
  assert.equal(more.bucket.f, 'open'); // too specific for a saved answer
  // "...how it relates to the role": the saved answer fills in, and Claude may tie it to the job.
  assert.deepEqual(more.tailor, ['a']);

  // A product with its own name on the parent company's board ("Why Langfuse?" at ClickHouse).
  const named = autofill({ questions: [t('a', 'Why Langfuse?'), t('b', 'Why do you want to join?')] }, p, new Map(), 'ClickHouse');
  assert.equal(named.values.a, 'I want to work at Langfuse because of its product.');
  assert.equal(named.values.b, 'I want to work at ClickHouse because of its product.');
});

test('autoAnswers: only applications answered entirely from the profile and past answers go out on their own', () => {
  const yn = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
  const base = [
    { name: 'resume', label: 'Resume', type: 'file', kind: 'resume', required: true },
    { name: 'first_name', label: 'First Name', type: 'text', required: true },
    { name: 'auth', label: 'Are you legally authorized to work in the United States?', type: 'select', required: true, options: yn },
    { name: 'extra', label: 'Anything else?', type: 'textarea', required: false },
  ];
  const fillFor = (questions) => autofill({ questions }, { ...profile, work_authorized: 'Yes' });
  const ok = autoAnswers({ questions: base }, fillFor(base));
  assert.deepEqual(ok, { resume: '__resume__', first_name: profile.first_name, auth: 'Yes' });

  const open = [...base, { name: 'why', label: 'What draws you to this team?', type: 'textarea', required: true }];
  assert.equal(autoAnswers({ questions: open }, fillFor(open)), null);
  const file = [...base, { name: 'cl', label: 'Cover letter', type: 'file', required: true }];
  assert.equal(autoAnswers({ questions: file }, fillFor(file)), null);
  // A best guess on a required question still waits for you.
  const guessed = fillFor(base);
  guessed.bucket.auth = 'suggested';
  assert.equal(autoAnswers({ questions: base }, guessed), null);
});

test('Twitch form: applied-before from your history, H-1B, future roles, non-compete, platform years, office', () => {
  const yn = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
  const sel = (name, label, options = yn) => ({ name, label, type: 'select', required: true, options: options.map((l) => (typeof l === 'string' ? { label: l, value: l } : l)) });
  const form = { questions: [
    sel('amzn', 'Have you previously applied to Amazon or any Amazon subsidiary?'),
    sel('self', 'Have you applied to Twitch before?'),
    sel('emp', 'Are you currently a Twitch employee?'),
    sel('nc', 'Are you subject to a non-competition agreement or other agreement that would preclude or restrict your employment at Amazon?'),
    sel('h1b', 'Have you held H-1B status, or had an H-1B petition approved on your behalf, within the preceding 6 years for an employer other than a cap exempt institution?'),
    sel('future', 'Would you like to be considered for future opportunities at Twitch when you apply?'),
    sel('platform', 'How many years have you been active on the platform?', ['Less than 6 months', '1-2 years', '3-5 years', '5+ years']),
    sel('office', 'Are you open to relocation?', ['San Francisco, CA', 'Seattle, WA', 'New York, NY', 'Not open to relocation']),
    sel('years', 'How many years of professional software engineering experience do you have?', ['0-2', '3-5', '6+']),
  ] };
  const p = { ...EMPTY_PROFILE, ...profile, citizenship: 'United States of America', years_experience: '4' };
  const { values, bucket } = autofill(form, p, new Map(), 'Twitch', { applied: ['Amazon', 'DoorDash USA'] });
  assert.equal(values.amzn, 'Yes');
  assert.equal(values.self, 'No'); // Amazon applications don't count as Twitch ones
  assert.equal(values.emp, 'No');
  assert.equal(values.nc, 'No');
  assert.equal(values.h1b, 'No');
  assert.equal(values.future, 'Yes');
  assert.equal(values.platform, undefined); // not work experience
  assert.equal(values.office, 'Seattle, WA');
  assert.equal(values.years, '3-5');
  assert.equal(bucket.amzn, 'auto');

  const fresh = autofill(form, p, new Map(), 'Twitch', { applied: ['DoorDash USA'] });
  assert.equal(fresh.values.amzn, 'No');
  // Names are matched loosely ("DoorDash USA" is DoorDash).
  const dd = autofill({ questions: [sel('x', 'Have you ever applied to DoorDash in the past?')] }, p, new Map(), 'DoorDash', { applied: ['DoorDash USA'] });
  assert.equal(dd.values.x, 'Yes');
});

test('SoFi form: home address, today\'s date, FINRA, required SMS consent, commute to the job, degree field', () => {
  const opts = (...l) => l.map((x) => ({ label: x, value: x }));
  const sel = (name, label, options = ['Yes', 'No'], type = 'select') => ({ name, label, type, required: true, options: opts(...options) });
  const text = (name, label) => ({ name, label, type: 'text', required: true });
  const form = { questions: [
    sel('auth', 'Are you authorized to lawfully work in the country where this role is located?'),
    sel('years', "How many year's of experience do you have directly related to this role?", ['0-1 Years', '1-2 Years', '2-3 Years', '3-4 Years', '5+ Years']),
    sel('sms', 'I acknowledge that by providing my phone number, I agree to receive text messages from SoFi Technologies in relation to this job application. Reply STOP to opt-out.', ['Yes']),
    sel('emp', 'Are you currently a SoFi or SoFi Tech Solutions (formerly Galileo) employee?'),
    text('date', "Today's Date of Application (MM/DD/YY Format)"),
    sel('finra', 'Do you currently hold, or intend to hold, any FINRA licenses if employed by SoFi? (i.e., Series 7, Series 24, etc.)'),
    sel('licenses', 'What FINRA license(s), if any, do you currently hold?', ['N/A', 'Series 3 (S3)', 'Series 7 (S7)'], 'multiselect'),
    sel('commute', "Are you currently located within, or planning to relocate to be within, a reasonable commute of any of this job's listed hiring locations?"),
    text('a1', 'Home Address Line 1'),
    { name: 'a2', label: 'Home Address Line 2', type: 'text', required: false },
    text('city', 'Home Address City'),
    text('state', 'Home Address State'),
    sel('country', 'Home Address Country', ['United States of America', 'Argentina', 'Canada']),
    text('field', 'What is your degree in?'),
    sel('degree', 'What kind of degree do you have, if any?', ["Master's", "Bachelor's", 'No Degree']),
  ] };
  const p = { ...profile, address: '100 Main St', city: 'Auburn', state: 'WA', country: 'United States', sms_opt_in: 'No',
    years_experience: '4', degree: "Bachelor's Degree", discipline: 'Software Development', willing_to_relocate: 'No' };
  const { values, bucket } = autofill(form, p, new Map(), 'SoFi', { location: 'WA - Seattle' });
  assert.equal(values.auth, 'Yes');
  assert.equal(values.years, '3-4 Years');
  assert.equal(values.sms, 'Yes'); // the form won't send without it
  assert.equal(values.emp, 'No');
  assert.match(values.date, /^\d\d\/\d\d\/\d\d$/);
  assert.equal(values.finra, 'No');
  assert.deepEqual(values.licenses, ['N/A']);
  assert.equal(values.commute, 'Yes');
  assert.equal(values.a1, '100 Main St');
  assert.equal(values.a2, undefined);
  assert.equal(values.city, 'Auburn');
  assert.equal(values.state, 'WA');
  assert.equal(values.country, 'United States of America');
  assert.equal(values.field, 'Software Development');
  assert.equal(values.degree, "Bachelor's");
  for (const k of ['auth', 'sms', 'date', 'finra', 'licenses', 'commute', 'a1', 'city', 'state', 'country']) assert.equal(bucket[k], 'auto', k);

  // A job you'd have to move for gets your relocation answer, for you to check.
  const far = autofill(form, p, new Map(), 'SoFi', { location: 'CA - San Francisco' });
  assert.equal(far.values.commute, 'No');
  assert.equal(far.bucket.commute, 'suggested');
});

test('experience with anything is your total years; work authorization for another country is a no', () => {
  const sel = (name, label, options = yn) => ({ name, label, type: 'select', required: true,
    options: options.map((l) => (typeof l === 'string' ? { label: l, value: l } : l)) });
  const rust = ['Less than 1 year', '1 to less than 2 years', '2 to less than 3 years', '3 to less than 4 years', '4 to less than 5 years', '5 years or more'];
  const form = { questions: [
    sel('java', 'Do you possess 5 years of experience with programming in Java, Scala, or Python?'),
    sel('plus', 'Do you have 5+ years of professional experience?'),
    sel('fin', 'Do you possess 4 years of experience with working in fintech domain?'),
    sel('spark', 'Do you possess 1 year of experience with Apache Spark or similar modern Big Data technologies?'),
    sel('sdlc', 'Do you have experience with full software development life cycle, including coding standards and code reviews?'),
    sel('rust', 'Approximately how long have you actively used Rust to build or contribute to projects?', rust),
    sel('design', 'Which option best describes your total non-internship design or architecture (design patterns, reliability and scaling) of new and existing systems experience?',
      ['less than 2 years', '2 years to less than 3 years', '3 years to less than 4 years', '4 years to less than 5 years', 'more than 5 years']),
    { name: 'react', label: 'How many years of experience do you have with React?', type: 'text', required: true },
    { name: 'tell', label: 'Tell us about your experience with React.', type: 'textarea', required: true },
    sel('prior', 'Have you had prior work experience at Stripe?'),
    sel('ca', 'Are you legally entitled to work in Canada?'),
    sel('us', 'Are you legally authorized to work in the United States?'),
  ] };
  const p = { ...profile, years_experience: '4', citizenship: 'United States of America', work_authorized: 'Yes' };
  const { values, bucket } = autofill(form, p, new Map(), 'Stripe');
  assert.equal(values.java, 'No');
  assert.equal(values.plus, 'No');
  assert.equal(values.fin, 'Yes');
  assert.equal(values.spark, 'Yes');
  assert.equal(values.sdlc, 'Yes');
  assert.equal(values.rust, '4 to less than 5 years');
  assert.equal(values.design, '4 years to less than 5 years');
  assert.equal(values.react, '4');
  assert.equal(values.tell, undefined);
  assert.equal(values.prior, 'No'); // a former-employee question
  assert.equal(bucket.prior, 'suggested');
  for (const k of ['java', 'fin', 'sdlc', 'rust', 'design', 'react']) assert.equal(bucket[k], 'auto', k);
  assert.equal(values.ca, 'No');
  assert.equal(values.us, 'Yes');
  assert.equal(autofill(form, { ...p, years_experience: '' }).values.java, undefined);
  // Your own answer to the same question last time stands.
  const bank = new Map([[bankKey(form.questions[3].label, 'Stripe', 'select'), 'No']]);
  assert.equal(autofill(form, p, bank, 'Stripe').values.spark, 'No');
});

test('Alpaca form: full mailing address on one line, full legal name, location and time zone', () => {
  const text = (name, label) => ({ name, label, type: 'text', required: true });
  const form = { questions: [
    text('addr', 'Please provide full mailing address (permanent & shipping)'),
    text('name', 'Please provide your full legal birth name (as seen on government-issued ID)'),
    text('tz', 'Which location and timezone will you be working from?'),
    text('line1', 'Home Address Line 1'),
    text('email', 'Full email address'),
    text('ref', 'Full name of your referrer'),
    text('other', 'Have you used a different legal name?'),
  ] };
  const p = { ...profile, address: '100 Main St', city: 'Auburn', state: 'WA', zip: '98092', country: 'United States' };
  const { values, bucket } = autofill(form, p);
  assert.equal(values.addr, '100 Main St, Auburn, WA 98092, United States');
  assert.equal(values.name, 'Sam Rivera');
  assert.equal(bucket.addr, 'auto');
  assert.equal(bucket.name, 'auto');
  assert.equal(values.tz, 'Auburn, WA (Pacific Time)');
  assert.equal(values.line1, '100 Main St');
  assert.equal(values.email, 'sam@example.com');
  assert.equal(values.ref, undefined);
  assert.equal(values.other, undefined);
});

test('a required question with one box to tick takes it; an optional one is left alone', () => {
  const one = (name, required) => ({ name, type: 'multiselect', required, options: [{ label: 'I understand that next steps will be sent via email and I have marked the sender address above as safe.', value: 'x' }],
    label: 'Stay Connected | To ensure you receive status updates and interview invitations, please add no-reply@hire.lever.co to your safe sender list.' });
  const { values, bucket } = autofill({ questions: [one('a', true), one('b', false)] }, profile);
  assert.deepEqual(values.a, ['I understand that next steps will be sent via email and I have marked the sender address above as safe.']);
  assert.equal(bucket.a, 'auto');
  assert.equal(values.b, undefined);
});

test("today's date: Pacific time, in the label's format", () => {
  const late = new Date('2026-10-27T05:30:00Z'); // still Oct 26 in Seattle
  assert.equal(todayFor("Today's Date (MM/DD/YY)", late), '10/26/26');
  assert.equal(todayFor('Application date (YYYY-MM-DD)', late), '2026-10-26');
  assert.equal(todayFor('Date of signature', late), '10/26/2026');
});

test('cover letters: a saved one written for another company is not reused; the job gets its own', () => {
  const cl = { name: 'cover_letter_text', label: 'Cover Letter', type: 'textarea', kind: 'cover_letter', required: true };
  const bank = new Map([[bankKey('Cover Letter', 'Tailscale', 'textarea'), 'Dear {company}, I love private networks.']]);
  const { values, bucket, tailor } = autofill({ questions: [cl] }, { ...profile, essay_fit: 'I build features end to end.' }, bank, 'SoFi');
  assert.equal(values.cover_letter_text, 'I build features end to end.');
  assert.equal(bucket.cover_letter_text, 'suggested');
  assert.deepEqual(tailor, ['cover_letter_text']);
});

test('pickOption and pickYears', () => {
  const opts = ['No, I will not require sponsorship', 'Yes, I will'].map((l) => ({ label: l, value: l }));
  assert.equal(pickOption(opts, [/^\s*no\b/i]), 'No, I will not require sponsorship');
  assert.equal(pickYears(['Less than 1 year', '1-2 years', '3+ years'].map((l) => ({ label: l })), '3'), '3+ years');
  assert.equal(pickYears(['0', '1', '2', '3', '4'].map((l) => ({ label: l })), 3), '3');
});
