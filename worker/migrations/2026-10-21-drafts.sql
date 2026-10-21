-- For databases created before drafted answers (schema.sql already has this column).
-- npx wrangler d1 execute apply-desk --remote --file migrations/2026-10-21-drafts.sql
ALTER TABLE jobs ADD COLUMN drafts TEXT;
