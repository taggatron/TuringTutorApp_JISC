#!/usr/bin/env node
import pkg from 'pg';
import crypto from 'crypto';
const { Client } = pkg;

// Simple RLS test script that creates two users+sessions inside a transaction,
// verifies that setting app.current_user_id limits visible rows to the owner,
// then verifies that SET ROLE app_admin sees all rows, and finally rolls back.

async function run() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('ERROR: DATABASE_URL environment variable is not set. Set it to your Postgres connection string, e.g. postgresql://user:pass@host:port/dbname');
    process.exit(2);
  }
  // print a masked form of the connection string for debugging (hide credentials)
  try {
    const masked = conn.replace(/:\/\/(.*?):(.*?)@/, '//<user>:<pw>@');
    console.log('Using DATABASE_URL:', masked);
  } catch (e) { /* ignore */ }

  const client = new Client({ connectionString: conn });
  await client.connect();
  try {
    await client.query('BEGIN');

    const userA = 'rls_user_a_' + crypto.randomBytes(4).toString('hex');
    const userB = 'rls_user_b_' + crypto.randomBytes(4).toString('hex');

    const r1 = await client.query('INSERT INTO app_user (username, password_hash) VALUES ($1, $2) RETURNING id', [userA, 'x']);
    const id1 = r1.rows[0].id;
    const r2 = await client.query('INSERT INTO app_user (username, password_hash) VALUES ($1, $2) RETURNING id', [userB, 'x']);
    const id2 = r2.rows[0].id;

  const s1 = await client.query('INSERT INTO session (user_id, session_name) VALUES ($1,$2) RETURNING id', [id1, 'testsession1']);
    const sid1 = s1.rows[0].id;
  const s2 = await client.query('INSERT INTO session (user_id, session_name) VALUES ($1,$2) RETURNING id', [id2, 'testsession2']);
    const sid2 = s2.rows[0].id;

    // Set app.current_user_id to id1 and verify we only see userA's session
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(id1)]);
  const currentSetting = await client.query("SELECT current_setting('app.current_user_id', true) AS val");
  const currentRole = await client.query('SELECT current_role AS role');
  console.log('DEBUG current_setting:', currentSetting.rows[0]);
  console.log('DEBUG current_role:', currentRole.rows[0]);
  const visibleForA = await client.query('SELECT id, user_id FROM session ORDER BY id');
    if (visibleForA.rows.length !== 1 || visibleForA.rows[0].user_id !== id1) {
      throw new Error('RLS failed: regular user saw unexpected rows: ' + JSON.stringify(visibleForA.rows));
    }
    console.log('PASS: regular user sees only own rows');

    // Now set role to app_admin and ensure all rows visible
    await client.query('SET ROLE app_admin');
    const allRows = await client.query('SELECT id, user_id FROM session ORDER BY id');
    if (allRows.rows.length < 2) {
      throw new Error('RLS failed: app_admin did not see all rows: ' + JSON.stringify(allRows.rows));
    }
    console.log('PASS: app_admin sees all rows');

    // Reset role and rollback to leave DB unchanged
    await client.query('RESET ROLE');
    await client.query('ROLLBACK');
    console.log('Test completed and rolled back successfully');
  } catch (err) {
    console.error('TEST FAILED:', err);
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    process.exitCode = 2;
  } finally {
    await client.end();
  }
}

run();
