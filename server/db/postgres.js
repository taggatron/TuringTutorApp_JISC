import pkg from 'pg';
import bcrypt from 'bcrypt';
import { AsyncLocalStorage } from 'async_hooks';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// AsyncLocalStorage holds the current authenticated user's id for the
// active request execution context so query() can set a session GUC.
const als = new AsyncLocalStorage();

async function touchSessionTimestamp(sessionId) {
  if (!sessionId) return;
  try {
    await query('UPDATE session SET updated_at = now() WHERE id = $1', [sessionId]);
  } catch (e) {
    if (e && e.code === '42703') return;
    console.error('[DB] Failed to bump session updated_at:', e && e.message ? e.message : e);
  }
}

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
async function saveMessage(session_id, username, role, content, references = null, prompts = null) {
  const params = [session_id, username, role, content];
  const colList = ['session_id', 'username', 'role', 'content'];
  const valList = ['$1', '$2', '$3', '$4'];
  let idx = 5;
  if (references !== null) { colList.push('references_json'); valList.push(`$${idx++}::jsonb`); params.push(typeof references === 'string' ? references : JSON.stringify(references)); }
  if (prompts !== null) { colList.push('prompts_json'); valList.push(`$${idx++}::jsonb`); params.push(typeof prompts === 'string' ? prompts : JSON.stringify(prompts)); }
  const sql = `INSERT INTO message (${colList.join(', ')}) VALUES (${valList.join(', ')}) RETURNING id`;
  const res = await query(sql, params);
  await touchSessionTimestamp(session_id);
  return res.rows[0].id;
}

async function saveMessageWithScaleLevel(session_id, username, role, content, collapsed = 0, scale_level = 1, references = null, prompts = null) {
  const params = [session_id, username, role, content, collapsed, scale_level];
  const colList = ['session_id', 'username', 'role', 'content', 'collapsed', 'scale_level'];
  const valList = ['$1', '$2', '$3', '$4', '$5', '$6'];
  let idx = 7;
  if (references !== null) { colList.push('references_json'); valList.push(`$${idx++}::jsonb`); params.push(typeof references === 'string' ? references : JSON.stringify(references)); }
  if (prompts !== null) { colList.push('prompts_json'); valList.push(`$${idx++}::jsonb`); params.push(typeof prompts === 'string' ? prompts : JSON.stringify(prompts)); }
  const sql = `INSERT INTO message (${colList.join(', ')}) VALUES (${valList.join(', ')}) RETURNING id`;
  const res = await query(sql, params);
  await touchSessionTimestamp(session_id);
  return res.rows[0].id;
}

async function getMessages(session_id) {
  const numId = parseInt(session_id, 10);
  if (isNaN(numId) || numId > 2147483647 || numId < 1) return [];
  // Explicitly select common columns including metadata jsonb columns if present.
  // Some deployments may not have the `footer_removed` column (older schema),
  // so fall back to a query that omits it when Postgres reports unknown column.
  let res;
  try {
    res = await query('SELECT id, session_id, username, role, content, collapsed, scale_level, references_json AS references, prompts_json AS prompts, footer_removed FROM message WHERE session_id = $1 ORDER BY id ASC', [numId]);
  } catch (e) {
    if (e && e.code === '42703') {
      // Column does not exist: retry without footer_removed
      res = await query('SELECT id, session_id, username, role, content, collapsed, scale_level, references_json AS references, prompts_json AS prompts FROM message WHERE session_id = $1 ORDER BY id ASC', [numId]);
    } else throw e;
  }
  // Ensure references/prompts are parsed to native JS objects if stored as strings
  return (res.rows || []).map(r => {
    let refs = r.references;
    if (typeof refs === 'string') {
      try { refs = JSON.parse(refs); } catch (_) { refs = null; }
    }
    let pms = r.prompts;
    if (typeof pms === 'string') {
      try { pms = JSON.parse(pms); } catch (_) { pms = null; }
    }
    return { ...r, references: refs, prompts: pms };
  });
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
  try {
    const res = await query('SELECT * FROM session WHERE user_id = $1 ORDER BY updated_at DESC', [user_id]);
    return res.rows;
  } catch (e) {
    if (e && e.code === '42703') {
      // `updated_at` column missing; fall back to ordering by id (approximate recency)
      const res = await query('SELECT * FROM session WHERE user_id = $1 ORDER BY id DESC', [user_id]);
      return res.rows;
    }
    throw e;
  }
}

