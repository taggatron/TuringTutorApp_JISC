-- Create or alter a superuser role 'danieltagg' using psql variable substitution.
-- WARNING: This file must be executed by a Postgres superuser (psql run by a superuser account).
-- Usage example (from project root):
--   # Copy your .env.sample to .env and set SUPERUSER_PASSWORD there, or export SUPERUSER_PASSWORD in your shell
--   psql -v SUPERUSER_PASSWORD="'$SUPERUSER_PASSWORD'" -f scripts/create_superuser.sql
-- Note: the -v value should include surrounding single quotes so the value is passed as a SQL string literal.

DO
$do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danieltagg') THEN
    RAISE NOTICE 'Creating role danieltagg';
    EXECUTE format('CREATE ROLE %I WITH LOGIN SUPERUSER PASSWORD %s', 'danieltagg', :'SUPERUSER_PASSWORD');
  ELSE
    RAISE NOTICE 'Role danieltagg already exists - ensuring SUPERUSER and updating password';
    EXECUTE format('ALTER ROLE %I WITH SUPERUSER', 'danieltagg');
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %s', 'danieltagg', :'SUPERUSER_PASSWORD');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    RAISE NOTICE 'Granting app_admin to danieltagg';
    EXECUTE format('GRANT app_admin TO %I', 'danieltagg');
  ELSE
    RAISE NOTICE 'app_admin role not present; please create or grant separately if desired';
  END IF;
END
$do$;

-- Final notice
DO $$ BEGIN RAISE NOTICE 'Finished create_superuser.sql'; END $$;
