-- Run as a superuser (e.g. psql -U danieltagg -h localhost -d turingdb -f scripts/grant_app_admin_privileges.sql)
-- This grants the 'app_admin' role the necessary DML privileges so the app can
-- SET ROLE app_admin and perform administrative actions without being superuser.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_user TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE message TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feedback TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scale_level TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE groups TO app_admin;

-- Grant sequence privileges for SERIAL/sequence-backed primary keys
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_admin;

-- If you have multiple schemas, adjust the schema name above.

-- Note: this must be run by a superuser or a role that owns the tables.
