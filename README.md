# Apply Desk

One page for job applications. Apply Desk finds new postings, fills in everything it already knows about you, and shows you only the questions that are new. You answer them, press **Send**, and a helper on your PC submits the real application. Then the next job loads.

It also ships an **MCP server**, so you can work the same queue by chatting with Claude: "next job", answer in chat, done.

- **Finds jobs** from public job-board APIs: Greenhouse, Lever and Ashby company boards, Amazon Jobs, and Microsoft Careers. It filters by title, seniority, location (an area plus US remote) and posting age, and checks again every few minutes.
- **Answers what it can.** Contact details, work authorization, sponsorship, location, voluntary self-ID and the usual "how did you hear about us" come from your profile, along with Greenhouse's built-in Employment and Education sections, which aren't in its public question list. Answers you type are remembered for the next company that asks ("Why {company}?"), so each application asks less than the one before.
- **Submits for you.** A Playwright helper opens the application in Chrome, fills it, attaches your resume, submits it, and saves a screenshot of the confirmation. For Amazon and Microsoft, which need a sign-in, the helper uses its own browser where you've signed in once, and reads each job's questions ahead of time so they show on your page like any other.
- **Keeps you in the loop.** Nothing is sent until you press Send. If a site shows a CAPTCHA or asks for something unexpected, the helper leaves that form open for you and keeps working through the rest of the queue. The page shows it under **Needs your attention**.
- **Verification codes stay with you.** Some sites email a code to confirm a person is applying. The page shows a banner and a code box. You read the code from your email and type it on the page (or give it to Claude), and the helper enters it. The helper never reads your email.
- **No marketing texts.** Text-message (SMS) opt-ins are answered "No" or left unchecked unless you turn them on in your profile.

## How it fits together

```
 job boards (public APIs)
        │  every 5 min, a few sources per run
        ▼
 ┌──────────────────────────────┐      password login       ┌────────────────────┐
 │ Cloudflare Worker + D1       │ ◀───────────────────────▶ │ /jobs page          │
 │ queue · forms · autofill     │                           │ (phone or desktop)  │
 │ answer bank · tracker        │ ◀──────┐                  └────────────────────┘
 └──────────────────────────────┘        │ token
        ▲  claim / report (token)        │
        │                         ┌──────┴───────────┐
 ┌──────┴──────────────────┐      │ MCP server       │ ◀── Claude Desktop / Claude Code
 │ helper (your PC)        │      │ (runner/src/mcp) │
 │ Playwright + Chrome     │      └──────────────────┘
 └─────────────────────────┘
```

The page and the MCP server only record answers. The helper is the only part that touches application forms. It runs on your own machine, so your resume and any site logins never leave it.

## Project layout

| Path | What it is |
| --- | --- |
| `worker/src/index.js` | Routes, API, login, scheduled refresh, helper endpoints |
| `worker/src/sources.js` | Greenhouse, Lever, Amazon and Microsoft job fetchers |
| `worker/src/filters.js` | Title, seniority, location and age filters |
| `worker/src/forms.js` | Loads each job's application questions into one shape |
| `worker/src/autofill.js` | Profile rules and the answer bank: decides what you still need to answer |
| `worker/public/jobs/` | The page (plain HTML, CSS, JS; no build step) |
| `runner/src/helper.js` | The submit loop |
| `runner/src/fillers/` | Per-site form fillers (Greenhouse, Lever) |
| `runner/src/mcp.js` | The MCP server |

## Set it up

You need Node 20+, Chrome, and a Cloudflare account with a domain.

**1. The site** (`worker/`)

```sh
cd worker
npm install
npx wrangler d1 create apply-desk        # put the database_id in wrangler.jsonc
npm run db:init                          # create the tables (older databases: run the files in migrations/)
# set your own domain in wrangler.jsonc "routes", then:
npx wrangler secret put APP_PASSWORD     # the page password
npx wrangler secret put SESSION_SECRET   # any long random string
npx wrangler secret put RUNNER_TOKEN     # another long random string, for the helper and MCP server
npx wrangler secret put ANTHROPIC_API_KEY  # optional: Claude drafts answers to questions nothing else answers
npm run deploy
```

Open `https://your-domain/jobs`, sign in, and fill in the **Profile** tab.

Optional, for the evening summary email: turn on Email Routing for your domain and verify the address it goes to
(`npx wrangler email routing enable your-domain`, `npx wrangler email routing addresses create you@example.com`),
and set `MAIL_FROM` in `wrangler.jsonc` to an address on your domain. Phone notifications use the free
[ntfy](https://ntfy.sh) app: subscribe to the topic shown under **Settings → Notifications**.

**2. The helper** (`runner/`)

```sh
cd runner
npm install
copy config.example.json config.local.json   # then fill in siteUrl, token (RUNNER_TOKEN) and resumePath
npm start
```

Leave it running while you apply. It restarts itself to load code updates (between applications, never with one
waiting on you), and it sends the phone notifications. `npm run login` opens the helper's browser so you can sign
in to job sites it should use.

**3. The MCP server** (optional)

Add this to Claude Desktop's `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "apply-desk": {
      "command": "node",
      "args": ["C:\\path\\to\\apply-desk\\runner\\src\\mcp.js"]
    }
  }
}
```

Or in Claude Code: `claude mcp add apply-desk -- node /path/to/apply-desk/runner/src/mcp.js`

Tools: `next_job`, `send_answers`, `skip_job`, `mark_applied`, `enter_code`, `list_applications`, `status`, `refresh_jobs`.

## Tests

```sh
cd worker && npm test
cd runner && npm test
```

Unit tests cover the title and location filters and the autofill rules, using question sets modeled on real Greenhouse and Lever forms.

## Design notes

- **Free-plan friendly.** Each scheduled run handles three sources, which keeps it well inside the Workers free plan's CPU limit. The cursor advances before the work, so a source that fails can't block the others.
- **Security.** The page sits behind a password with an HMAC-signed, HttpOnly cookie. The helper and MCP server use a separate bearer token. API writes must be JSON, which blocks cross-site form posts. The page has a strict Content-Security-Policy, and everything that comes from job sites is inserted as text, never as HTML.
- **Responsible use.** Applications go out only after you review and send them. CAPTCHAs and emailed verification codes are never bypassed. Job listings come from public APIs; Amazon and Microsoft applications use your own signed-in session, one at a time.

## Roadmap

- Workday job listings for large employers
- Drafting answers to essay questions from the job description, for you to edit

## License

MIT
