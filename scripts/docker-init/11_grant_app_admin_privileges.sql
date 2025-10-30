-- This copy of the grant script is intended to be placed in docker-entrypoint-initdb.d
-- so it runs automatically when the Postgres container is initialized (only runs on first init).

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_user TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE message TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feedback TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scale_level TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE groups TO app_admin;

GRANT USAGE, SELECT ON SEQUENCE app_user_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE session_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE message_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE feedback_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE scale_level_id_seq TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE groups_id_seq TO app_admin;

-- Grant helper role to default DB user 'turing' (adjust if your DB user differs)
GRANT app_admin TO turing;