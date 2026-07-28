#!/usr/bin/env node
/**
 * Make a fresh Cloudflare account deployable without hand-editing wrangler.toml.
 *
 * Path A (Deploy button / Workers Builds) and Path B (CLI) both used to fail when
 * D1/KV ids were still the OSS placeholders (`0000…`) — the button does not rewrite
 * them under Workers Builds. This script creates missing resources and patches
 * wrangler.toml in place, then aligns SHAREOUT_BASE_URL and SESSION_SECRET.
 *
 * Idempotent: real ids / existing secrets / a non-placeholder BASE_URL are left alone.
 * Requires `npx wrangler` auth (wrangler login or CLOUDFLARE_API_TOKEN).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = join(appDir, 'wrangler.toml');

const PLACEHOLDER_D1 = /^00000000-0000-0000-0000-00000000000/i;
const PLACEHOLDER_BASE = /^https:\/\/shareout\.workers\.dev\/?$/i;

function isPlaceholderKv(id) {
  return /^0{30}/.test(id);
}

function run(args, { allowFail = false } = {}) {
  try {
    return execFileSync('npx', ['wrangler', ...args], {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFail) return String(err.stdout || '') + String(err.stderr || '');
    const msg = String(err.stderr || err.stdout || err.message);
    throw new Error(`wrangler ${args.join(' ')} failed:\n${msg}`);
  }
}

function readToml() {
  return readFileSync(tomlPath, 'utf8');
}

function writeToml(text) {
  writeFileSync(tomlPath, text);
}

function workerName(toml) {
  const m = toml.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return m?.[1] || 'shareout';
}

function databaseName(toml) {
  const m = toml.match(/database_name\s*=\s*"([^"]+)"/);
  return m?.[1] || 'shareout-db';
}

function bucketName(toml) {
  const m = toml.match(/bucket_name\s*=\s*"([^"]+)"/);
  return m?.[1] || 'shareout-artifacts';
}

function createD1(name) {
  const out = run(['d1', 'create', name]);
  const m = out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i) || out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) throw new Error(`Could not parse D1 id from:\n${out}`);
  return m[1];
}

function createKv(title) {
  const out = run(['kv', 'namespace', 'create', title]);
  const m = out.match(/id\s*=\s*"([0-9a-f]{32})"/i) || out.match(/\b([0-9a-f]{32})\b/i);
  if (!m) throw new Error(`Could not parse KV id from:\n${out}`);
  return m[1];
}

function ensureR2(name) {
  const out = run(['r2', 'bucket', 'create', name], { allowFail: true });
  if (/Created bucket|already exists|403|409|Bucket already/i.test(out) || !/ERROR|✘/.test(out)) {
    return;
  }
  // "already exists" variants differ by wrangler version — treat non-fatal.
  if (/exist/i.test(out)) return;
  console.warn(`provision:cf: r2 create warning:\n${out}`);
}

function patchDatabaseId(toml, id) {
  return toml.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${id}"`);
}

function patchKvIds(toml, idsByBinding) {
  // Replace each [[kv_namespaces]] block's id when the binding matches.
  return toml.replace(
    /\[\[kv_namespaces\]\]\s*\nbinding\s*=\s*"([^"]+)"\s*\nid\s*=\s*"([^"]+)"/g,
    (full, binding, id) => {
      const next = idsByBinding[binding];
      if (!next || !isPlaceholderKv(id)) return full;
      return `[[kv_namespaces]]\nbinding = "${binding}"\nid = "${next}"`;
    },
  );
}

function patchBaseUrl(toml, origin) {
  if (!/SHAREOUT_BASE_URL\s*=/.test(toml)) {
    return toml.replace(/\[vars\]\n/, `[vars]\nSHAREOUT_BASE_URL = "${origin}"\n`);
  }
  return toml.replace(/SHAREOUT_BASE_URL\s*=\s*"[^"]*"/, `SHAREOUT_BASE_URL = "${origin}"`);
}

function oauthToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const p = join(homedir(), 'Library/Preferences/.wrangler/config/default.toml');
  // Linux/mac alternate
  const alts = [
    p,
    join(homedir(), '.config/.wrangler/config/default.toml'),
    join(homedir(), '.wrangler/config/default.toml'),
  ];
  for (const path of alts) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const m = text.match(/oauth_token\s*=\s*"([^"]+)"/) || text.match(/api_token\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return null;
}

async function workersSubdomain(accountId, token) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!body?.success) return null;
  return body.result?.subdomain || null;
}

function accountIdFromWhoami() {
  const out = run(['whoami']);
  const m = out.match(/Account ID\s*[│|]\s*([a-f0-9]{32})/i) || out.match(/\b([a-f0-9]{32})\b/);
  return process.env.CLOUDFLARE_ACCOUNT_ID || m?.[1] || null;
}

function secretExists(name) {
  const out = run(['secret', 'list', '--name', name], { allowFail: true });
  try {
    const parsed = JSON.parse(out.trim().startsWith('[') ? out : '[]');
    if (Array.isArray(parsed)) return parsed.some((s) => s?.name === 'SESSION_SECRET');
  } catch {
    /* fall through */
  }
  return /SESSION_SECRET/.test(out);
}

