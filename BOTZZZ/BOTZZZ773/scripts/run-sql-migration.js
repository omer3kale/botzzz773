#!/usr/bin/env node
/**
 * Simple SQL migration runner using pg.
 * Usage: node scripts/run-sql-migration.js <path-to-sql>
 * Requires env var SUPABASE_DB_URL or DATABASE_URL.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const sqlPath = process.argv[2];
  if (!sqlPath) {
    console.error('ERROR: Provide a SQL file path.');
    process.exit(1);
  }
  const absolutePath = path.resolve(sqlPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`ERROR: SQL file not found: ${absolutePath}`);
    process.exit(1);
  }

  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: Set SUPABASE_DB_URL or DATABASE_URL env var to your staging connection string.');
    process.exit(1);
  }

  const sql = fs.readFileSync(absolutePath, 'utf8');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  console.log(`Running migration: ${absolutePath}`);
  try {
    await client.connect();
    await client.query(sql);
    console.log('Migration executed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
