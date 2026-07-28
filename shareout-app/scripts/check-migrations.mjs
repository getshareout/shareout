#!/usr/bin/env node
// Guards the D1 migration directory. Two jobs:
//
//   1. Numbering — Wrangler applies migrations in filename order and records applied
//      ones by exact filename, so a duplicate prefix rots the convention and renaming
//      an applied file makes Wrangler re-run it against production.
//   2. Conventions — new tables should match the schema they are joining. The rules
//      are documented in migrations/CONVENTIONS.md; this enforces the mechanical ones.
//
//   3. Ownership — every table prefix names a module that owns it, and every table is
//      documented in SCHEMA.md. A table nobody documented is worse than no table: it
//      implies a feature that does not exist.
//
// 0000_init.sql is checked in full, like every other migration. It used to be exempt
// while the redesign in migrations/REDESIGN.md was in flight; that finished, and the
// exemption came off with it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(root, 'migrations');
const INIT = '0000_init.sql';

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const errors = [];

/**
 * Table bodies, found by scanning to the balanced closing paren rather than to a
 * `\n);` line. Tables whose last column and closing paren share a line — the
 * ALTER-accreted ones — are invisible to the line-based version, and a non-greedy
 * match runs past them and swallows the tables that follow. That hid 15 tables from
 * every rule below until PR-10.
 */
