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
      // Use is_local = false so the setting persists for the session (across subsequent queries)
      // set_config(..., true) only applies to the current transaction, which is not suitable
      // when each query runs in its own transaction (autocommit).
      await client.query("SELECT set_config('app.current_user_id', $1, false)", [uid]);
    }
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Ensure JSONB metadata columns exist for durable references/prompts storage
// This is idempotent and safe to run at startup.
async function ensureMessageMetadataColumns() {
  try {
    await query("ALTER TABLE message ADD COLUMN IF NOT EXISTS references_json jsonb DEFAULT '[]'::jsonb");
    await query("ALTER TABLE message ADD COLUMN IF NOT EXISTS prompts_json jsonb DEFAULT '[]'::jsonb");
    console.log('[DB] message metadata columns ensured (references_json, prompts_json)');
  } catch (e) {
    console.error('[DB] Failed to ensure message metadata columns:', e && e.message ? e.message : e);
  }
}

// Users
async function registerUser(username, password) {
  const hash = await bcrypt.hash(password, 12);
  // Try to perform the insert using the helper role `app_admin` if available.
  // This helps when Row-Level Security is enabled and a privileged helper
  // role is required to perform administrative inserts. If the role is not
  // available or SET ROLE fails, fall back to a normal insert and let the
  // database RLS policies decide (which may still fail).
  const client = await pool.connect();
  try {
    try {
      console.debug('registerUser: attempting insert using SET LOCAL ROLE app_admin');
      // Use a transaction so SET LOCAL ROLE only affects this transaction
      await client.query('BEGIN');
      await client.query("SET LOCAL ROLE app_admin");
      const res = await client.query('INSERT INTO app_user (username, password_hash) VALUES ($1, $2) RETURNING id', [username, hash]);
      await client.query('COMMIT');
      console.debug('registerUser: insert under app_admin succeeded, id=', res.rows[0].id);
      return res.rows[0].id;
    } catch (e) {
      console.error('registerUser: SET LOCAL ROLE app_admin path failed, will attempt fallback insert. Error:', e && e.message ? e.message : e);
      // If we couldn't SET ROLE (insufficient privilege or role missing),
      // rollback the transaction and try the plain insert as a fallback.
      try { await client.query('ROLLBACK'); } catch (_) {}
      const res = await client.query('INSERT INTO app_user (username, password_hash) VALUES ($1, $2) RETURNING id', [username, hash]);
      console.debug('registerUser: fallback insert result id=', res.rows[0].id);
      return res.rows[0].id;
    }
  } finally {
    client.release();
  }
}

async function getUser(username) {
  // Read user record using the privileged helper role when available so
  // login (which runs before a session/user id is set) can see the row
  // even when RLS is enabled. Fall back to a normal query if the SET
  // ROLE attempt fails.
  const client = await pool.connect();
  try {
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL ROLE app_admin");
      const res = await client.query('SELECT id, username, password_hash AS password FROM app_user WHERE username = $1 LIMIT 1', [username]);
      await client.query('COMMIT');
      return res.rows[0] || null;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      const res = await client.query('SELECT id, username, password_hash AS password FROM app_user WHERE username = $1 LIMIT 1', [username]);
      return res.rows[0] || null;
    }
  } finally {
    client.release();
  }
}

async function updateUserPassword(username, newHashedPassword) {
  // Perform the password update under the helper role when possible so
  // migrations from plaintext happen even before the session user id is set.
  const client = await pool.connect();
  try {
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL ROLE app_admin");
      await client.query('UPDATE app_user SET password_hash = $1 WHERE username = $2', [newHashedPassword, username]);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      await client.query('UPDATE app_user SET password_hash = $1 WHERE username = $2', [newHashedPassword, username]);
    }
  } finally {
    client.release();
  }
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
async function saveMessage(session_id, username, role, content, collapsed = 0, references = null, prompts = null) {
  // keep backward compatible parameter order; references/prompts are optional jsonb
  const params = [session_id, username, role, content, collapsed];
  let sql = 'INSERT INTO message (session_id, username, role, content, collapsed';
  let vals = ' VALUES ($1, $2, $3, $4, $5)';
  let idx = 6;
  if (references !== null) { sql += ', references_json'; vals += `, $${idx++}`; params.push(JSON.stringify(references)); }
  if (prompts !== null) { sql += ', prompts_json'; vals += `, $${idx++}`; params.push(JSON.stringify(prompts)); }
  sql += ')' + vals + ' RETURNING id';
  const res = await query(sql, params);
  return res.rows[0].id;
}

