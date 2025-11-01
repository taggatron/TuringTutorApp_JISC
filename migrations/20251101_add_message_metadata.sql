-- Migration: add JSONB columns to persist structured metadata for messages
-- Up: add columns
ALTER TABLE message
  ADD COLUMN IF NOT EXISTS references_json jsonb DEFAULT '[]'::jsonb;
ALTER TABLE message
  ADD COLUMN IF NOT EXISTS prompts_json jsonb DEFAULT '[]'::jsonb;

-- Down (rollback): remove the columns (data will be lost). Uncomment to run rollback.
-- ALTER TABLE message DROP COLUMN IF EXISTS references_json;
-- ALTER TABLE message DROP COLUMN IF EXISTS prompts_json;
