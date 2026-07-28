#!/usr/bin/env node
/**
 * One-shot prune: delete every R2 object under skill/<PREFIX_TO_PRUNE>/.
 * Used to remove the accidentally-synced shareout-app/* internal
 * docs (which contained customer + super-admin mentions) from the
 * served skill. The normal sync uploads but never prunes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'shareout-artifacts';
const PRUNE_PREFIX = 'skill/shareout-app/';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ACCOUNT_ID) { console.error('CLOUDFLARE_ACCOUNT_ID is required'); process.exit(1); }
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.cloudfare_token;
if (!TOKEN) { console.error('No Cloudflare token'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}`;
const headers = { Authorization: `Bearer ${TOKEN}` };
const encKey = (k) => k.split('/').map(encodeURIComponent).join('/');

let cursor = '';
let total = 0, deleted = 0, failed = 0;
do {
  const url = `${base}/objects?prefix=${encodeURIComponent(PRUNE_PREFIX)}&per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const res = await fetch(url, { headers });
  const json = await res.json();
  if (!json.success) { console.error('list failed', JSON.stringify(json.errors)); process.exit(1); }
  const objs = json.result || [];
  cursor = json.result_info?.cursor || '';
  for (const o of objs) {
    total++;
    if (DRY_RUN) { if (total <= 5) console.log('  would delete:', o.key); continue; }
    const d = await fetch(`${base}/objects/${encKey(o.key)}`, { method: 'DELETE', headers });
    if (d.ok) { deleted++; } else { failed++; console.error('del fail', o.key, d.status); }
  }
  if (!DRY_RUN) process.stdout.write(`\r  scanned ${total}, deleted ${deleted}, failed ${failed}`);
} while (cursor);

console.log(DRY_RUN
  ? `\nDRY RUN: ${total} objects under ${PRUNE_PREFIX} would be deleted (showing first 5 above)`
  : `\nDone: ${deleted} deleted, ${failed} failed under ${PRUNE_PREFIX}`);
