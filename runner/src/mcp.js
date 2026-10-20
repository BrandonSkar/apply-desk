// Apply Desk MCP server: lets Claude (Desktop or Code) work the same queue as the /jobs page.
// Claude shows you the next job's open questions, you answer in chat, Claude sends them, and the
// helper on your PC submits. Runs over stdio; never write to stdout here (that's the protocol channel).
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { loadConfig, makeApi } from './config.js';

const cfg = loadConfig();
const api = makeApi(cfg);

const server = new McpServer(
  { name: 'apply-desk', version: '0.1.0' },
  {
    instructions: [
      'Apply Desk is the user\'s job-application queue (also at their /jobs page).',
      'Loop: call next_job, show the company, title and the questions under "Questions for the user", ask the user for the answers,',
      'then call send_answers with those answers keyed by field name. Then call next_job again.',
      'Mention the prefilled answers briefly so the user can correct them; only send the ones they change.',
      'Never invent facts about the user (experience, salary, eligibility). For essay questions you may draft an answer from the',
      'job description and what the user has said, but show it and get approval before sending.',
      'Amazon and Microsoft jobs join the normal queue once the helper (which uses the user\'s sign-in) has read their questions.',
    ].join(' '),
  },
);

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (err) => ({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });

function ago(iso) {
  if (!iso) return 'unknown';
  const d = Math.round((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`;
}

function describeQuestion(q, value) {
  const bits = [q.required ? 'required' : 'optional'];
  if (q.type === 'select') bits.push(`pick one: ${q.options.map((o) => JSON.stringify(o.label)).join(' | ')}`);
  if (q.type === 'multiselect') bits.push(`pick any: ${q.options.map((o) => JSON.stringify(o.label)).join(' | ')}`);
  if (q.type === 'textarea') bits.push('long answer');
  if (q.type === 'file') bits.push('file upload: the helper will pause for the user');
  const v = value === undefined ? '' : ` = ${JSON.stringify(value)}`;
  return `- [${q.name}] (${bits.join('; ')}) ${q.label}${v}`;
}

function formatJob({ job, form, fill }) {
  const head = [
    `Job: ${job.company} — ${job.title}`,
    `Where: ${job.location || 'not listed'}${job.remote ? ' (remote)' : ''} · posted ${ago(job.posted_at)} · via ${job.source}`,
    `Posting: ${job.url}`,
    `job_id: ${job.id}`,
  ];
  if (!form) return head.join('\n');
  const groups = { open: [], suggested: [], auto: [], optional: [] };
  for (const q of form.questions) groups[fill.bucket[q.name] || (q.required ? 'open' : 'optional')].push(q);
  const out = [...head, ''];
  out.push(groups.open.length ? 'Questions for the user:' : 'Questions for the user: none. Everything required is answered.');
  out.push(...groups.open.map((q) => describeQuestion(q, undefined)));
  if (groups.suggested.length) {
    out.push('', 'Prefilled (confirm or change):', ...groups.suggested.map((q) => describeQuestion(q, fill.values[q.name])));
  }
  if (groups.optional.length) out.push('', 'Optional, unanswered:', ...groups.optional.map((q) => describeQuestion(q, undefined)));
  if (groups.auto.length) out.push('', `Filled from the user's profile: ${groups.auto.length} questions (${groups.auto.map((q) => q.label).join('; ').slice(0, 400)}).`);
  if (form.description) out.push('', 'Job description (start):', form.description.slice(0, 2500));
  return out.join('\n');
}

server.registerTool(
  'next_job',
  {
    title: 'Next job in the queue',
    description:
      'Get the next job to apply to, with the questions the user still needs to answer, the prefilled answers, and the start of the job description. ' +
      'lane "auto" (default) is every job the helper can submit (Greenhouse, Lever, and Amazon/Microsoft once the helper has read their questions); ' +
      'lane "manual" is Amazon/Microsoft jobs the helper hasn\'t read yet.',
    inputSchema: z.object({ lane: z.enum(['auto', 'manual']).optional() }),
  },
  async ({ lane }) => {
    try {
      const r = await api(`/next?lane=${lane || 'auto'}`);
      return text(r.job ? formatJob(r) : r.note || 'The queue is empty. Try refresh_jobs, or come back later.');
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'send_answers',
  {
    title: 'Send answers for a job',
    description:
      'Send the user\'s answers for a job from next_job. Keys are field names (the [bracketed] names), values are the answer text, ' +
      'or the exact option label(s) for pick questions (an array for "pick any"). Prefilled and profile answers are included automatically. ' +
      'The helper on the user\'s PC then submits the application.',
    inputSchema: z.object({
      job_id: z.string(),
      answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    }),
  },
  async ({ job_id, answers }) => {
    try {
      await api(`/jobs/${encodeURIComponent(job_id)}/answers`, { method: 'POST', body: { answers } });
      return text('Sent. The helper will submit it; check status or list_applications for the result.');
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'skip_job',
  {
    title: 'Skip or postpone a job',
    description: 'Skip a job the user doesn\'t want (later: false), or move it to the back of the queue (later: true).',
    inputSchema: z.object({ job_id: z.string(), later: z.boolean().optional() }),
  },
  async ({ job_id, later }) => {
    try {
      await api(`/jobs/${encodeURIComponent(job_id)}/status`, { method: 'POST', body: { status: later ? 'later' : 'skipped' } });
      return text(later ? 'Moved to the back of the queue.' : 'Skipped.');
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'mark_applied',
  {
    title: 'Mark a job as applied',
    description: 'Record that the user applied to a job themselves (for Amazon/Microsoft jobs, or a form they finished by hand).',
    inputSchema: z.object({ job_id: z.string() }),
  },
  async ({ job_id }) => {
    try {
      await api(`/jobs/${encodeURIComponent(job_id)}/status`, { method: 'POST', body: { status: 'applied_manual' } });
      return text('Marked as applied.');
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'enter_code',
  {
    title: 'Pass on a verification code',
    description:
      'Some sites email a verification code before an application goes through ("confirm you\'re a human"). ' +
      'When the user reads that code and gives it to you, send it here; the helper types it in and submits. ' +
      'Only use a code the user typed to you. Never look it up yourself.',
    inputSchema: z.object({ job_id: z.string(), code: z.string() }),
  },
  async ({ job_id, code }) => {
    try {
      await api(`/jobs/${encodeURIComponent(job_id)}/code`, { method: 'POST', body: { code } });
      return text('Code sent. The helper will enter it and submit.');
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'list_applications',
  {
    title: 'List applications',
    description: 'List sent applications and their status (view "sent"), or the Amazon/Microsoft jobs waiting for the user (view "manual").',
    inputSchema: z.object({ view: z.enum(['sent', 'manual']).optional() }),
  },
  async ({ view }) => {
    try {
      const { jobs } = await api(`/jobs?view=${view || 'sent'}`);
      if (!jobs.length) return text('Nothing here yet.');
      return text(jobs.slice(0, 60).map((j) =>
        `- ${(j.needs === 'code' ? 'needs_code' : j.status).padEnd(14)} ${j.company} — ${j.title} (${j.location || 'n/a'})${j.note ? ` · ${j.note}` : ''} · job_id ${j.id}${view === 'manual' ? ` · apply: ${j.apply_url}` : ''}`,
      ).join('\n'));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'status',
  {
    title: 'Queue status',
    description: 'How many applications were sent today against the goal, what\'s waiting, and whether the helper is running.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const s = await api(`/state?since=${encodeURIComponent(start.toISOString())}`);
      const c = s.counts;
      const seen = s.runner?.seen ? Date.now() - Date.parse(s.runner.seen) : Infinity;
      return text([
        `Today: ${c.sent_today} of ${s.goal} sent.`,
        `Queue: ${c.queue_auto} ready to answer, ${c.queue_manual} Amazon/Microsoft lined up for the helper to read.`,
        `Helper: ${seen < 120_000 ? 'running' : 'not running (start it with npm start in the runner folder)'}; ${c.ready} waiting to submit, ${c.submitting} submitting.`,
        `Needs attention: ${c.needs_you} need the user (${c.needs_code} waiting for an emailed code; ask the user for it, then use enter_code), ${c.failed} failed. Submitted all time: ${c.submitted_total}.`,
        s.profileReady ? '' : 'The profile is incomplete: fill it in on the /jobs page (Profile tab).',
      ].filter(Boolean).join('\n'));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'refresh_jobs',
  {
    title: 'Check every company for new jobs',
    description: 'Run a full check of all job sources now (takes up to a minute). New jobs also arrive automatically every few minutes.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const first = await api('/refresh', { method: 'POST', body: {} });
      let added = first.added;
      const runs = Math.ceil(first.total / 3);
      for (let i = 1; i < runs; i++) added += (await api('/refresh', { method: 'POST', body: {} })).added;
      return text(added ? `Found ${added} new matching job${added === 1 ? '' : 's'}.` : 'No new matching jobs right now.');
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
