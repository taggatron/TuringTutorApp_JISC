Migration guide: SQLite -> Postgres
=================================

This folder contains a small helper script and an example schema to migrate the project's data from the local SQLite `users.db` into a Postgres database. The script is intended for one-time migration in a development or staging environment — test thoroughly before running on production data.

Files
- `postgres_schema.sql` — recommended Postgres schema (tables, indexes).
- `sqlite_to_postgres.js` — Node script that copies data from `users.db` to Postgres. It reads rows from SQLite and inserts them into Postgres while preserving numeric ids where possible.

Prerequisites
- Node >= 18 (project `package.json` requires Node 18+)
- Postgres server accessible with a user that can create tables and insert data
- Environment variables for Postgres connection set (one of the following):
  - `DATABASE_URL` (preferred), or
  - `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`.

Usage
1. Create a new empty Postgres database (or pick an empty schema).
2. Apply the schema (example):

```bash
# from the repository root
psql "$DATABASE_URL" -f migrations/postgres_schema.sql
```

3. Run the migration script (this will copy rows from `users.db` into Postgres):

```bash
# set connection and run
export DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
node migrations/sqlite_to_postgres.js
```

4. After migration, verify counts, and optionally enable Row-Level Security (RLS) policies — an example RLS policy is in the repository `SECURITY.md`.

Notes & caveats
- The helper script attempts to preserve primary key ids so references remain valid. It also attempts to set the Postgres sequences to the max(id) values.
- Large datasets: the script uses simple batched operations; for very large datasets consider using `pg_copy`/`COPY`-based approaches or `pgloader`.
- Backups: always take backups of both databases before running destructive operations.

If you'd like, I can add a dry-run mode, stricter validation, or a reverse-migration script.
