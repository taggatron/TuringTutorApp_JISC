ALTER TABLE message
  ADD COLUMN IF NOT EXISTS references_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prompts_json jsonb DEFAULT '[]'::jsonb;

-- Remove the columns (data will be lost)
ALTER TABLE message
  DROP COLUMN IF EXISTS references_json,
  DROP COLUMN IF EXISTS prompts_json;
