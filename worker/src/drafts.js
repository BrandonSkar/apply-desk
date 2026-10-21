// Drafts answers, with Claude, to the questions no rule or past answer covers ("Have you owned an Observability
// system?", "How do you split coding and operations?"). Drafts use only the facts in your profile; they show under
// "Check these" so you read them before anything is sent. Off until the ANTHROPIC_API_KEY secret is set.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const DESCRIPTION_CHARS = 9000;

const SYSTEM = `You fill in job applications for one candidate, writing as the candidate in the first person.

The candidate pastes each answer straight into the application, so every answer must be finished text: no placeholders, brackets, blanks, or notes to the candidate.

Use only the facts in <candidate>. Never invent employers, titles, dates, numbers, percentages, tools, certifications, team sizes, or experience. When an exact figure isn't in the facts, describe it in words instead of inventing one ("mostly coding" rather than "80/20").

When a question asks about experience the candidate doesn't have, say so plainly in one sentence, then give the closest real experience from the facts. Never overclaim; an honest "not yet" reads better than a claim that falls apart in an interview.

Style: plain, direct, specific, like a capable engineer writing quickly. Short sentences. No buzzwords, no flattery of the company, no "I am excited to", no em dashes. Name concrete work from the facts.

Length: a short text field gets a few words or one sentence. A written question gets 50 to 150 words unless it asks for something shorter or longer.

Choice questions: return the option(s) exactly as written, picking the honest one. For a single choice, return exactly one.

Leave an answer empty (text "" and choices []) only when the facts give no honest basis for it, for example a reference's name, a file, or a personal detail that isn't in the facts. Answer optional questions too when the facts support a useful answer.

Call the company by the name the question or posting uses for it.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'choices'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

// Questions still waiting for an answer that Claude could write: not files or self-ID, and not already filled.
export function draftable(form, fill) {
  return form.questions.filter((q) =>
    q.type !== 'file' && q.section !== 'demographic'
    && !['auto', 'suggested'].includes(fill.bucket[q.name])
    && (!['select', 'multiselect'].includes(q.type) || q.options?.length));
}

// The facts drafts may use. Contact details and self-ID stay out: no question here needs them.
export function candidateFacts(p) {
  const line = (label, v) => (v && String(v).trim() ? `${label}: ${String(v).trim()}` : '');
  const essays = [
    ['Why this company (template; {company} is the company name)', p.essay_why],
    ['Most impactful thing built', p.essay_built],
    ['A hard problem solved', p.essay_problem],
    ['Why a good fit', p.essay_fit],
  ].filter(([, v]) => v && v.trim());
  return [
    line('Name', [p.first_name, p.last_name].filter(Boolean).join(' ')),
    line('Location', [p.city, p.state, p.country].filter(Boolean).join(', ')),
    line('Current or last job', [p.current_title, p.current_company].filter(Boolean).join(' at ')
      + (p.job_start_year ? ` (since ${[p.job_start_month, p.job_start_year].filter(Boolean).join(' ')}${p.job_current === 'No' ? ', no longer there' : ''})` : '')),
    line('Years of professional experience', p.years_experience),
    line('Education', [[p.degree, p.discipline].filter(Boolean).join(' in '), p.school, p.grad_year].filter(Boolean).join(', ')),
    line('Authorized to work in the US', p.work_authorized),
    line('Needs visa sponsorship', p.needs_sponsorship),
    line('Willing to relocate', p.willing_to_relocate),
    line('Desired salary', p.desired_salary),
    line('Can start', p.notice_period),
    line('Links', [p.linkedin, p.github, p.website].filter(Boolean).join(', ')),
    p.background?.trim() && `\nBackground (resume and projects):\n${p.background.trim()}`,
    essays.length && `\nAnswers the candidate wrote earlier (facts and voice to reuse):\n${essays.map(([k, v]) => `- ${k}: ${v.trim()}`).join('\n')}`,
  ].filter(Boolean).join('\n');
}

export function draftPrompt(job, form, questions) {
  const list = questions.map((q, i) => {
    const kind = q.type === 'multiselect' ? 'choose one or more' : q.type === 'select' ? 'choose one' : q.type === 'textarea' ? 'written answer' : 'short text';
    return [
      `<question id="q${i + 1}" type="${kind}" required="${q.required ? 'yes' : 'no'}">`,
      q.label,
      q.help ? `Help text: ${q.help}` : '',
      q.options?.length ? `Options:\n${q.options.map((o) => `- ${o.label}`).join('\n')}` : '',
      '</question>',
    ].filter(Boolean).join('\n');
  });
  return [
    `<job company="${job.company}" title="${job.title}" location="${job.location || ''}">`,
    (form.description || '').slice(0, DESCRIPTION_CHARS),
    '</job>',
    '',
    list.join('\n\n'),
    '',
    'Answer every question above, keyed by its id.',
  ].join('\n');
}

// Claude's answers -> form values. Choices must be real options; anything else is dropped.
export function toValues(questions, answers) {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const out = {};
  questions.forEach((q, i) => {
    const a = byId.get(`q${i + 1}`);
    if (!a) return;
    if (q.type === 'select' || q.type === 'multiselect') {
      const norm = (s) => String(s).trim().toLowerCase();
      const picked = (a.choices || [])
        .map((c) => q.options.find((o) => norm(o.label) === norm(c))?.label)
        .filter(Boolean);
      if (picked.length) out[q.name] = q.type === 'multiselect' ? [...new Set(picked)] : picked[0];
    } else if (a.text && a.text.trim()) {
      out[q.name] = a.text.trim();
    }
  });
  return out;
}

export async function draftAnswers(env, { job, form, profile, questions }) {
  // Finishes inside the 100-second window a draft holds its job (see makeDrafts); a failed one is retried later.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 80_000, maxRetries: 0 });
  const message = await client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    // The instructions and your facts are the same for every job: cache them, the job and questions vary.
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: `<candidate>\n${candidateFacts(profile)}\n</candidate>`, cache_control: { type: 'ephemeral' } },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: draftPrompt(job, form, questions) }],
  }).finalMessage();
  if (message.stop_reason !== 'end_turn') throw new Error(`Claude stopped early (${message.stop_reason})`);
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no answer');
  return toValues(questions, JSON.parse(text).answers || []);
}
