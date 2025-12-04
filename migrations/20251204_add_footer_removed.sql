-- Add footer_removed flag to message to persist user intent to hide Turing footer
ALTER TABLE message ADD COLUMN IF NOT EXISTS footer_removed BOOLEAN DEFAULT FALSE;

-- Optional: add indexes if querying by this flag later
-- CREATE INDEX IF NOT EXISTS idx_message_footer_removed ON message(footer_removed);
