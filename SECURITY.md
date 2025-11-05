# Security Hardening (Implemented)

This project has been upgraded with several security improvements:

- Password hashing with bcrypt (12 rounds) on registration. Legacy plaintext passwords are migrated to a hash on the next successful login.
- Session-based auth using `express-session` with HttpOnly, SameSite=Lax, and Secure (in production) cookies. Legacy cookies (`logged_in`, `username`) are set for compatibility, but the middleware prefers server-side session state and validates any fallback `username` cookie against the database before restoring a session.
- Helmet for common HTTP security headers. CSP is strict on `login.html`/`register.html`. For `index.html`, we temporarily allow `'unsafe-inline'` in `style-src` to support current UI behavior while we remove inline styles.
- CSRF protection is enabled using `csurf` with a cookie-based token. Clients fetch from `GET /csrf-token`; the UI includes `public/js/csrf-auto.js` to manage this automatically.
- Rate limiting for authentication endpoints (e.g., 20 req/15 min) and general traffic (e.g., 300 req/min).
- Ownership checks on session-scoped endpoints (e.g., `/sessions`, `/messages`, `/save-session`, `/delete-session`, `/save-feedback`, `/update-message`, `/update-message-collapsed`, `/update-session-group`, `/groups`, `/create-group`, `/delete-group`, `/rename-group`, `/rename-session`) to prevent horizontal privilege escalation.
- Image uploads are constrained to valid image data URLs and capped at 10 MB per file, stored under `public/uploads/`.
- Postgres-first data layer: queries run through a helper that sets a per-request session GUC `app.current_user_id` so RLS policies can enforce row ownership. A limited helper role `app_admin` can be used for specific administrative operations (e.g., registration, password migration) via `SET LOCAL ROLE app_admin`.

SQLite remains available for legacy/local development scenarios in `database.js`, but the runtime server uses the Postgres data access layer in `server/db/postgres.js` when `DATABASE_URL` is configured.

## Recommended Next Steps

- Input validation: expand `express-validator` beyond auth routes to cover all mutating endpoints.
- Content Security Policy: continue removing inline styles/behaviors to drop `'unsafe-inline'` from `index.html` and move to a fully strict CSP.
- Secrets management: keep secrets (OpenAI key, session secret, DB URL) out of source control (environment or secret store).

## Database Hardening & Migration

### Row-Level Security (RLS)

For strong multi-tenant guarantees, enable Postgres RLS policies that only permit access to rows owned by the current user. The application sets `app.current_user_id` per request using `SELECT set_config('app.current_user_id', $1::text, false);` before executing queries.

Example policies (simplified):

```sql
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE scale_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Only the owner can access their sessions
CREATE POLICY session_owner ON session
  USING (user_id = current_setting('app.current_user_id')::int);

-- Messages are visible if their session is owned by the current user
CREATE POLICY message_session_owner ON message
  USING (session_id IN (
    SELECT id FROM session
    WHERE user_id = current_setting('app.current_user_id')::int
  ));

-- Similar policies for feedback, scale_level, and groups
```

In the application, a small wrapper sets the GUC just-in-time:

```sql
SELECT set_config('app.current_user_id', $1::text, false);
```

Notes:

- We use `false` for the third parameter so the setting applies to the session (suitable for pooled connections where each logical request obtains a fresh connection).
- The server uses AsyncLocalStorage to propagate the authenticated user id through async handlers and ensure the setting is applied for each query.

### Helper role for administrative operations

Some operations during authentication need to run before the request has an established `current_user_id`. Create a limited helper role `app_admin` and grant it DML + sequence privileges. The app attempts `SET LOCAL ROLE app_admin` for these operations and falls back if not available. See `docs/RLS.md` and `scripts/grant_app_admin_privileges.sql`.

### Migration SQLite → Postgres

1. Provision Postgres (or run `docker compose up -d`).
2. Apply `migrations/postgres_schema.sql`.
3. Migrate data with `npm run migrate:sqlite-to-postgres` (see `migrations/README.md`).
4. Enable RLS and policies (examples above), grant `app_admin` as needed, and verify with `scripts/check_rls.js`.

## Content handling and sanitization

- Stored messages: user content is stored as-is to preserve formatting. Server-side sanitization is applied when building history for model input to remove embedded data URIs, tags, and truncate overly long content.
- Assistant content: before persisting, assistant markdown is rendered to HTML and lightly sanitized on the server to remove dangerous tags/attributes.
- Image uploads: validated and size-limited; files are written to `public/uploads/`.

Consider adopting Prisma/Knex for migrations and a more structured data access layer as the app grows.
