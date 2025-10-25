# TuringTutorApp_JISC

This project is a Node.js + Express app with a simple SQLite backing store and a browser-based UI under `public/`.

## What changed in this refactor

- Passwords are now hashed with bcrypt (12 rounds). On first successful login with an older plaintext-stored account, the password is migrated to a hash automatically.
- Introduced session-based authentication (`express-session`) with secure cookies. Legacy cookies remain for compatibility with the existing frontend and WebSocket handshake.
- Added Helmet and rate limiting. Basic ownership checks were added to session-scoped endpoints to prevent cross-user access.
- SQLite schema hardened: foreign keys enabled and helpful indices added.
- Documentation: `.env.sample` and `SECURITY.md` were added to guide deployment hardening and a Postgres + RLS migration path.

## Quick start

1. Node 18+ is required (see `package.json` engines).
1. Copy `.env.sample` to `APIkey.env` (the app currently points there) and set values:

```env
OPENAI_API_KEY=sk-...
SESSION_SECRET=some-long-random-string
NODE_ENV=development
```

1. Install dependencies:

```bash
npm install
```

1. Run the server:

```bash
npm start
```

The app will be available at <http://localhost:3000>

## Notes

- Content Security Policy is currently disabled to avoid breaking inline scripts. To harden further, move inline JS/CSS into separate files and enable Helmet's CSP.
- CSRF protection is not yet enabled because the UI expects simple POSTs; consider adding `csurf` once you can include a token in requests.
- Consider moving to Postgres and enabling Row-Level Security for strong multi-tenant data isolation. See `SECURITY.md` for details.
