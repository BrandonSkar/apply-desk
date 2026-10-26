-- For databases created before the page could tick a form's boxes for you (schema.sql already has this column).
-- npx wrangler d1 execute apply-desk --remote --file migrations/2026-10-26-boxes.sql
ALTER TABLE jobs ADD COLUMN ask TEXT;