function tableBodies(sql) {
  const out = [];
  const re = /CREATE TABLE(?: IF NOT EXISTS)? ["`]?([a-z0-9_]+)["`]?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
    }
    out.push({ name: m[1], body: sql.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

/** Column declarations, split on top-level commas — columns added by ALTER share a line. */
function splitColumns(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ---- 1. numbering ----------------------------------------------------------
const byPrefix = new Map();
for (const f of files) {
  const m = f.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
  if (!m) {
    errors.push(`${f}: name must be NNNN_lower_snake_case.sql`);
    continue;
  }
  const prefix = m[1];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(f);

  if (f !== INIT && prefix === '0000') {
    errors.push(`${f}: prefix 0000 is reserved for ${INIT}`);
  }
}

for (const [prefix, group] of byPrefix) {
  if (group.length > 1) {
    errors.push(`duplicate prefix ${prefix}: ${group.join(', ')} — renumber to the next free prefix`);
  }
}

// ---- 2. conventions on newly created tables --------------------------------
// See migrations/CONVENTIONS.md. Only the mechanically checkable rules live here;
// judgement calls (does this need an index? should this cascade?) stay with review.
const TIMESTAMP_COLUMN = /^[a-z0-9_]*(_at|_date)$/;

// A row records when it happened. Usually that is `created_at`; sometimes the domain has
// a better word for the same moment, and forcing `created_at` alongside it would just add
// a second timestamp nobody reads. Either satisfies the rule; neither does not.
const RECORDS_A_MOMENT = /\b([a-z0-9_]*_at|[a-z0-9_]*_date|date|period|hour|window_start)\b/;

for (const f of files) {
  const stripped = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '');

  for (const { name, body } of tableBodies(stripped)) {
    // Table rebuilds use a scratch table then rename; those are not new tables.
    if (/_new$|_backup$|_old$|^_/.test(name)) continue;

    const where = `${f}: table ${name}`;
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      errors.push(`${where}: table names must be lower_snake_case`);
    }
    if (!RECORDS_A_MOMENT.test(body)) {
      errors.push(`${where}: needs created_at, or the domain moment that replaces it (see CONVENTIONS.md)`);
    }

    for (const decl of splitColumns(body)) {
      const col = decl.match(/^["`]?([a-z0-9_]+)["`]?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i);
      if (!col) continue;
      const [, colName, type] = col;
      if (!/^[a-z][a-z0-9_]*$/.test(colName)) {
        errors.push(`${where}.${colName}: columns must be lower_snake_case`);
      }
      if (TIMESTAMP_COLUMN.test(colName) && type.toUpperCase() !== 'TEXT') {
        errors.push(
          `${where}.${colName}: timestamps are TEXT holding strftime('%Y-%m-%dT%H:%M:%fZ','now'), not ${type}`,
        );
      }
      if (/^(is_|has_)/.test(colName) && type.toUpperCase() !== 'INTEGER') {
        errors.push(`${where}.${colName}: booleans are INTEGER 0/1, not ${type}`);
      }
    }
  }

  for (const [, indexName] of stripped.matchAll(
    /CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? ["`]?([a-z0-9_]+)["`]?/gi,
  )) {
    if (!/^(idx|ux)_/.test(indexName)) {
      errors.push(`${f}: index ${indexName} must be prefixed idx_ (or ux_ if UNIQUE)`);
    }
  }
}

// ---- 3. ownership: every prefix has a module, every table has documentation --------
// The point is not the string in this map — it is that adding a
// table forces you to say which module owns it, and to write it down in SCHEMA.md.
// A prefix that maps to a directory that no longer exists fails too, which is how a
// module rename gets noticed here instead of in a year.
const TABLE_OWNERS = {
  abuse: 'src/moderation', access: 'src/access', admin: 'src/api-auth.ts', agent: 'src/data/agent',
  ai: 'src/data/agent', analytics: 'src/analytics.ts', artifact: 'src/artifacts', artifacts: 'src/artifacts',
  asset: 'src/assets', assets: 'src/assets', audit: 'src/audit.ts', blob: 'src/data/blobs', blobs: 'src/data/blobs',
  catalog: 'src/catalog', collaborators: 'src/artifacts', comment: 'src/realtime', connection: 'src/data/connections',
  connections: 'src/data/connections', crew: 'src/crew', crews: 'src/crew', datasets: 'src/data/datasets',
  deployments: 'src/publish', device: 'src/auth', editor: 'src/editor', email: 'src/email', favorites: 'src/artifacts',
  file: 'src/assets', folders: 'src/folders.ts', funnel: 'src/analytics.ts', google: 'src/data/sheets',
  grants: 'src/access', health: 'src/observability', home: 'src/pages/home', job: 'src/scheduling',
  knowledge: 'src/knowledge', library: 'src/skill-marketplace.ts', messaging: 'src/chat-platforms',
  metric: 'src/metric-alerts', notifications: 'src/pages/home', onboarding: 'src/onboarding',
  ops: 'src/observability', plan: 'src/crew', platform: 'src/config', presentation: 'src/present',
  presentations: 'src/present', rate: 'src/api-auth.ts', scheduled: 'src/scheduling', secret: 'src/data/secrets',
  share: 'src/present', sharee: 'src/sharees', sharees: 'src/sharees', sheet: 'src/data/sheets',
  sheets: 'src/data/sheets', skill: 'src/skill-marketplace.ts', slide: 'src/present', slides: 'src/present',
  ticket: 'src/support', tickets: 'src/support', tokens: 'src/api-auth.ts', upload: 'src/data/datasets',
  user: 'src/users', users: 'src/users', versions: 'src/publish', view: 'src/analytics.ts',
  viewer: 'src/viewers', webhook: 'src/observability', workspace: 'src/workspaces', workspaces: 'src/workspaces',
};

{
  const initSql = readFileSync(join(MIGRATIONS, INIT), 'utf8').replace(/--[^\n]*/g, '');
  const schemaDoc = readFileSync(join(MIGRATIONS, 'SCHEMA.md'), 'utf8');
  for (const { name: table } of tableBodies(initSql)) {
    const prefix = table.split('_')[0];
    const owner = TABLE_OWNERS[prefix];
    if (!owner) {
      errors.push(`${INIT}: table ${table} — prefix "${prefix}" has no owning module in TABLE_OWNERS (scripts/check-migrations.mjs)`);
    } else if (!existsSync(join(root, owner))) {
      errors.push(`${INIT}: table ${table} — owner ${owner} does not exist; update TABLE_OWNERS`);
    }
    if (!schemaDoc.includes(`\`${table}\``)) {
      errors.push(`${INIT}: table ${table} is not documented in SCHEMA.md`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\nMigration check failed — ${errors.length} problem(s). See migrations/CONVENTIONS.md.`);
  process.exit(1);
}
console.log(`Migrations OK — ${files.length} file(s), numbering and conventions clean.`);
