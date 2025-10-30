-- DB admin helper: create and grant the app_admin role
-- NOTE: This file is intended to be run by a Postgres superuser (psql as a user with CREATEROLE)
-- Usage (as a superuser):
--   psql -d your_db -f scripts/db_admin_setup.sql
-- OR run individual statements in psql as a superuser.

-- 1) Create a lightweight role that will be used to bypass RLS in the app
-- (optional: add LOGIN if you want a dedicated DB user; otherwise grant to an existing DB user)
-- CREATE ROLE app_admin;

-- 2) (Recommended) Create a dedicated DB user and grant it the role
-- Note: if you already have a DB user that should be an admin (for example 'turing'), skip create user step and just GRANT the role to that user.
-- CREATE ROLE turing_admin WITH LOGIN PASSWORD 'change_me';
-- GRANT app_admin TO turing_admin;

-- 3) Grant the role to an existing DB user (example 'turing'):
-- GRANT app_admin TO turing;

-- 4) Optionally, give the app_admin role appropriate privileges (SELECT/INSERT/UPDATE/DELETE) on the application schema
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;

-- IMPORTANT: Do NOT run these statements as the regular application DB user. They require superuser or CREATEROLE privileges.
-- If you need me to generate a one-off script to be executed by your DBA with safe placeholders (e.g. replace <DB_USER>), tell me the target username and I'll prepare it.
