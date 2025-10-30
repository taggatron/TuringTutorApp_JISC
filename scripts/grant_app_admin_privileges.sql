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
-- Grant sequence privileges for the specific SERIAL sequences used by the
-- application tables. This is narrower than granting ALL SEQUENCES in the
-- schema and follows least-privilege principles.
GRANT USAGE, SELECT ON SEQUENCE app_user_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE session_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE message_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE feedback_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE scale_level_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE groups_id_seq TO app_admin;

-- If your DB uses different sequence names or multiple schemas, adjust the
-- sequence names above or run `SELECT sequence_name FROM information_schema.sequences` to confirm.

-- Note: this script must be run by a superuser or the table owner.
