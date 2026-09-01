-- Migration: 20260901_add_resource_table.sql
-- Description: Creates the resource table with Row-Level Security (RLS) for Turing Tutor

CREATE TABLE IF NOT EXISTS resource (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'web_page',
    title TEXT,
    url TEXT,
    domain TEXT,
    description TEXT,
    content TEXT,
    origin TEXT DEFAULT 'student_web',
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_resource_user_id ON resource(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_type ON resource(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_user_url ON resource(user_id, url) WHERE url IS NOT NULL;

-- Enable Row Level Security (RLS)
ALTER TABLE resource ENABLE ROW LEVEL SECURITY;

-- 1) SELECT Policy
DROP POLICY IF EXISTS resource_select_policy ON resource;
CREATE POLICY resource_select_policy ON resource FOR SELECT USING (
    current_role = 'app_admin'
    OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);

-- 2) INSERT Policy
DROP POLICY IF EXISTS resource_insert_policy ON resource;
CREATE POLICY resource_insert_policy ON resource FOR INSERT WITH CHECK (
    current_role = 'app_admin'
    OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);

-- 3) UPDATE Policy
DROP POLICY IF EXISTS resource_modify_policy ON resource;
CREATE POLICY resource_modify_policy ON resource FOR UPDATE USING (
    current_role = 'app_admin'
    OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);

-- 4) DELETE Policy
DROP POLICY IF EXISTS resource_delete_policy ON resource;
CREATE POLICY resource_delete_policy ON resource FOR DELETE USING (
    current_role = 'app_admin'
    OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
);
