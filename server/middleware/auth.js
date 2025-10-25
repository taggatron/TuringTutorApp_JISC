export function checkAuth(req, res, next) {
  if ((req.session && req.session.user) || req.cookies.logged_in) {
    next();
  } else {
    if (req.path === '/' || req.path === '/login.html' || req.path === '/register.html') {
      next();
    } else {
      res.redirect('/');
    }
  }
}
