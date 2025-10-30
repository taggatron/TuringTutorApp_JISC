#!/usr/bin/env node
import pkg from 'pg';
const { Client } = pkg;

const TABLES = [
  'app_user',
  'session',
  'message',
  'feedback',
  'scale_level',
  'groups'
];

async function check() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log('Connected to:', process.env.DATABASE_URL || '(no DATABASE_URL)');

    // show current role and any session GUC if set
    const cr = await client.query("SELECT current_role AS role, current_setting('app.current_user_id', true) AS current_user_id");
    console.log('Current role & app.current_user_id:', cr.rows[0]);

    for (const tbl of TABLES) {
      console.log('\n== ' + tbl + ' ==');
      const rs = await client.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`, [tbl]);
      if (rs.rows.length === 0) {
        console.log('  table not found in pg_class (maybe not created)');
        continue;
      }
      console.log('  relrowsecurity:', rs.rows[0].relrowsecurity, 'relforcerowsecurity:', rs.rows[0].relforcerowsecurity);

      // list policies for the table
      const pol = await client.query(
        `SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS with_check_expr
         FROM pg_policy
         WHERE polrelid = (SELECT oid FROM pg_class WHERE relname = $1)
         ORDER BY polname`,
        [tbl]
      );

      if (pol.rows.length === 0) {
        console.log('  NO policies found for this table (RLS enabled but no policies will deny access)');
      } else {
        for (const p of pol.rows) {
          console.log(`  policy: ${p.polname}  cmd=${p.polcmd}  using=${p.using_expr}  with_check=${p.with_check_expr}`);
        }
      }
    }

    console.log('\nCheck complete');
  } catch (err) {
    console.error('ERROR during check:', err);
    process.exitCode = 2;
  } finally {
    await client.end();
  }
}

check();
