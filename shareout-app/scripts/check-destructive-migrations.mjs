#!/usr/bin/env node
// Refuses to deploy when a migration that has not yet run against production would
// destroy data, unless someone says out loud that they meant it.
//
// `npm run deploy` is `db:migrations:apply --remote && wrangler deploy`, so a
// DROP TABLE sitting in migrations/ reaches a live instance the moment anyone deploys —
// possibly someone who never read the migration. This repo has already merged a
// nine-DROP-TABLE migration with none of its documented pre-checks run: a comment in a
// markdown file did not stop it, this does.
//
// Fires only on migrations Wrangler reports as PENDING, so it goes quiet again once a
// destructive migration has been applied. It is a gate, not a permanent nag — a check
// that cries wolf on every deploy gets deleted within a week.
//
// To proceed deliberately:
//   SHAREOUT_CONFIRM_DESTRUCTIVE=1 npm run deploy
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(root, 'migrations');

// Statements that can lose data. DROP INDEX and DROP TRIGGER are deliberately absent:
// they discard derived structure, not rows, and both are cheap to recreate.
const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
  [/\bUPDATE\s+\w+\s+SET\b/i, 'UPDATE … SET'],
];

// Strip comments before scanning, so prose describing a DROP does not trip the guard.
const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

function pendingMigrations() {
  let out;
  try {
    out = execFileSync(
      'npx',
      ['wrangler', 'd1', 'migrations', 'list', 'DB', '--remote'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const detail = `${err.stdout || ''}${err.stderr || ''}`.trim();
    // Fail closed. `deploy` needs remote D1 access two commands later anyway, so a
    // failure here is a real problem, not a reason to wave the deploy through.
    console.error('✗ Could not list pending migrations against the remote database.\n');
    if (/7404|could not be found/i.test(detail)) {
      console.error(
        "  The configured database_id does not exist (OSS ships a placeholder).\n"
        + '  Run `npm run provision:cf` first (or `npm run deploy`, which provisions then checks).\n',
      );
    } else if (detail) {
      console.error(`${detail.split('\n').map((l) => `  ${l}`).join('\n')}\n`);
    }
    process.exit(1);
  }
  // Wrangler prints a table; pull migration filenames out of it rather than parsing
  // the box drawing, which changes between versions.
  const names = new Set(out.match(/\d{4}_[a-z0-9_]+\.sql/g) || []);
  const known = new Set(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')));
  return [...names].filter((n) => known.has(n)).sort();
}

const pending = pendingMigrations();

if (pending.length === 0) {
  console.log('No pending migrations — nothing to check.');
  process.exit(0);
}

const findings = [];
for (const file of pending) {
  const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
  const hits = DESTRUCTIVE.filter(([re]) => re.test(sql)).map(([, label]) => label);
  if (hits.length) findings.push({ file, hits: [...new Set(hits)] });
}

if (findings.length === 0) {
  console.log(`${pending.length} pending migration(s), none destructive:`);
  for (const f of pending) console.log(`  · ${f}`);
  process.exit(0);
}

if (process.env.SHAREOUT_CONFIRM_DESTRUCTIVE === '1') {
  console.log('⚠ Destructive migrations pending, proceeding on SHAREOUT_CONFIRM_DESTRUCTIVE=1:');
  for (const { file, hits } of findings) console.log(`  · ${file} — ${hits.join(', ')}`);
  process.exit(0);
}

console.error('\n✗ Refusing to deploy: pending migrations would destroy data.\n');
for (const { file, hits } of findings) {
  console.error(`  ${file}`);
  for (const h of hits) console.error(`    ${h}`);
}
console.error(`
These have NOT run against the remote database yet. \`npm run deploy\` applies them
before it deploys, so this is your last chance to look.

  1. Back up:
       wrangler d1 export DB --remote --output pre-deploy-backup.sql

  2. Check what the destructive statements actually touch — if a table is about to be
     dropped, count its rows first. "It should be empty" is not the same as empty.

  3. Then deploy deliberately:
       SHAREOUT_CONFIRM_DESTRUCTIVE=1 npm run deploy

See migrations/CONVENTIONS.md § "Destructive migrations".
`);
process.exit(1);