async function saveMessageWithScaleLevel(session_id, username, role, content, collapsed = 0, scale_level = 1, references = null, prompts = null) {
  const params = [session_id, username, role, content, collapsed, scale_level];
  let sql = 'INSERT INTO message (session_id, username, role, content, collapsed, scale_level';
  let vals = ' VALUES ($1, $2, $3, $4, $5, $6)';
  let idx = 7;
  if (references !== null) { sql += ', references_json'; vals += `, $${idx++}`; params.push(JSON.stringify(references)); }
  if (prompts !== null) { sql += ', prompts_json'; vals += `, $${idx++}`; params.push(JSON.stringify(prompts)); }
  sql += ')' + vals + ' RETURNING id';
  const res = await query(sql, params);
  return res.rows[0].id;
}

async function getMessages(session_id) {
  // Explicitly select common columns including metadata jsonb columns if present
  const res = await query('SELECT id, session_id, username, role, content, collapsed, scale_level, references_json AS references, prompts_json AS prompts FROM message WHERE session_id = $1 ORDER BY id ASC', [session_id]);
  // Ensure references/prompts are parsed to native JS objects if stored as strings
  return res.rows.map(r => ({
    ...r,
    references: r.references === null || r.references === undefined ? [] : (typeof r.references === 'string' ? JSON.parse(r.references) : r.references),
    prompts: r.prompts === null || r.prompts === undefined ? [] : (typeof r.prompts === 'string' ? JSON.parse(r.prompts) : r.prompts)
  }));
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

// Find an existing assistant message for this session that has empty content.
// Used by Turing Mode to update the initial blank assistant message instead
// of inserting a duplicate assistant row when the streamed content completes.
async function getEmptyAssistantMessage(session_id) {
  const res = await query("SELECT id FROM message WHERE session_id = $1 AND role = 'assistant' AND (content IS NULL OR content = '') ORDER BY id ASC LIMIT 1", [session_id]);
  return res.rows[0] || null;
}

async function updateMessageContent(message_id, content, references = null, prompts = null, footer_removed = null) {
  // Update content and optional metadata. Keep backwards compatibility for callers that only pass content.
  if (references === null && prompts === null && (footer_removed === null)) {
    await query('UPDATE message SET content = $1 WHERE id = $2', [content, message_id]);
    return;
  }
  const parts = ['content = $1'];
  const params = [content];
  let idx = 2;
  if (references !== null) { parts.push(`references_json = $${idx++}`); params.push(JSON.stringify(references)); }
  if (prompts !== null) { parts.push(`prompts_json = $${idx++}`); params.push(JSON.stringify(prompts)); }
  if (footer_removed !== null) { parts.push(`footer_removed = $${idx++}`); params.push(!!footer_removed); }
  params.push(message_id);
  const sql = `UPDATE message SET ${parts.join(', ')} WHERE id = $${params.length}`;
  await query(sql, params);
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
  // Use null when there is no authenticated user so we do not set
  // the session GUC to '0' (a truthy string). If we set '0' then RLS
  // policies that COALESCE the setting to '0' will hide rows from
  // unauthenticated requests. Using null avoids writing the GUC at all.
  const uid = req && req.session && req.session.user ? String(req.session.user.id) : null;
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
  // Use null when clearing the current user so the query() helper
  // doesn't set the session GUC to '0' which would interfere with
  // RLS policies that expect the GUC to be absent for anonymous users.
  als.enterWith({ userId: userId ? String(userId) : null });
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
  getEmptyAssistantMessage,
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
  setCurrentUserId, ensureMessageMetadataColumns
};

