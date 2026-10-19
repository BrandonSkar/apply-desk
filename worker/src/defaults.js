// Starting values for the search settings and the profile. Both are editable on the page.

export const DEFAULT_SETTINGS = {
  dailyGoal: 10,
  maxAgeDays: 30,
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

  // Seattle-area places. Ambiguous town names need the state next to them.
  areas: [
    'seattle', 'bellevue', 'redmond', 'kirkland', 'bothell', 'renton', 'issaquah', 'tukwila', 'sammamish',
    'woodinville', 'federal way', 'lynnwood', 'seatac', 'burien', 'tacoma', 'puget sound',
    'kent,? (wa|washington)', 'everett,? (wa|washington)', 'auburn,? (wa|washington)',
  ],

  greenhouse: [
    'abnormalsecurity', 'affirm', 'airbnb', 'anthropic', 'asana', 'braze', 'brex', 'calendly', 'chime', 'circleci',
    'cloudflare', 'coinbase', 'databricks', 'discord', 'doordashusa', 'dropbox', 'elastic', 'figma', 'fivetran',
    'flexport', 'gitlab', 'gusto', 'instacart', 'klaviyo', 'launchdarkly', 'lyft', 'mercury', 'mongodb', 'newrelic',
    'nintendo', 'offerup', 'okta', 'pinterest', 'reddit', 'robinhood', 'roblox', 'samsara', 'scaleai',
    'sigmacomputing', 'smartsheet', 'spacex', 'stripe', 'toast', 'truveta', 'twilio', 'twitch', 'upstart', 'vercel',
  ],
  lever: ['palantir', 'rover', 'shieldai', 'zoox'],
  amazon: {
    queries: ['software development engineer', 'front end engineer', 'software engineer'],
    locations: ['Seattle, WA', 'Bellevue, WA'],
  },
  microsoft: {
    queries: ['software engineer'],
    locations: ['Redmond, WA', 'United States'],
    pages: 4, // 10 newest jobs per page
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
  ['willing_to_relocate', 'Willing to relocate?', 'Common answers'],
  ['desired_salary', 'Desired salary', 'Common answers'],
  ['notice_period', 'When can you start?', 'Common answers'],
  ['how_heard', 'How did you hear about the job? (default)', 'Common answers'],
  ['sms_opt_in', 'Get text (SMS) messages from employers?', 'Common answers'],
  ['government_ties', 'Government official or employee, ever (or related to one)?', 'Common answers'],
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
