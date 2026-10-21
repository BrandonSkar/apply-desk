// Starting values for the search settings and the profile. Both are editable on the page.

export const DEFAULT_SETTINGS = {
  dailyGoal: 10,
  maxAgeDays: 30,
  // Skip jobs whose every experience requirement is above this many years (from the job description).
  maxYearsRequired: 5,
  remoteUS: true,

  // Regex fragments, matched case-insensitively against each part of a title
  // ("Software Engineer II / Senior Software Engineer" is checked part by part).
  titleInclude: [
    'software (development |dev )?engineer',
    'software developer',
    '\\bsde\\b',
    'front[- ]?end (software )?(engineer|developer)',
    'full[- ]?stack (software )?(engineer|developer)',
    'back[- ]?end (software )?(engineer|developer)',
    'web (developer|engineer)',
    'application (developer|engineer)',
    '\\.net (developer|engineer)',
    'c# (developer|engineer)',
    'react (developer|engineer)',
    'ui (developer|engineer)',
    'product engineer',
  ],
  // A part with one of these words is too senior.
  levelExclude: ['senior', 'sr\\.?', 'staff', 'principal', 'lead', 'manager', 'director', 'architect', 'iii', 'iv', 'head of', 'vp', 'distinguished', 'chief'],
  // A title with one of these anywhere is skipped.
  hardExclude: ['\\bintern\\b', 'internship', 'firmware', 'embedded', 'hardware', 'silicon', '\\basic\\b', 'fpga', '\\bphd\\b', '\\bcontract\\b', 'clearance', 'ts/sci', 'high school', 'co-op', 'apprentice'],

  // Anywhere in Washington state ("WA" or "Washington"; Washington, D.C. is excluded in filters.js),
  // plus Seattle-area towns that some listings name without the state. Ambiguous town names need the state.
  areas: [
    'washington', 'wa',
    'seattle', 'bellevue', 'redmond', 'kirkland', 'bothell', 'renton', 'issaquah', 'tukwila', 'sammamish',
    'woodinville', 'federal way', 'lynnwood', 'seatac', 'burien', 'tacoma', 'puget sound',
    'kent,? (wa|washington)', 'everett,? (wa|washington)', 'auburn,? (wa|washington)',
  ],

  // Companies that hire software engineers in Washington or remotely (checked 2026-10-19 against ~400 names).
  greenhouse: [
    'abnormalsecurity', 'affirm', 'airbnb', 'andurilindustries', 'anthropic', 'asana', 'axon', 'bitwarden', 'block',
    'braze', 'brex', 'calendly', 'chime', 'circleci', 'cloudflare', 'coinbase', 'consensys', 'coreweave', 'cribl',
    'customerio', 'databricks', 'discord', 'doordashusa', 'dropbox', 'elastic', 'figma', 'fivetran', 'flexport',
    'gitlab', 'grafanalabs', 'gusto', 'honeycomb', 'instacart', 'klaviyo', 'launchdarkly', 'lyft', 'mercury',
    'mongodb', 'motional', 'mozilla', 'newrelic', 'nintendo', 'offerup', 'okta', 'pinterest', 'reddit', 'robinhood',
    'roblox', 'samsara', 'scaleai', 'sigmacomputing', 'smartsheet', 'spacex', 'stripe', 'tailscale', 'talkspace',
    'tanium', 'toast', 'truveta', 'twilio', 'twitch', 'upstart', 'vercel', 'zoominfo',
  ],
  lever: ['gopuff', 'palantir', 'rover', 'shieldai', 'zoox'],
  // Ashby job boards (jobs.ashbyhq.com/<name>), many of them startups.
  ashby: [
    'alchemy', 'astronomer', 'baseten', 'benchling', 'cerebras', 'clickhouse', 'cohere', 'drata', 'elevenlabs',
    'harvey', 'hex', 'lancedb', 'notion', 'openai', 'posthog', 'ramp', 'replit', 'resend', 'skydio', 'temporal',
    'vanta', 'workos', 'writer',
  ],
  amazon: {
    queries: ['software development engineer', 'front end engineer', 'software engineer'],
    locations: ['Seattle, WA', 'Bellevue, WA'],
  },
  microsoft: {
    queries: ['software engineer'],
    locations: ['Redmond, WA', 'United States'],
    pages: 2, // 10 newest jobs per page; Microsoft rate-limits heavier searching
  },
};

