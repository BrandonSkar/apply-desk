-- Apply Desk database (Cloudflare D1). Safe to run again: everything is IF NOT EXISTS.

-- One row per job posting found by the refresh.
-- status: new | skipped | ready | submitting | submitted | needs_you | failed | applied_manual | closed
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,            -- source-scoped, e.g. gh:twilio:8177722, lever:rover:<uuid>, amazon:10583193
  source TEXT NOT NULL,           -- greenhouse | lever | amazon | microsoft
  board TEXT,                     -- company slug on Greenhouse / Lever
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  remote INTEGER NOT NULL DEFAULT 0,
  url TEXT,                       -- the posting
  apply_url TEXT,                 -- the form the helper opens
  posted_at TEXT,                 -- ISO date
  found_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  later INTEGER NOT NULL DEFAULT 0, -- times "Later" was pressed; pushes it back in the queue
  form TEXT,                      -- JSON: the normalized application questions (cached)
  answers TEXT,                   -- JSON: { fieldName: value }
  note TEXT,                      -- last message from the helper
  sent_at TEXT,                   -- when you pressed Send (or marked it applied); counts toward the daily goal
  updated_at TEXT,
  submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs (status, source, later, posted_at);
CREATE INDEX IF NOT EXISTS jobs_updated ON jobs (updated_at);

-- Profile, settings and small bits of state, stored as JSON.
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Answers you gave to questions that come up again ("How did you hear about {company}?").
CREATE TABLE IF NOT EXISTS answer_bank (
  qkey TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  answer TEXT NOT NULL,           -- JSON value; the company name is stored as {company}
  updated_at TEXT NOT NULL
);
