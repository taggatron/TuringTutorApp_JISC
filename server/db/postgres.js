import pkg from 'pg';
import bcrypt from 'bcrypt';
import { AsyncLocalStorage } from 'async_hooks';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// AsyncLocalStorage holds the current authenticated user's id for the
// active request execution context so query() can set a session GUC.
const als = new AsyncLocalStorage();

async function query(text, params = []) {
  const client = await pool.connect();
  try {
    const store = als.getStore();
    const uid = store && store.userId ? String(store.userId) : null;
    if (uid) {
      // set per-connection variable used by RLS policies
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [uid]);
    }
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Users
async function registerUser(username, password) {
  const hash = await bcrypt.hash(password, 12);
  const res = await query('INSERT INTO app_user (username, password_hash) VALUES ($1, $2) RETURNING id', [username, hash]);
  return res.rows[0].id;
}

async function getUser(username) {
  const res = await query('SELECT id, username, password_hash AS password FROM app_user WHERE username = $1 LIMIT 1', [username]);
  return res.rows[0] || null;
}

async function updateUserPassword(username, newHashedPassword) {
  await query('UPDATE app_user SET password_hash = $1 WHERE username = $2', [newHashedPassword, username]);
}

// Sessions
async function createSession(user_id, username, session_name) {
  const res = await query('INSERT INTO session (user_id, username, session_name) VALUES ($1, $2, $3) RETURNING id', [user_id, username, session_name]);
  const sessionId = res.rows[0].id;
  // initialize scale level
  await query('INSERT INTO scale_level (session_id, username, scale_level) VALUES ($1, $2, $3)', [sessionId, username, 1]);
  return sessionId;
}

async function createTuringSession(user_id, username, session_name = 'Turing Mode') {
  const res = await query('INSERT INTO session (user_id, username, session_name, is_turing) VALUES ($1, $2, $3, true) RETURNING id', [user_id, username, session_name]);
  const sessionId = res.rows[0].id;
  await query('INSERT INTO scale_level (session_id, username, scale_level) VALUES ($1, $2, $3)', [sessionId, username, 1]);
  return sessionId;
}

// Messages
async function saveMessage(session_id, username, role, content, collapsed = 0) {
  const res = await query('INSERT INTO message (session_id, username, role, content, collapsed) VALUES ($1, $2, $3, $4, $5) RETURNING id', [session_id, username, role, content, collapsed]);
  return res.rows[0].id;
}

async function saveMessageWithScaleLevel(session_id, username, role, content, collapsed = 0, scale_level = 1) {
  const res = await query('INSERT INTO message (session_id, username, role, content, collapsed, scale_level) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [session_id, username, role, content, collapsed, scale_level]);
  return res.rows[0].id;
}

async function getMessages(session_id) {
  const res = await query('SELECT * FROM message WHERE session_id = $1 ORDER BY id ASC', [session_id]);
  return res.rows;
}

// Feedback
async function saveFeedback(session_id, message_id, username, content) {
  // if message_id null, find last message
  let mid = message_id;
  if (!mid) {
    const r = await query('SELECT id FROM message WHERE session_id = $1 ORDER BY id DESC LIMIT 1', [session_id]);
    if (!r.rows[0]) throw new Error('No message found for session');
    mid = r.rows[0].id;
  }
  await query('INSERT INTO feedback (session_id, message_id, username, content) VALUES ($1, $2, $3, $4)', [session_id, mid, username, content]);
}

async function getFeedback(session_id) {
  const res = await query('SELECT * FROM feedback WHERE session_id = $1', [session_id]);
  return res.rows.map(r => ({ messageId: r.message_id, feedbackContent: r.content }));
}

async function saveScaleLevel(session_id, username, scale_level) {
  const res = await query('INSERT INTO scale_level (session_id, username, scale_level) VALUES ($1, $2, $3) RETURNING id', [session_id, username, scale_level]);
  return res.rows[0].id;
}

async function getScaleLevels(session_id) {
  const res = await query('SELECT scale_level FROM scale_level WHERE session_id = $1', [session_id]);
  return res.rows;
}

async function getSessions(user_id) {
  const res = await query('SELECT * FROM session WHERE user_id = $1', [user_id]);
  return res.rows;
}

async function getSessionById(session_id) {
  const res = await query('SELECT * FROM session WHERE id = $1', [session_id]);
  return res.rows[0] || null;
}

async function getSessionByMessageId(message_id) {
  const res = await query('SELECT s.* FROM session s INNER JOIN message m ON m.session_id = s.id WHERE m.id = $1 LIMIT 1', [message_id]);
  return res.rows[0] || null;
}

async function getMessageByContent(session_id, content) {
  const res = await query('SELECT * FROM message WHERE session_id = $1 AND content = $2 LIMIT 1', [session_id, content]);
  return res.rows[0] || null;
}

async function updateMessageContent(message_id, content) {
  await query('UPDATE message SET content = $1 WHERE id = $2', [content, message_id]);
}

async function updateMessageCollapsedState(message_id, collapsed) {
  await query('UPDATE message SET collapsed = $1 WHERE id = $2', [collapsed, message_id]);
}

async function deleteSession(session_id) {
  await query('DELETE FROM scale_level WHERE session_id = $1', [session_id]);
  await query('DELETE FROM feedback WHERE session_id = $1', [session_id]);
  await query('DELETE FROM message WHERE session_id = $1', [session_id]);
  await query('DELETE FROM session WHERE id = $1', [session_id]);
}

async function getNextSessionId() {
  const res = await query('SELECT MAX(id) as maxid FROM session');
  return (res.rows[0].maxid || 0) + 1;
}

// Groups
async function createGroup(user_id, username, group_name) {
  const res = await query('INSERT INTO groups (user_id, username, group_name) VALUES ($1, $2, $3) RETURNING id', [user_id, username, group_name]);
  return res.rows[0].id;
}

async function deleteGroup(group_id) {
  await query('UPDATE session SET group_id = NULL WHERE group_id = $1', [group_id]);
  await query('DELETE FROM groups WHERE id = $1', [group_id]);
}

async function getUserGroups(user_id) {
  const res = await query('SELECT * FROM groups WHERE user_id = $1 ORDER BY id ASC', [user_id]);
  return res.rows;
}

async function updateSessionGroup(session_id, group_id) {
  await query('UPDATE session SET group_id = $1 WHERE id = $2', [group_id, session_id]);
}

async function renameGroup(group_id, group_name) {
  await query('UPDATE groups SET group_name = $1 WHERE id = $2', [group_name, group_id]);
}

async function renameSession(session_id, session_name) {
  await query('UPDATE session SET session_name = $1 WHERE id = $2', [session_name, session_id]);
}

// Middleware to attach current user id into AsyncLocalStorage for each request
function attachDbUser(req, res, next) {
  const uid = req && req.session && req.session.user ? String(req.session.user.id) : '0';
  // Use als.run to create an execution context that will be propagated
  // to all downstream async operations started by this request. This is
  // more reliable than enterWith in some server frameworks where the
  // continuation may run in a different async scope.
  als.run({ userId: uid }, () => next());
}

// Helper to set current user id programmatically for the current execution
// context (useful immediately after login within the same request)
function setCurrentUserId(userId) {
  // enterWith is appropriate for programmatic calls that want to
  // establish the store for the current async context (for example,
  // immediately after login within the same request handler).
  als.enterWith({ userId: userId ? String(userId) : '0' });
}

export {
  registerUser,
  getUser,
  updateUserPassword,
  createSession,
  createTuringSession,
  saveMessage,
  saveMessageWithScaleLevel,
  getMessages,
  saveFeedback,
  getFeedback,
  saveScaleLevel,
  getScaleLevels,
  getSessions,
  getSessionById,
  getSessionByMessageId,
  getMessageByContent,
  updateMessageContent,
  updateMessageCollapsedState,
  deleteSession,
  getNextSessionId,
  createGroup,
  deleteGroup,
  getUserGroups,
  updateSessionGroup,
  renameGroup,
  renameSession,
  query,
  pool,
  attachDbUser,
  setCurrentUserId
};

