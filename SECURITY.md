# Security Hardening (Implemented)

This project has been upgraded with several security improvements:

- Password hashing with bcrypt (12 rounds) on registration. Plaintext passwords are migrated to hashed on next successful login.
- Session-based auth using `express-session` with HttpOnly, SameSite=Lax, and Secure (in production) cookies. Legacy cookies (`logged_in`, `username`) are still set for compatibility with the existing frontend and WebSocket handshake.
 - Session-based auth using `express-session` with HttpOnly, SameSite=Lax, and Secure (in production) cookies. Legacy cookies (`logged_in`, `username`) are still set for compatibility with the existing frontend and WebSocket handshake.
   - Note: trusting the mere presence of a cookie (e.g. `logged_in`) as proof of authentication is insecure because cookies can be forged or spoofed. The middleware was updated to prefer server-side session state and to validate any fallback `username` cookie against the database before restoring a session.
- Helmet for common HTTP security headers (CSP disabled to avoid breaking current inline scripts/styles).
- Rate limiting for authentication endpoints and general traffic.
- Ownership checks on all session-scoped endpoints (`/messages`, `/save-session`, `/delete-session`, `/save-feedback`, `/update-message`, `/update-message-collapsed`, `/update-session-group`, and group deletion) to prevent horizontal privilege escalation.
- SQLite `PRAGMA foreign_keys=ON` and helpful indices for performance and integrity.

## Recommended Next Steps

- Input validation: add `zod` or `express-validator` for stricter request payload validation across all endpoints.
- Content Security Policy: replace inline scripts/styles in `public/` with external files and enable Helmet's CSP.
- CSRF protection: if you continue to use cookies for session auth on POST/PUT/DELETE, add a CSRF token flow (e.g., `csurf`).
- Secrets management: move secrets from `APIkey.env` to `.env` (or a secret store in production), and never commit them.

Notes on Database Hardening & Migration
--------------------------------------
- Row-Level Security (RLS): SQLite doesn't support RLS. For stronger multi-tenant guarantees, migrate to Postgres and enable RLS policies that only permit access to rows owned by the current user (example SQL added below).
- Migration steps (high-level):
  1. Provision a Postgres instance (managed or self-hosted).
  2. Export existing SQLite data and transform to Postgres types (e.g., using `sqlite3` + custom scripts or `pgloader`).
  3. Apply schema improvements and indexes in Postgres (see example schema in this file).
  4. Add RLS policies (example below) and set the current user id in each DB connection/session.

Example RLS policy (Postgres):

```sql
-- Example policy: only the owner can access their rows
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_owner ON session
  USING (user_id = current_setting('app.user_id')::int);

ALTER TABLE message ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_owner ON message
  USING (session_id IN (SELECT id FROM session WHERE user_id = current_setting('app.user_id')::int));

-- similar policies for feedback and scale_level
```

Implementation note: set the `app.user_id` per-request on the DB connection (e.g., `SELECT set_config('app.user_id', $1::text, true);`) so that RLS policies evaluate per-request.

## Database Row-Level Security (RLS) and Migration to Postgres

SQLite does not support Row-Level Security. For multi-tenant security guarantees, migrate to Postgres and enable RLS.

### Example Postgres schema (sketch)

```sql
CREATE TABLE app_user (
  id serial PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE session (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_name text NOT NULL,
  group_id int,
  is_turing boolean DEFAULT false
);

CREATE TABLE message (
  id serial PRIMARY KEY,
  session_id int NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  username text,
  role text NOT NULL,
  content text NOT NULL,
  collapsed boolean DEFAULT false,
  scale_level int DEFAULT 1
);

CREATE TABLE feedback (
  id serial PRIMARY KEY,
  session_id int NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  message_id int REFERENCES message(id) ON DELETE CASCADE,
  username text,
  content text NOT NULL
);

CREATE TABLE scale_level (
  id serial PRIMARY KEY,
  session_id int NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  username text,
  scale_level int NOT NULL,
  created_at timestamptz DEFAULT now()
);
```sql

### Enable RLS

```sql
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE scale_level ENABLE ROW LEVEL SECURITY;

-- Example policy: only the owner can access their rows
CREATE POLICY session_owner ON session
  USING (user_id = current_setting('app.user_id')::int);

CREATE POLICY message_session_owner ON message
  USING (session_id IN (SELECT id FROM session WHERE user_id = current_setting('app.user_id')::int));

-- similarly for feedback and scale_level
```

In your application, set the current user context on each request (per pooled connection) before queries:

```sql
SELECT set_config('app.user_id', $1::text, true);
```

And use a per-request database connection or a transaction so the setting is scoped properly.

Consider Prisma or Knex for migrations and a clean data access layer.
