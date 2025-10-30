#!/usr/bin/env bash
# Create helper app_admin role and grant privileges for app tables and sequences.
# Run this as a Postgres superuser (e.g., psql -U postgres -h localhost -d turingdb -f scripts/create_app_admin_local.sh)
# Or simply run: sudo -u postgres ./scripts/create_app_admin_local.sh

set -euo pipefail

# Defaults match docker-compose.yml
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}
PGDATABASE=${PGDATABASE:-turingdb}
# Default superuser: prefer the current OS user when available (common for
# local Postgres installations), otherwise fall back to 'postgres'. You can
# still override by setting PGSUPERUSER in the environment when invoking the
# script.
PGSUPERUSER=${PGSUPERUSER:-$(whoami)}
PGUSER_TO_GRANT=${PGUSER:-turing}

echo "Using DB host=${PGHOST} port=${PGPORT} db=${PGDATABASE} grant-to-user=${PGUSER_TO_GRANT} superuser=${PGSUPERUSER}"

echo "Creating role 'app_admin' if it does not exist..."
psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$PGDATABASE" <<'SQL'
CREATE ROLE app_admin;
SQL

# Run the grant SQL (the script grants the required table/sequence privileges to app_admin)
if [ -f "./scripts/grant_app_admin_privileges.sql" ]; then
  echo "Applying grants from scripts/grant_app_admin_privileges.sql"
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$PGDATABASE" -f ./scripts/grant_app_admin_privileges.sql
else
  echo "Could not find ./scripts/grant_app_admin_privileges.sql - please ensure it exists"
fi

# Finally grant the helper role to the application DB user
echo "Granting app_admin to $PGUSER_TO_GRANT"
psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$PGDATABASE" <<SQL
GRANT app_admin TO $PGUSER_TO_GRANT;
SQL

echo "Done. If your Postgres instance already existed, ensure the tables/sequences exist before running the grant script. For new dockerized DBs, mounting scripts into /docker-entrypoint-initdb.d will run them automatically on first initialization."