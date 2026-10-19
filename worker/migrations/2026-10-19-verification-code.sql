-- For databases created before verification codes were handled (schema.sql already has these columns).
-- npx wrangler d1 execute apply-desk --remote --file migrations/2026-10-19-verification-code.sql
ALTER TABLE jobs ADD COLUMN needs TEXT;
ALTER TABLE jobs ADD COLUMN code TEXT;
