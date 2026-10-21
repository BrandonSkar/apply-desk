// Notifications: the evening email, which Cloudflare sends to your verified address, and the summary text.
// Phone pushes (ntfy) go out through the helper on your PC; see queuePush in index.js.
export const PAGE_URL = 'https://brandonskar.com/jobs';

export async function email(env, { to, subject, text, html }) {
  if (!env.EMAIL) return { ok: false, why: 'Email isn’t set up for this site' };
  if (!to) return { ok: false, why: 'No email address in your profile' };
  try {
    await env.EMAIL.send({ to, from: env.MAIL_FROM, subject, text, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String(err.message || err).slice(0, 200) };
  }
}

// The local date and hour in `timeZone`, and when that day started (as an ISO time).
export function localDay(timeZone, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const [y, m, d] = [+parts.year, +parts.month, +parts.day];
  const offset = Date.UTC(y, m - 1, d, +parts.hour, +parts.minute, +parts.second) - Math.floor(at.getTime() / 1000) * 1000;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: +parts.hour,
    start: new Date(Date.UTC(y, m - 1, d) - offset).toISOString(),
    label: at.toLocaleDateString('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = { ready: 'waiting for the helper', submitting: 'sending', submitted: 'sent', needs_you: 'needs you', failed: 'failed', applied_manual: 'you applied' };

// The day in review: what went out, what's waiting on you, and what's next.
export function dailySummary(d) {
  const line = (j) => `${j.company} · ${j.title}`;
  const waiting = d.needsYou.map((j) => `${line(j)}: ${j.needs === 'code' ? 'enter the emailed code' : (j.note || 'needs you').split('. ')[0]}`);
  const headline = `${d.sent.length} application${d.sent.length === 1 ? '' : 's'} sent today${d.goal ? ` (goal ${d.goal})` : ''}`;
  const sections = [
    [`Sent today: ${d.sent.length}`, d.sent.map((j) => `${line(j)} (${STATUS[j.status] || j.status})`)],
    [`Waiting on you: ${d.needsYou.length}`, waiting],
    ['Your queue', [
      `${d.queue} job${d.queue === 1 ? '' : 's'} ready for you to review`,
      `${d.found} new job${d.found === 1 ? '' : 's'} found today`,
      `${d.total} applications sent in total`,
    ]],
    [`On hold: ${d.holds.length}`, d.holds.map((h) => `${h.company} until ${h.untilLabel} (${h.reason})`)],
  ].filter(([, items]) => items.length);

  const text = [
    `Apply Desk · ${d.label}`,
    '',
    headline,
    ...sections.flatMap(([title, items]) => ['', title, ...items.map((i) => `  - ${i}`)]),
    '',
    `Open Apply Desk: ${PAGE_URL}`,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f2;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1c1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e0da;border-radius:14px;padding:24px">
<div style="color:#6b6862;font-size:13px">Apply Desk · ${esc(d.label)}</div>
<h1 style="font-size:22px;margin:4px 0 16px">${esc(headline)}</h1>
${sections.map(([title, items]) => `<h2 style="font-size:15px;margin:18px 0 6px">${esc(title)}</h2><ul style="margin:0;padding-left:20px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('\n')}
<p style="margin:22px 0 0"><a href="${PAGE_URL}" style="display:inline-block;background:#1f5f4a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px">Open Apply Desk</a></p>
</div></body></html>`;

  const pushMessage = [
    `${d.sent.length} sent${d.goal ? ` (goal ${d.goal})` : ''}`,
    d.needsYou.length && `${d.needsYou.length} waiting on you`,
    `${d.queue} in your queue`,
  ].filter(Boolean).join(' · ');

  return { subject: `Apply Desk: ${headline}`, text, html, pushTitle: `Apply Desk today: ${d.sent.length} sent`, pushMessage };
}