export const PROFILE_FIELDS = [
  // [key, label, group]
  ['first_name', 'First name', 'Contact'],
  ['last_name', 'Last name', 'Contact'],
  ['preferred_name', 'Preferred first name', 'Contact'],
  ['pronouns', 'Pronouns', 'Contact'],
  ['email', 'Email', 'Contact'],
  ['phone', 'Phone', 'Contact'],
  ['address', 'Street address', 'Contact'],
  ['city', 'City', 'Contact'],
  ['state', 'State', 'Contact'],
  ['zip', 'ZIP code', 'Contact'],
  ['country', 'Country', 'Contact'],
  ['linkedin', 'LinkedIn URL', 'Links'],
  ['github', 'GitHub URL', 'Links'],
  ['website', 'Website / portfolio', 'Links'],
  ['current_company', 'Current or last company', 'Work'],
  ['current_title', 'Current or last job title', 'Work'],
  ['job_start_month', 'Started there: month', 'Work'],
  ['job_start_year', 'Started there: year', 'Work'],
  ['job_current', 'Still working there?', 'Work'],
  ['years_experience', 'Years of professional experience', 'Work'],
  ['degree', 'Highest degree', 'Education'],
  ['discipline', 'Field of study', 'Education'],
  ['school', 'School (blank = “Other”)', 'Education'],
  ['grad_year', 'Graduation year', 'Education'],
  ['work_authorized', 'Authorized to work in the US?', 'Common answers'],
  ['needs_sponsorship', 'Need visa sponsorship?', 'Common answers'],
  ['citizenship', 'Citizenship (country)', 'Common answers'],
  ['willing_to_relocate', 'Willing to relocate?', 'Common answers'],
  ['desired_salary', 'Desired salary', 'Common answers'],
  ['notice_period', 'When can you start?', 'Common answers'],
  ['how_heard', 'How did you hear about the job? (default)', 'Common answers'],
  ['sms_opt_in', 'Get text (SMS) messages from employers?', 'Common answers'],
  ['government_ties', 'Government official or employee, ever (or related to one)?', 'Common answers'],
  ['essay_why', 'Why this company? (write {company} where its name goes)', 'Written answers'],
  ['essay_built', 'The most impactful thing you’ve built', 'Written answers'],
  ['essay_problem', 'A hard problem you solved', 'Written answers'],
  ['essay_fit', 'Why you’re a good fit / about you', 'Written answers'],
  ['gender', 'Gender', 'Voluntary self-ID'],
  ['race', 'Race / ethnicity', 'Voluntary self-ID'],
  ['sexual_orientation', 'Sexual orientation', 'Voluntary self-ID'],
  ['transgender', 'Transgender? (Yes / No)', 'Voluntary self-ID'],
  ['veteran', 'Veteran status', 'Voluntary self-ID'],
  ['disability', 'Disability status', 'Voluntary self-ID'],
];

export const EMPTY_PROFILE = {
  ...Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, ''])),
  country: 'United States',
  work_authorized: 'Yes',
  needs_sponsorship: 'No',
  willing_to_relocate: 'No',
  job_current: 'Yes',
  how_heard: 'Company website',
  notice_period: '2 weeks',
  sms_opt_in: 'No',
  government_ties: 'No',
  gender: 'Decline',
  race: 'Decline',
  sexual_orientation: 'Decline',
  transgender: 'Decline',
  veteran: 'Decline',
  disability: 'Decline',
};
