-- Migration: add jsonb metadata columns to message for references and prompts
-- Up
ALTER TABLE message
  ADD COLUMN IF NOT EXISTS references jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prompts jsonb DEFAULT '[]'::jsonb;

-- Down (rollback)
-- Remove the columns (data will be lost)
ALTER TABLE message
  DROP COLUMN IF EXISTS references,
  DROP COLUMN IF EXISTS prompts;