function ensureSessionSecret(name) {
  if (secretExists(name)) {
    console.log('provision:cf: SESSION_SECRET already set');
    return;
  }
  const value = randomBytes(32).toString('hex');
  execFileSync('npx', ['wrangler', 'secret', 'put', 'SESSION_SECRET', '--name', name], {
    cwd: appDir,
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('provision:cf: created SESSION_SECRET');
}

async function main() {
  let toml = readToml();
  let changed = false;
  const name = workerName(toml);

  // D1
  const d1Match = toml.match(/database_id\s*=\s*"([^"]+)"/);
  if (d1Match && PLACEHOLDER_D1.test(d1Match[1])) {
    const dbName = databaseName(toml);
    console.log(`provision:cf: creating D1 ${dbName}`);
    const id = createD1(dbName);
    toml = patchDatabaseId(toml, id);
    changed = true;
    console.log(`provision:cf: D1 id ${id}`);
  }

  // R2 (name-based; create if missing)
  const bucket = bucketName(toml);
  console.log(`provision:cf: ensuring R2 ${bucket}`);
  ensureR2(bucket);

  // KV placeholders
  const kvBlocks = [...toml.matchAll(/\[\[kv_namespaces\]\]\s*\nbinding\s*=\s*"([^"]+)"\s*\nid\s*=\s*"([^"]+)"/g)];
  const idsByBinding = {};
  for (const [, binding, id] of kvBlocks) {
    if (!isPlaceholderKv(id)) continue;
    const title = `${name}-${binding}`;
    console.log(`provision:cf: creating KV ${title}`);
    idsByBinding[binding] = createKv(title);
  }
  if (Object.keys(idsByBinding).length) {
    toml = patchKvIds(toml, idsByBinding);
    changed = true;
  }

  // SHAREOUT_BASE_URL from workers.dev subdomain when still the template placeholder
  const baseMatch = toml.match(/SHAREOUT_BASE_URL\s*=\s*"([^"]*)"/);
  if (!baseMatch || PLACEHOLDER_BASE.test(baseMatch[1])) {
    try {
      const token = oauthToken();
      const accountId = accountIdFromWhoami();
      if (token && accountId) {
        const sub = await workersSubdomain(accountId, token);
        if (sub) {
          const origin = `https://${name}.${sub}.workers.dev`;
          toml = patchBaseUrl(toml, origin);
          changed = true;
          console.log(`provision:cf: SHAREOUT_BASE_URL → ${origin}`);
        }
      }
    } catch (err) {
      console.warn(`provision:cf: could not set SHAREOUT_BASE_URL (${err.message})`);
    }
  }

  if (changed) {
    writeToml(toml);
    console.log('provision:cf: updated wrangler.toml');
  } else {
    console.log('provision:cf: wrangler.toml bindings already provisioned');
  }

  ensureSessionSecret(name);
  console.log('provision:cf: done');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
