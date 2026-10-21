-- For databases created before the years-of-experience filter (schema.sql already has this column).
-- npx wrangler d1 execute apply-desk --remote --file migrations/2026-10-20-min-years.sql
ALTER TABLE jobs ADD COLUMN min_years INTEGER;
