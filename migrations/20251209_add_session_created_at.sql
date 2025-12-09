-- Ensure sessions carry a persisted creation timestamp for accurate labeling
ALTER TABLE session ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE session ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill any missing timestamps so historical sessions have stable values
UPDATE session
SET created_at = COALESCE(created_at, updated_at, now())
WHERE created_at IS NULL;

UPDATE session
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE session ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE session ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE session ALTER COLUMN updated_at SET DEFAULT now();
