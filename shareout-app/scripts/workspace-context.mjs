#!/usr/bin/env node
/**
 * Manage a workspace's agent context files (house style / voice / conventions).
 * These are markdown files an agent pulls when working in the workspace.
 * Writes require workspace owner/admin; reads require membership.
 *
 * Auth: --token <so_...> or env SHAREOUT_API_TOKEN.
 * Base: --base <url> (default https://shareout.site).
 *
 * Usage:
 *   workspace-context.mjs list    <workspaceId>
 *   workspace-context.mjs get     <workspaceId> <name.md>
 *   workspace-context.mjs put     <workspaceId> <name.md> <localFile>
 *   workspace-context.mjs put-dir <workspaceId> <dir>          # pushes every *.md
 *   workspace-context.mjs delete  <workspaceId> <name.md>
 *   workspace-context.mjs entry   <workspaceId> [name.md]      # get/set the entry point
 *   workspace-context.mjs skill   <workspaceSlugOrId> [out.zip]  # skill zip + ws context
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

const token = flag('--token', process.env.SHAREOUT_API_TOKEN);
const base = (flag('--base', process.env.SHAREOUT_BASE_URL) || 'https://shareout.site').replace(/\/$/, '');
const [cmd, ...rest] = args;

if (!cmd) {
  console.error(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(2, 21).join('\n').replace(/^ \*/gm, ''));
  process.exit(1);
}
if (!token && cmd !== 'help') {
  console.error('Missing token: pass --token <so_...> or set SHAREOUT_API_TOKEN');
  process.exit(1);
}

async function api(method, path, { body, contentType } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return { status: res.status, text };
}

async function main() {
  if (cmd === 'list') {
    const [ws] = rest;
    const { text } = await api('GET', `/v1/workspaces/${ws}/context`);
    const { files } = JSON.parse(text);
    if (!files.length) return console.log('(no context files)');
    for (const f of files) console.log(`${f.name}\t${f.size}B\tupdated ${f.updated_at}`);
    return;
  }

  if (cmd === 'get') {
    const [ws, name] = rest;
    const { text } = await api('GET', `/v1/workspaces/${ws}/context/${name}`);
    process.stdout.write(text);
    return;
  }

  if (cmd === 'put') {
    const [ws, name, file] = rest;
    const content = readFileSync(file, 'utf8');
    const { text } = await api('PUT', `/v1/workspaces/${ws}/context/${name}`, {
      body: content,
      contentType: 'text/markdown',
    });
    console.log(text);
    return;
  }

  if (cmd === 'put-dir') {
    const [ws, dir] = rest;
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile());
    if (!files.length) return console.log('No .md files found in', dir);
    for (const f of files) {
      const name = basename(f).toLowerCase();
      const content = readFileSync(join(dir, f), 'utf8');
      const { text } = await api('PUT', `/v1/workspaces/${ws}/context/${name}`, {
        body: content,
        contentType: 'text/markdown',
      });
      console.log(`✓ ${name}: ${text}`);
    }
    return;
  }

  if (cmd === 'delete') {
    const [ws, name] = rest;
    const { text } = await api('DELETE', `/v1/workspaces/${ws}/context/${name}`);
    console.log(text);
    return;
  }

  if (cmd === 'entry') {
    const [ws, name] = rest;
    if (name === undefined) {
      const { text } = await api('GET', `/v1/workspaces/${ws}/context`);
      console.log('entry:', JSON.parse(text).entry);
    } else {
      const { text } = await api('PUT', `/v1/workspaces/${ws}/context`, {
        body: JSON.stringify({ entry: name === 'null' ? null : name }),
        contentType: 'application/json',
      });
      console.log(text);
    }
    return;
  }

  if (cmd === 'skill') {
    const [ws, outPath] = rest;
    const res = await fetch(`${base}/v1/skill?workspace=${encodeURIComponent(ws)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      process.stderr.write(bytes.toString('utf8'));
      process.exit(1);
    }
    if (outPath) {
      writeFileSync(outPath, bytes);
      console.log(`Wrote ${bytes.length} bytes → ${outPath}`);
    } else {
      process.stdout.write(bytes);
    }
    return;
  }

  console.error('Unknown command:', cmd);
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
