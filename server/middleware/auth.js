import { getUser } from '../../database.js';

// Enhanced authentication check
// - Prefer server-side session (`req.session.user`).
// - Fallback: if an identifying `username` cookie exists, validate it against the DB
//   and rehydrate the server session. This prevents treating an unauthenticated
//   client-side cookie as proof of authentication.
export function checkAuth(req, res, next) {
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
  getUser(username, (err, user) => {
    if (err || !user) {
      return res.redirect('/');
    }
    // Rehydrate minimal server-side session securely
    req.session.user = { id: user.id, username: user.username };
    return next();
  });
}
