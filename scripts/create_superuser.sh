#!/usr/bin/env bash
set -euo pipefail

# Script to create/alter a Postgres superuser 'danieltagg' using SUPERUSER_PASSWORD
# Reads SUPERUSER_PASSWORD from .env (preferred) or .env.sample (warning: copy .env.sample to .env and edit before use)
# IMPORTANT: Run this as a Postgres superuser (e.g., psql connected as postgres or another superuser account)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Safely extract SUPERUSER_PASSWORD from .env or .env.sample without sourcing
# (sourcing can export unrelated DB vars like PGUSER and also triggers shell history
# expansion on characters like '!' when run under zsh). We only need the password.
SUPERUSER_PASSWORD=""
if [ -f .env ]; then
  SUPERUSER_PASSWORD=$(grep -E '^\s*SUPERUSER_PASSWORD\s*=' .env | head -n1 | sed -E "s/^\s*SUPERUSER_PASSWORD\s*=\s*//")
elif [ -f .env.sample ]; then
  echo "No .env file found; using .env.sample. It's recommended to copy .env.sample to .env and set a secure password."
  SUPERUSER_PASSWORD=$(grep -E '^\s*SUPERUSER_PASSWORD\s*=' .env.sample | head -n1 | sed -E "s/^\s*SUPERUSER_PASSWORD\s*=\s*//")
else
  echo "Missing .env or .env.sample in project root. Create one with SUPERUSER_PASSWORD defined." >&2
  exit 1
fi

# Trim surrounding quotes if present
SUPERUSER_PASSWORD=$(printf '%s' "$SUPERUSER_PASSWORD" | sed -E "s/^['\"]?(.*)['\"]?$/\1/")

if [ -z "${SUPERUSER_PASSWORD}" ]; then
  echo "SUPERUSER_PASSWORD not set in .env or .env.sample" >&2
  exit 1
fi

cat <<'WARN'
This script will create or alter the database role 'danieltagg' and set it as SUPERUSER.
You MUST run this with a Postgres account that has CREATEROLE/SUPERUSER privileges.
The script will prompt before executing.
WARN

read -p "Proceed with creating/altering 'danieltagg' as SUPERUSER? Type 'yes' to continue: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted by user"; exit 1
fi

# Build psql command. If SUPERUSER_DB_USER is set use it as -U <user> so callers can specify
# which DB superuser to connect as (eg 'postgres'). Otherwise psql will use the OS user.
PSQL_CMD=(psql)
if [ -n "${SUPERUSER_DB_USER:-}" ]; then
  PSQL_CMD+=( -U "${SUPERUSER_DB_USER}" )
fi
PSQL_CMD+=( -v SUPERUSER_PASSWORD="'${SUPERUSER_PASSWORD}'" -f scripts/create_superuser.sql )

echo "Running: ${PSQL_CMD[*]}"
"${PSQL_CMD[@]}"

echo "Done. If the script ran successfully, role 'danieltagg' now exists and is a superuser (or was updated)."

echo "Note: Ensure your app does NOT run using a superuser DB connection in production. Use this account only for DBA tasks."