async function getSessionById(session_id) {
  const numId = parseInt(session_id, 10);
  if (isNaN(numId) || numId > 2147483647 || numId < 1) return null;
  const res = await query('SELECT * FROM session WHERE id = $1', [numId]);
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
    try {
      await query('UPDATE message SET content = $1, updated_at = now() WHERE id = $2', [content, message_id]);
      await query('UPDATE session SET updated_at = now() WHERE id = (SELECT session_id FROM message WHERE id = $1)', [message_id]);
      return;
    } catch (e) {
      if (e && e.code === '42703') {
        // updated_at doesn't exist; fallback to simple update without timestamps
        await query('UPDATE message SET content = $1 WHERE id = $2', [content, message_id]);
        try { await query('UPDATE session SET updated_at = now() WHERE id = (SELECT session_id FROM message WHERE id = $1)', [message_id]); } catch(_) {}
        return;
      }
      throw e;
    }
  }
  const parts = ['content = $1'];
  const params = [content];
  let idx = 2;
  if (references !== null) { parts.push(`references_json = $${idx++}`); params.push(JSON.stringify(references)); }
  if (prompts !== null) { parts.push(`prompts_json = $${idx++}`); params.push(JSON.stringify(prompts)); }
  if (footer_removed !== null) { parts.push(`footer_removed = $${idx++}`); params.push(!!footer_removed); }
  // Update timestamp directly in SQL to avoid placeholder alignment issues
  parts.push('updated_at = now()');
  params.push(message_id);
  const sql = `UPDATE message SET ${parts.join(', ')} WHERE id = $${params.length}`;
  try {
    await query(sql, params);
    await query('UPDATE session SET updated_at = now() WHERE id = (SELECT session_id FROM message WHERE id = $1)', [message_id]);
  } catch (e) {
    if (e && e.code === '42703') {
      // A column referenced in the constructed parts doesn't exist (e.g., footer_removed or updated_at)
      // Fall back to updating core fields one-by-one as supported by the current schema.
      await query('UPDATE message SET content = $1 WHERE id = $2', [content, message_id]);
      if (references !== null) {
        try { await query('UPDATE message SET references_json = $1 WHERE id = $2', [JSON.stringify(references), message_id]); } catch (_) {}
      }
      if (prompts !== null) {
        try { await query('UPDATE message SET prompts_json = $1 WHERE id = $2', [JSON.stringify(prompts), message_id]); } catch (_) {}
      }
      if (footer_removed !== null) {
        try { await query('UPDATE message SET footer_removed = $1 WHERE id = $2', [!!footer_removed, message_id]); } catch (_) {}
      }
      try { await query('UPDATE session SET updated_at = now() WHERE id = (SELECT session_id FROM message WHERE id = $1)', [message_id]); } catch (_) {}
    } else throw e;
  }
}

async function updateMessageCollapsedState(message_id, collapsed) {
  await query('UPDATE message SET collapsed = $1 WHERE id = $2', [collapsed, message_id]);
}

async function deleteSession(session_id) {
  const numId = parseInt(session_id, 10);
  if (isNaN(numId) || numId <= 0 || numId > 2147483647) return;
  await query('DELETE FROM scale_level WHERE session_id = $1', [numId]);
  await query('DELETE FROM feedback WHERE session_id = $1', [numId]);
  await query('DELETE FROM message WHERE session_id = $1', [numId]);
  await query('DELETE FROM session WHERE id = $1', [numId]);
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
  const numId = parseInt(session_id, 10);
  if (isNaN(numId) || numId <= 0 || numId > 2147483647) return;
  await query('UPDATE session SET group_id = $1 WHERE id = $2', [group_id, numId]);
}

