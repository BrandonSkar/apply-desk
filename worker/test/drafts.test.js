import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFacts, draftable, draftPrompt, toValues } from '../src/drafts.js';

const form = {
  description: 'We build observability tools.',
  questions: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'obs', label: 'Have you owned or supported an Observability system? If yes - explain:', type: 'textarea', required: true },
    { name: 'split', label: 'How much time do you spend coding vs. operations work?', type: 'text', required: true },
    { name: 'ai', label: 'Which of the following best describes how you use AI tools?', type: 'select', required: true,
      options: [{ label: 'I don’t use them' }, { label: 'I design or automate workflows with AI tools' }] },
    { name: 'langs', label: 'Languages you know', type: 'multiselect', required: false,
      options: [{ label: 'JavaScript' }, { label: 'C#' }, { label: 'Rust' }] },
    { name: 'cv', label: 'Cover letter', type: 'file', required: false },
    { name: 'race', label: 'Race', type: 'select', section: 'demographic', options: [{ label: 'White' }] },
    { name: 'empty', label: 'Pick one', type: 'select', required: true, options: [] },
  ],
};
const fill = { values: { name: 'Brandon Skar' }, bucket: { name: 'auto', obs: 'open' } };

test('drafts cover every unanswered question except files, self-ID and choices without options', () => {
  assert.deepEqual(draftable(form, fill).map((q) => q.name), ['obs', 'split', 'ai', 'langs']);
  // A saved answer the question asks to tie to the role is redrafted; other saved answers are left alone.
  const tailored = { ...fill, bucket: { ...fill.bucket, obs: 'suggested', split: 'suggested' }, tailor: ['obs'] };
  assert.deepEqual(draftable(form, tailored).map((q) => q.name), ['obs', 'ai', 'langs']);
});

test('facts include work history and background, not contact details or self-ID', () => {
  const facts = candidateFacts({
    first_name: 'Brandon', last_name: 'Skar', email: 'me@example.com', phone: '555-0100', address: '1 Main St',
    city: 'Auburn', state: 'WA', country: 'United States', current_title: 'Application Developer', current_company: 'Xpressdocs',
    job_start_month: 'August', job_start_year: '2022', job_current: 'Yes', years_experience: '4', gender: 'Male',
    background: 'Built Apply Desk.', essay_why: 'I want to work at {company}.',
  });
  assert.match(facts, /Application Developer at Xpressdocs \(since August 2022\)/);
  assert.match(facts, /Built Apply Desk\./);
  assert.match(facts, /I want to work at \{company\}\./);
  for (const secret of ['me@example.com', '555-0100', '1 Main St', 'Male']) assert.ok(!facts.includes(secret), secret);
});

test('the prompt lists each question with an id, its kind and options', () => {
  const qs = draftable(form, fill);
  const prompt = draftPrompt({ company: 'Honeycomb', title: 'Senior Engineer' }, form, qs);
  assert.match(prompt, /<question id="q1" type="written answer" required="yes">/);
  assert.match(prompt, /<question id="q3" type="choose one" required="yes">[\s\S]*- I design or automate workflows with AI tools/);
  assert.match(prompt, /We build observability tools\./);
});

test('answers map back to fields; choices must be real options', () => {
  const qs = draftable(form, fill);
  const values = toValues(qs, [
    { id: 'q1', text: '  Not as the owner of one.  ', choices: [] },
    { id: 'q2', text: '', choices: [] },
    { id: 'q3', text: '', choices: ['i design or automate workflows with ai tools'] },
    { id: 'q4', text: '', choices: ['JavaScript', 'Go', 'C#', 'JavaScript'] },
  ]);
  assert.deepEqual(values, {
    obs: 'Not as the owner of one.',
    ai: 'I design or automate workflows with AI tools',
    langs: ['JavaScript', 'C#'],
  });
  assert.deepEqual(toValues(qs, [{ id: 'q3', text: '', choices: ['Something else'] }]), {});
});

test('draftAnswers sends the facts and questions, and reads Claude’s structured reply', async () => {
  const { draftAnswers } = await import('../src/drafts.js');
  const realFetch = globalThis.fetch;
  let sent;
  const reply = JSON.stringify({ answers: [{ id: 'q1', text: 'Not as the owner of one.', choices: [] }, { id: 'q3', text: '', choices: ['I design or automate workflows with AI tools'] }] });
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body), key: new Headers(init.headers).get('x-api-key') };
    return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const qs = draftable(form, fill);
    const values = await draftAnswers({ ANTHROPIC_API_KEY: 'test-key' }, {
      job: { company: 'Honeycomb', title: 'Senior Engineer' }, form, profile: { first_name: 'Brandon', background: 'Built Apply Desk.' }, questions: qs,
    });
    assert.deepEqual(values, { obs: 'Not as the owner of one.', ai: 'I design or automate workflows with AI tools' });
    assert.match(sent.url, /\/v1\/messages$/);
    assert.equal(sent.key, 'test-key');
    assert.equal(sent.body.model, 'claude-opus-5-5');
    assert.equal(sent.body.stream, true);
    assert.equal(sent.body.output_config.format.type, 'json_schema');
    assert.match(sent.body.system[1].text, /Built Apply Desk\./);
    assert.deepEqual(sent.body.system[1].cache_control, { type: 'ephemeral' });
    assert.match(sent.body.messages[0].content, /Have you owned or supported an Observability system/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
