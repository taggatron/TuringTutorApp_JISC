-- Add timestamps to session and message for last modified labeling
ALTER TABLE session ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE message ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE message ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill: set session.updated_at to max(message.updated_at) per session
UPDATE session s
SET updated_at = COALESCE(
  (SELECT MAX(m.updated_at) FROM message m WHERE m.session_id = s.id),
  s.updated_at
);