async function renameGroup(group_id, group_name) {
  await query('UPDATE groups SET group_name = $1 WHERE id = $2', [group_name, group_id]);
}

async function renameSession(session_id, session_name) {
  try {
    const numId = parseInt(session_id, 10);
    if (isNaN(numId) || numId <= 0 || numId > 2147483647) return;
    const store = als.getStore();
    const uid = store && store.userId ? String(store.userId) : null;
    if (uid) {
      await query('UPDATE session SET session_name = $1 WHERE id = $2', [session_name, numId]);
      return;
    }
    // If called without ALS user context, lookup owner user_id and set app.current_user_id
    const ownerRes = await pool.query('SELECT user_id FROM session WHERE id = $1', [numId]);
    const ownerUid = ownerRes.rows[0]?.user_id;
    if (ownerUid) {
      await pool.query("SELECT set_config('app.current_user_id', $1, false)", [String(ownerUid)]);
      await pool.query('UPDATE session SET session_name = $1 WHERE id = $2', [session_name, numId]);
    } else {
      await pool.query('UPDATE session SET session_name = $1 WHERE id = $2', [session_name, numId]);
    }
  } catch (e) {
    console.error('Error in renameSession:', e);
  }
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

function runWithUserId(userId, callback) {
  return als.run({ userId: userId ? String(userId) : null }, callback);
}

function setCurrentUserId(userId) {
  return als.enterWith({ userId: userId ? String(userId) : null });
}

// Ensure resource table and RLS policies exist
async function ensureResourceTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS resource (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'web_page',
        title TEXT,
        url TEXT,
        domain TEXT,
        description TEXT,
        content TEXT,
        origin TEXT DEFAULT 'student_web',
        metadata_json JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query('CREATE INDEX IF NOT EXISTS idx_resource_user_id ON resource(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_resource_type ON resource(type)');
    await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_user_url ON resource(user_id, url) WHERE url IS NOT NULL');

    // Ensure RLS enabled
    try {
      await query('ALTER TABLE resource ENABLE ROW LEVEL SECURITY');
      await query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resource' AND policyname = 'resource_select_policy') THEN
            CREATE POLICY resource_select_policy ON resource FOR SELECT USING (
              current_role = 'app_admin' OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
            );
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resource' AND policyname = 'resource_insert_policy') THEN
            CREATE POLICY resource_insert_policy ON resource FOR INSERT WITH CHECK (
              current_role = 'app_admin' OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
            );
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resource' AND policyname = 'resource_modify_policy') THEN
            CREATE POLICY resource_modify_policy ON resource FOR UPDATE USING (
              current_role = 'app_admin' OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
            );
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resource' AND policyname = 'resource_delete_policy') THEN
            CREATE POLICY resource_delete_policy ON resource FOR DELETE USING (
              current_role = 'app_admin' OR user_id = COALESCE(current_setting('app.current_user_id', true), '0')::int
            );
          END IF;
        END $$;
      `);
    } catch (rlsErr) {
      console.warn('[DB] Resource RLS policy setup warning:', rlsErr && rlsErr.message ? rlsErr.message : rlsErr);
    }

    console.log('[DB] resource table and policies ensured');
  } catch (e) {
    console.error('[DB] Failed to ensure resource table:', e && e.message ? e.message : e);
  }
}

// Resources CRUD
async function createResource(userId, resourceData) {
  const {
    type = 'web_page',
    title = '',
    url = '',
    domain = '',
    description = '',
    content = '',
    origin = 'student_web',
    metadata_json = {}
  } = resourceData;

  const metaStr = typeof metadata_json === 'string' ? metadata_json : JSON.stringify(metadata_json || {});

  // Check if resource already exists for this user and URL to prevent duplicates
  if (url) {
    const existing = await getResourceByUrl(userId, url);
    if (existing) {
      // Update with any fresh content/title/metadata if provided
      const updateSql = `
        UPDATE resource 
        SET title = COALESCE(NULLIF($1, ''), title),
            domain = COALESCE(NULLIF($2, ''), domain),
            description = COALESCE(NULLIF($3, ''), description),
            content = COALESCE(NULLIF($4, ''), content),
            metadata_json = $5::jsonb,
            updated_at = NOW()
        WHERE id = $6 AND user_id = $7
        RETURNING *
      `;
      const res = await query(updateSql, [title, domain, description, content, metaStr, existing.id, userId]);
      return { resource: normalizeResourceRow(res.rows[0] || existing), alreadyExisted: true };
    }
  }

  const insertSql = `
    INSERT INTO resource (user_id, type, title, url, domain, description, content, origin, metadata_json, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
    RETURNING *
  `;
  const res = await query(insertSql, [userId, type, title, url, domain, description, content, origin, metaStr]);
  return { resource: normalizeResourceRow(res.rows[0]), alreadyExisted: false };
}

async function getResources(userId, typeFilter = null) {
  let sql = 'SELECT * FROM resource WHERE user_id = $1';
  const params = [userId];
  if (typeFilter && typeFilter !== 'all') {
    sql += ' AND type = $2';
    params.push(typeFilter);
  }
  sql += ' ORDER BY created_at DESC';
  const res = await query(sql, params);
  return res.rows.map(normalizeResourceRow);
}

async function getResourceById(resourceId, userId) {
  const res = await query('SELECT * FROM resource WHERE id = $1 AND user_id = $2 LIMIT 1', [resourceId, userId]);
  return res.rows[0] ? normalizeResourceRow(res.rows[0]) : null;
}

async function getResourceByUrl(userId, url) {
  if (!url) return null;
  const res = await query('SELECT * FROM resource WHERE user_id = $1 AND url = $2 LIMIT 1', [userId, url]);
  return res.rows[0] ? normalizeResourceRow(res.rows[0]) : null;
}

async function getResourcesByIds(resourceIds, userId) {
  if (!Array.isArray(resourceIds) || resourceIds.length === 0) return [];
  const cleanIds = resourceIds.map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
  if (cleanIds.length === 0) return [];
  const res = await query(
    'SELECT * FROM resource WHERE id = ANY($1::int[]) AND user_id = $2 ORDER BY created_at DESC',
    [cleanIds, userId]
  );
  return res.rows.map(normalizeResourceRow);
}

async function deleteResource(resourceId, userId) {
  const res = await query('DELETE FROM resource WHERE id = $1 AND user_id = $2 RETURNING id', [resourceId, userId]);
  return (res.rowCount || 0) > 0;
}

async function updateResource(resourceId, userId, updateData) {
  const { title, description, metadata_json } = updateData;
  const parts = [];
  const params = [];
  let idx = 1;

  if (title !== undefined) {
    parts.push(`title = $${idx++}`);
    params.push(title);
  }
  if (description !== undefined) {
    parts.push(`description = $${idx++}`);
    params.push(description);
  }
  if (metadata_json !== undefined) {
    parts.push(`metadata_json = $${idx++}::jsonb`);
    params.push(typeof metadata_json === 'string' ? metadata_json : JSON.stringify(metadata_json));
  }
  parts.push('updated_at = NOW()');

  if (parts.length === 1) {
    return await getResourceById(resourceId, userId);
  }

  params.push(resourceId, userId);
  const sql = `UPDATE resource SET ${parts.join(', ')} WHERE id = $${idx++} AND user_id = $${idx++} RETURNING *`;
  const res = await query(sql, params);
  return res.rows[0] ? normalizeResourceRow(res.rows[0]) : null;
}

function normalizeResourceRow(row) {
  if (!row) return null;
  let meta = row.metadata_json;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch (_) { meta = {}; }
  }
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type || 'web_page',
    title: row.title || 'Untitled Resource',
    url: row.url || '',
    domain: row.domain || (row.url ? safeExtractDomain(row.url) : ''),
    description: row.description || '',
    content: row.content || '',
    origin: row.origin || 'student_web',
    metadata_json: meta || {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function safeExtractDomain(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
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
  setCurrentUserId,
  runWithUserId,
  ensureMessageMetadataColumns,
  ensureResourceTable,
  createResource,
  getResources,
  getResourceById,
  getResourceByUrl,
  getResourcesByIds,
  deleteResource,
  updateResource
};


