# TuringTutorApp_JISC

Node.js + Express app with a browser UI under `public/`, now running primarily on Postgres (RLS-ready) and streaming responses via WebSockets.

## What changed recently

- Database: Postgres is now the primary DB (via `pg` and `DATABASE_URL`). The server sets a per-request `app.current_user_id` GUC using AsyncLocalStorage so Postgres Row-Level Security (RLS) policies can enforce ownership automatically. A helper role `app_admin` is used (when present) for privileged operations like user registration and password updates. A migration helper for SQLite → Postgres is included under `migrations/`.
- Auth: session-based authentication (`express-session`) with secure cookies. Legacy cookies (`logged_in`, `username`) remain for compatibility but are validated server-side before restoring a session.
- CSRF: cookie-based CSRF protection (`csurf`) is enabled. Fetch a token from `GET /csrf-token` and echo it back in requests (the UI auto-handles this via `public/js/csrf-auto.js`).
- Security headers: Helmet is enabled. CSP is strict for `login.html`/`register.html`. The main app (`index.html`) currently allows `'unsafe-inline'` styles temporarily to support existing UI; we plan to remove this exception.
- Rate limiting: authentication endpoints and general traffic are rate-limited.
- Ownership checks: enforced on session-scoped routes (messages, feedback, groups, rename, delete, etc.) to prevent cross-user access.
- Turing Mode: special sessions that seed an editable assistant message and support saving structured metadata (references and prompts) stored in JSONB columns.
- File uploads: a safe image upload endpoint writes to `public/uploads/` with a 10MB limit and strict data URL validation.
- Streaming/OpenAI: WebSocket-based streaming for assistant replies, with server-side sanitization before sending content to the model.

## Quick start (local Postgres)

1. Requirements

- Node 18+ (see `package.json` engines)
- Docker (optional, for local Postgres)

1. Start Postgres locally (optional but recommended for dev)

```bash
docker compose up -d
```

This brings up a Postgres 15 container per `docker-compose.yml` (defaults: user `turing`, db `turingdb`, password `Hidden`).

1. Configure environment

Create `APIkey.env` in the repo root with at least:

```env
OPENAI_API_KEY=sk-...
SESSION_SECRET=some-long-random-string
NODE_ENV=development
# Point the app at your Postgres; adjust if you run your own instance
DATABASE_URL=postgresql://turing:turingpass@localhost:5432/turingdb

# Optional HTTPS (if you have certs); otherwise the app serves HTTP
# HTTPS_ENABLED=true
# SSL_KEY_PATH=./localhost+2-key.pem
# SSL_CERT_PATH=./localhost+2.pem
```

1. Install dependencies

```bash
npm install
```

1. Initialize schema and (optional) migrate from SQLite

- Apply the Postgres schema in `migrations/postgres_schema.sql` to your database, then (optionally) run the migration helper to copy from the legacy `users.db`:

```bash
# (Optional) migrate existing local data
npm run migrate:sqlite-to-postgres
```

1. Run the server

```bash
npm start
```

By default the app listens on port 3000; if the port is taken, it will try the next available one. Visit `http://localhost:3000` (or the reported port).

## Working with RLS in Postgres

- The app sets `app.current_user_id` per request so RLS policies can filter rows by owner. See `SECURITY.md` for example policies.
- For administrative operations during auth (e.g., `getUser`, `registerUser`, password migration), the app will attempt `SET LOCAL ROLE app_admin` and fall back gracefully if unavailable. To provision this helper role, see `docs/RLS.md` and `scripts/grant_app_admin_privileges.sql`. A local bootstrap helper is provided: `npm run db:create-app-admin`.

## CSRF and cookies

- CSRF: fetch a token from `GET /csrf-token`. The UI auto-includes this via `public/js/csrf-auto.js`.
- Cookies: the server sets `logged_in` and `username` for legacy flows, but server-side session state is authoritative. A bare `logged_in` cookie is never trusted without DB-backed validation.

## Notes and next steps

- CSP: `login.html` and `register.html` use a strict CSP; `index.html` temporarily allows `'unsafe-inline'` styles to support current UI and html2canvas usage. Moving remaining inline styles/behaviors to external scripts/CSS will allow a fully strict CSP.
- Input validation: `express-validator` is enabled on auth routes; expanding validation across all endpoints is recommended.
- See `SECURITY.md` for detailed hardening guidance, RLS examples, and operational notes.
