import { getUser, setCurrentUserId } from '../db/postgres.js';

// Enhanced authentication check
// - Prefer server-side session (`req.session.user`).
// - Fallback: if an identifying `username` cookie exists, validate it against the DB
//   and rehydrate the server session. This prevents treating an unauthenticated
//   client-side cookie as proof of authentication.
export async function checkAuth(req, res, next) {
  // Allow access to public pages without auth
  const publicPaths = new Set(['/', '/login.html', '/register.html']);
  if (publicPaths.has(req.path)) return next();

  // If server-side session exists, allow through
  if (req.session && req.session.user) {
    return next();
  }

  // Fallback: do not accept an unsigned 'logged_in' cookie as proof.
  // Instead, verify the `username` cookie against the users table.
  const username = req.cookies && req.cookies.username;
  if (!username) {
    // No session and no identifying cookie -> redirect to home/login
    return res.redirect('/');
  }

  // Validate username exists in DB and restore session
  try {
    const user = await getUser(username);
    if (!user) return res.redirect('/');
    // Rehydrate minimal server-side session securely
    req.session.user = { id: user.id, username: user.username };
    // Ensure the DB context for RLS is set for the remainder of this request
    try {
      setCurrentUserId(user.id);
    } catch (e) {
      // Non-fatal: continue even if context couldn't be set
      console.error('Could not set DB context for user', e);
    }
    return next();
  } catch (e) {
    console.error('Auth middleware DB error', e);
    return res.redirect('/');
  }
}
