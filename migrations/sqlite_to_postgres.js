import sqlite3 from 'sqlite3';
import { Client } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlitePath = path.join(__dirname, '..', 'users.db');

const db = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Could not open SQLite DB at', sqlitePath, err.message);
    process.exit(1);
  }
});

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined
});

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function migrate() {
  await client.connect();
  console.log('Connected to Postgres');

  try {
    await client.query('BEGIN');

    // Users
    const users = await sqliteAll('SELECT id, username, password FROM users');
    for (const u of users) {
      // Insert into app_user; map password -> password_hash
      await client.query(
        `INSERT INTO app_user(id, username, password_hash) VALUES ($1, $2, $3)`,
        [u.id, u.username, u.password || '']
      );
    }

    // Groups
    const groups = await sqliteAll('SELECT id, user_id, username, group_name FROM groups');
    for (const g of groups) {
      await client.query(`INSERT INTO groups(id, user_id, username, group_name) VALUES ($1, $2, $3, $4)`, [g.id, g.user_id, g.username, g.group_name]);
    }

    // Sessions
    const sessions = await sqliteAll('SELECT id, user_id, username, session_name, group_id, is_turing FROM sessions');
    for (const s of sessions) {
      await client.query(`INSERT INTO session(id, user_id, session_name, group_id, is_turing) VALUES ($1, $2, $3, $4, $5)`, [s.id, s.user_id, s.session_name, s.group_id || null, s.is_turing === 1]);
    }

    // Messages (note: sqlite column name message_id will map to id in postgres)
    const messages = await sqliteAll('SELECT message_id, session_id, username, role, content, collapsed, scale_level FROM messages');
    for (const m of messages) {
      await client.query(`INSERT INTO message(id, session_id, username, role, content, collapsed, scale_level) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [m.message_id, m.session_id, m.username, m.role, m.content, !!m.collapsed, m.scale_level || 1]);
    }

    // Feedback
    const feedback = await sqliteAll('SELECT id, session_id, message_id, username, content, position FROM feedback');
    for (const f of feedback) {
      await client.query(`INSERT INTO feedback(id, session_id, message_id, username, content, position) VALUES ($1, $2, $3, $4, $5, $6)`, [f.id, f.session_id, f.message_id, f.username, f.content, f.position]);
    }

    // Scale levels
    const scaleLevels = await sqliteAll('SELECT id, session_id, username, scale_level, timestamp FROM scale_levels');
    for (const s of scaleLevels) {
      await client.query(`INSERT INTO scale_level(id, session_id, username, scale_level, created_at) VALUES ($1, $2, $3, $4, $5)`, [s.id, s.session_id, s.username, s.scale_level, s.timestamp || null]);
    }

    // Update sequences to the max existing ids
    const seqUpdates = [
      { table: 'app_user', col: 'id' },
      { table: 'groups', col: 'id' },
      { table: 'session', col: 'id' },
      { table: 'message', col: 'id' },
      { table: 'feedback', col: 'id' },
      { table: 'scale_level', col: 'id' }
    ];

    for (const s of seqUpdates) {
      const { table, col } = s;
      const res = await client.query(`SELECT MAX(${col}) as maxid FROM ${table}`);
      const maxid = res.rows[0].maxid || 0;
      if (maxid > 0) {
        await client.query(`SELECT setval(pg_get_serial_sequence($1, $2), $3, true)`, [table, col, maxid]);
      }
    }

    await client.query('COMMIT');
    console.log('Migration committed successfully');
  } catch (err) {
    console.error('Error during migration, rolling back:', err.message || err);
    await client.query('ROLLBACK');
  } finally {
    db.close();
    await client.end();
    console.log('Connections closed');
  }
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
