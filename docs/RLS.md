Postgres: `app_admin` role (Row-Level Security)

If you deploy this app against Postgres with Row-Level Security (RLS) enabled, the database requires a minimal helper role named `app_admin` that the application can `SET ROLE app_admin` to when performing administrative operations.

- A superuser or DB owner must create the `app_admin` role and grant it the required DML and sequence privileges. A helper script is provided at `scripts/grant_app_admin_privileges.sql` — run it once as a DB admin:

```bash
psql -U <superuser> -h <host> -d <db> -f scripts/grant_app_admin_privileges.sql
```

- The script grants SELECT/INSERT/UPDATE/DELETE on the application tables and USAGE/SELECT on the specific SERIAL sequences used by the tables. Adjust the script if your schema or sequence names differ.

- This approach keeps `app_admin` limited (not a superuser) and allows the app to use `SET ROLE app_admin` without granting superuser privileges.

Notes:
- If you prefer the note in `README.md`, I tried to edit it but the repository path contained characters that prevented a direct in-place edit in this session; I created this `docs/RLS.md` file instead. You can copy the short section into `README.md` if you want it inline.
- If you'd like, I can attempt the README edit again or open a small PR with the change.
