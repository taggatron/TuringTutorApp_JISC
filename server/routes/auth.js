import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import * as pgdb from '../db/postgres.js';

const router = express.Router();

// Rate limiter for auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// POST /register
router.post('/register', authLimiter,
  [
    body('username').trim().isLength({ min: 3, max: 32 }).isAlphanumeric().withMessage('Username must be 3-32 chars, alphanumeric'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json({ success: false, message: errors.array()[0].msg });
    }
    (async () => {
      try {
        const { username, password } = req.body;
        // Check existing
        const existing = await pgdb.getUser(username);
        if (existing) return res.json({ success: false, message: 'Username already exists' });
        await pgdb.registerUser(username, password);
        return res.json({ success: true });
      } catch (err) {
        console.error('Registration error:', err);
        return res.json({ success: false, message: 'Registration failed' });
      }
    })();
  }
);

// POST /login
router.post('/login', authLimiter,
  [
    body('username').trim().isLength({ min: 3, max: 32 }).isAlphanumeric(),
    body('password').isLength({ min: 8 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }
    (async () => {
      try {
        const { username, password } = req.body;
        const user = await pgdb.getUser(username);
        if (!user) return res.json({ success: false, message: 'Invalid credentials' });
        const stored = user.password || '';
        const isHashed = typeof stored === 'string' && stored.startsWith('$2');

        if (isHashed) {
          const ok = await bcrypt.compare(password, stored);
          if (!ok) return res.json({ success: false, message: 'Invalid credentials' });
        } else {
          // legacy plaintext: verify and migrate
          if (stored !== password) return res.json({ success: false, message: 'Invalid credentials' });
          const newHash = await bcrypt.hash(password, 12);
          await pgdb.updateUserPassword(username, newHash);
        }

        req.session.user = { id: user.id, username: user.username };
        res.cookie('logged_in', true, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        res.cookie('username', username, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        return res.json({ success: true });
      } catch (err) {
        console.error('Login error:', err);
        return res.json({ success: false, message: 'Invalid credentials' });
      }
    })();
  }
);

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('logged_in');
    res.clearCookie('username');
    res.json({ success: true });
  });
});

// GET /csrf-token
router.get('/csrf-token', (req, res) => {
  try {
    const token = req.csrfToken();
    res.cookie('XSRF-TOKEN', token, { sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ csrfToken: token });
  } catch (e) {
    res.status(500).json({ error: 'Could not generate CSRF token' });
  }
});

export default router;
