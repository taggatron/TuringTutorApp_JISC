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
  username TEXT,
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

-- ======================================================
-- Row Level Security (RLS) policies
--
-- This section enables RLS for application tables and creates
-- policies that allow:
--   * the 'app_admin' role to access all rows
--   * regular users to access only rows they own
--
-- NOTE: The application should set the current session variable
--   app.current_user_id to the numeric user id for the connected
--   session before running queries. Example (psql):
--     SELECT set_config('app.current_user_id', '42', true);
--
-- To execute admin queries you can set the role to app_admin:
--     SET ROLE app_admin;
-- or grant the role to a database user:
--     GRANT app_admin TO turing;
-- ======================================================

-- NOTE: Creating roles requires superuser privileges. If you control the
-- Postgres instance and want the helper role created automatically, run:
--   CREATE ROLE app_admin;
-- Otherwise grant the role to your DB admin user manually, e.g.:
--   GRANT app_admin TO turing;

-- Helper: safe cast of current_setting to int (uses '0' when not set)
-- usage: COALESCE(current_setting('app.current_user_id', true), '0')::int

-- 1) app_user (users)
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_select_policy ON app_user;
CREATE POLICY app_user_select_policy ON app_user FOR SELECT USING (
  current_role = 'app_admin'
  OR id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS app_user_modify_policy ON app_user;
CREATE POLICY app_user_modify_policy ON app_user FOR UPDATE USING (
  current_role = 'app_admin'
  OR id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS app_user_delete_policy ON app_user;
CREATE POLICY app_user_delete_policy ON app_user FOR DELETE USING (
  current_role = 'app_admin'
  OR id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
-- Allow inserts as before (registration). With RLS enabled, INSERTs are
-- checked by the WITH CHECK expression. We allow INSERT for admin or any
-- session (application-side should ensure correct creation flow).
DROP POLICY IF EXISTS app_user_insert_policy ON app_user;
CREATE POLICY app_user_insert_policy ON app_user FOR INSERT WITH CHECK (
  current_role = 'app_admin' OR true
);

-- 2) session
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_select_policy ON session;
CREATE POLICY session_select_policy ON session FOR SELECT USING (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS session_modify_policy ON session;
CREATE POLICY session_modify_policy ON session FOR UPDATE USING (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS session_delete_policy ON session;
CREATE POLICY session_delete_policy ON session FOR DELETE USING (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS session_insert_policy ON session;
CREATE POLICY session_insert_policy ON session FOR INSERT WITH CHECK (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);

-- 3) message (belongs to session) - allow access if the session is owned
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_select_policy ON message;
CREATE POLICY message_select_policy ON message FOR SELECT USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = message.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS message_modify_policy ON message;
CREATE POLICY message_modify_policy ON message FOR UPDATE USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = message.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS message_delete_policy ON message;
CREATE POLICY message_delete_policy ON message FOR DELETE USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = message.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS message_insert_policy ON message;
CREATE POLICY message_insert_policy ON message FOR INSERT WITH CHECK (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = message.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);

-- 4) feedback (belongs to session/message)
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_select_policy ON feedback;
CREATE POLICY feedback_select_policy ON feedback FOR SELECT USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = feedback.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS feedback_modify_policy ON feedback;
CREATE POLICY feedback_modify_policy ON feedback FOR UPDATE USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = feedback.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS feedback_delete_policy ON feedback;
CREATE POLICY feedback_delete_policy ON feedback FOR DELETE USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = feedback.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS feedback_insert_policy ON feedback;
CREATE POLICY feedback_insert_policy ON feedback FOR INSERT WITH CHECK (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = feedback.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);

-- 5) scale_level (belongs to session)
ALTER TABLE scale_level ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scale_level_select_policy ON scale_level;
CREATE POLICY scale_level_select_policy ON scale_level FOR SELECT USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = scale_level.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS scale_level_modify_policy ON scale_level;
CREATE POLICY scale_level_modify_policy ON scale_level FOR UPDATE USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = scale_level.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS scale_level_delete_policy ON scale_level;
CREATE POLICY scale_level_delete_policy ON scale_level FOR DELETE USING (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = scale_level.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);
DROP POLICY IF EXISTS scale_level_insert_policy ON scale_level;
CREATE POLICY scale_level_insert_policy ON scale_level FOR INSERT WITH CHECK (
  current_role = 'app_admin'
  OR EXISTS (
    SELECT 1 FROM session s WHERE s.id = scale_level.session_id
      AND s.user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
  )
);

-- 6) groups (belongs to user)
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS groups_select_policy ON groups;
CREATE POLICY groups_select_policy ON groups FOR SELECT USING (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS groups_modify_policy ON groups;
CREATE POLICY groups_modify_policy ON groups FOR UPDATE USING (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS groups_delete_policy ON groups;
CREATE POLICY groups_delete_policy ON groups FOR DELETE USING (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
DROP POLICY IF EXISTS groups_insert_policy ON groups;
CREATE POLICY groups_insert_policy ON groups FOR INSERT WITH CHECK (
  current_role = 'app_admin'
  OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);

-- End of RLS policies
