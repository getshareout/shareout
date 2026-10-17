#!/usr/bin/env node
// Provision a customer workspace from a spec file:
//
//   SHAREOUT_ORIGIN=https://shareout.example.com SHAREOUT_ADMIN_TOKEN=so_... \
//     node scripts/provision-workspace.mjs scripts/provision-workspace.example.yaml
//
// Calls POST /v1/admin/workspaces/provision with an instance admin's personal token
// (`so_`; workspace Agent `sot_` tokens are refused). The spec is JSON or YAML. Two
// conveniences are resolved here, before sending:
//   - `${NAME}` in any string is replaced by the environment variable NAME, so
//     connector credentials stay out of the spec file. A missing variable is an error.
//   - `branding.logo_file` (path relative to the spec) is read and sent as base64.
// Safe to re-run: the endpoint is idempotent by slug. Exit 0 = done, 2 = some step
// failed (see the summary; fix and re-run), 1 = refused or unreachable.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: node scripts/provision-workspace.mjs <spec.json|spec.yaml> [--origin URL] [--token so_...]');
  console.error('       env: SHAREOUT_ORIGIN, SHAREOUT_ADMIN_TOKEN (or ~/.shareout/credentials {"token": ...})');
  process.exit(1);
}

function args(argv) {
  const out = { file: null, origin: process.env.SHAREOUT_ORIGIN || '', token: process.env.SHAREOUT_ADMIN_TOKEN || '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--origin') out.origin = argv[++i] || '';
    else if (a === '--token') out.token = argv[++i] || '';
    else if (a === '-h' || a === '--help') usage();
    else if (!out.file) out.file = a;
    else usage(`unexpected argument ${a}`);
  }
  return out;
}

function savedToken() {
  const p = join(homedir(), '.shareout', 'credentials');
  if (!existsSync(p)) return '';
  try { return JSON.parse(readFileSync(p, 'utf8')).token || ''; } catch { return ''; }
}

/** Replace `${NAME}` with process.env.NAME everywhere in the spec. */
export function interpolateEnv(value, env = process.env, path = 'spec') {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
      if (env[name] === undefined) throw new Error(`${path} references \${${name}}, which is not set`);
      return env[name];
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => interpolateEnv(v, env, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, env, `${path}.${k}`)]));
  }
  return value;
}

/** Turn `branding.logo_file` into `branding.logo: { data_base64, content_type }`. */
export function inlineLogo(spec, baseDir) {
  const file = spec.branding?.logo_file;
  if (!file) return spec;
  const path = resolve(baseDir, file);
  const type = LOGO_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`branding.logo_file must be .png, .jpg, .webp or .svg (got ${file})`);
  const { logo_file: _drop, ...branding } = spec.branding;
  return { ...spec, branding: { ...branding, logo: { data_base64: readFileSync(path).toString('base64'), content_type: type } } };
}

export function loadSpec(file, env = process.env) {
  const text = readFileSync(file, 'utf8');
  const raw = /\.ya?ml$/i.test(file) ? parseYaml(text) : JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('spec must be an object');
  return inlineLogo(interpolateEnv(raw, env), dirname(resolve(file)));
}

function printSummary(status, s) {
  const mark = { created: '+', updated: '~', unchanged: '=', skipped: '-', pending: '…', failed: '✗' };
  console.log(`${s.created ? 'Created' : 'Updated'} ${s.workspace.name} (${s.workspace.slug}) — HTTP ${status}, ${s.duration_ms} ms`);
  console.log(`  home:      ${s.links.home}`);
  if (s.links.subdomain) console.log(`  subdomain: ${s.links.subdomain}`);
  console.log('Steps');
  for (const st of s.steps) console.log(`  ${mark[st.status] || '?'} ${st.step}: ${st.status}${st.error ? ` — ${st.error}` : ''}`);
  console.log('Admins');
  for (const a of s.admins) {
    console.log(`  ${a.email} (${a.role}): ${a.status}${a.email_sent === false ? ' — email not sent' : ''}${a.error ? ` — ${a.error}` : ''}`);
  }
  console.log('Next steps');
  for (const n of s.next_steps) console.log(`  - ${n}`);
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (!opts.file) usage('spec file is required');
  if (!opts.origin) usage('set SHAREOUT_ORIGIN or pass --origin');
  const token = opts.token || savedToken();
  if (!token) usage('set SHAREOUT_ADMIN_TOKEN, pass --token, or log in so ~/.shareout/credentials exists');

  let spec;
  try {
    spec = loadSpec(opts.file);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }

  const url = `${opts.origin.replace(/\/$/, '')}/v1/admin/workspaces/provision`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    });
  } catch (err) {
    console.error(`error: could not reach ${url}: ${err.message}`);
    process.exit(1);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.workspace) {
    console.error(`error: HTTP ${res.status} ${body?.code || ''} — ${body?.error || 'unexpected response'}`);
    if (body?.param) console.error(`  field: ${body.param}`);
    if (body?.hint) console.error(`  hint:  ${body.hint}`);
    if (body?.request_id) console.error(`  request_id: ${body.request_id}`);
    process.exit(1);
  }
  printSummary(res.status, body);
  process.exit(res.status === 207 ? 2 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
