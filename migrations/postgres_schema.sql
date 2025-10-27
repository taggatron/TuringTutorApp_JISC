-- Example Postgres schema for TuringTutorApp
-- Run this in your Postgres database before importing data.

CREATE TABLE IF NOT EXISTS app_user (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_name TEXT NOT NULL,
  group_id INTEGER,
  is_turing BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS message (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  username TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  collapsed BOOLEAN DEFAULT FALSE,
  scale_level INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES message(id) ON DELETE CASCADE,
  username TEXT,
  content TEXT NOT NULL,
  position TEXT
);

CREATE TABLE IF NOT EXISTS scale_level (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  username TEXT,
  scale_level INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  username TEXT,
  group_name TEXT
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON message(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session_id ON feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_scale_levels_session_id ON scale_level(session_id);

-- Optionally enable RLS policies after data migration (see SECURITY.md for examples)
