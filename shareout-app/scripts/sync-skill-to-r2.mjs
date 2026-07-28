#!/usr/bin/env node
/**
 * Sync skills/ShareOutSkill/ directory to R2 bucket under skill/ prefix.
 *
 * Usage:
 *   npm run sync:skill              # upload all files (parallel)
 *   npm run sync:skill -- --changed # only files changed in last commit / push
 *   npm run sync:skill -- --concurrency=30
 *
 * Reads CLOUDFLARE_API_TOKEN from .env (cloudfare_token) or env var.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { zipSync } from 'fflate';

const BUCKET = 'shareout-artifacts';
const R2_PREFIX = 'skill';
const DEFAULT_CONCURRENCY = 20;

function loadEnv() {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dir, '..', '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  if (process.env.cloudfare_token && !process.env.CLOUDFLARE_API_TOKEN) {
    process.env.CLOUDFLARE_API_TOKEN = process.env.cloudfare_token;
  }
}

loadEnv();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ACCOUNT_ID) {
  console.error('CLOUDFLARE_ACCOUNT_ID is required (set in env or shareout-app/.env)');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILL_DIR = join(ROOT, '..', 'skills', 'ShareOutSkill');

function parseArgs(argv) {
  let changedOnly = false;
  let concurrency = DEFAULT_CONCURRENCY;

  for (const arg of argv) {
    if (arg === '--changed') changedOnly = true;
    else if (arg.startsWith('--concurrency=')) {
      concurrency = Math.max(1, Number.parseInt(arg.slice('--concurrency='.length), 10) || DEFAULT_CONCURRENCY);
    }
  }

  return { changedOnly, concurrency };
}

function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, files);
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function gitDiffNames(from, to) {
  const range = to ? `${from} ${to}` : from;
  const out = execSync(`git diff --name-only ${range} -- skills/ShareOutSkill/`, {
    cwd: join(ROOT, '..'),
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'));
}

function getChangedRelPaths() {
  const before = process.env.GITHUB_EVENT_BEFORE;
  const after = process.env.GITHUB_SHA;

  if (before && after && before !== '0'.repeat(40)) {
    return gitDiffNames(before, after);
  }

  try {
    return gitDiffNames('HEAD~1', 'HEAD');
  } catch {
    return gitDiffNames('HEAD', '');
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const meta = {};
  for (const line of yaml.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      let value = rest.join(':').trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      meta[key.trim()] = value;
    }
  }
  return meta;
}

async function uploadObject(r2Key, body, contentType) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN is not set');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeR2Key(r2Key)}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body,
    });

    if (res.ok) return true;

    const retryable = res.status >= 500 || res.status === 429;
    if (retryable && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
      continue;
    }

    const text = await res.text().catch(() => '');
    throw new Error(`upload failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return false;
}

function encodeR2Key(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function main() {
  const { changedOnly, concurrency } = parseArgs(process.argv.slice(2));

  if (!existsSync(SKILL_DIR)) {
    console.error(`ShareOutSkill directory not found: ${SKILL_DIR}`);
    process.exit(1);
  }

  const mode = changedOnly ? 'changed files' : 'all files';
  console.log(`Syncing ${SKILL_DIR} → R2 ${BUCKET}/${R2_PREFIX}/ (${mode}, concurrency ${concurrency})`);

  let files = walkDir(SKILL_DIR);
  let changedRel = null;

  if (changedOnly) {
    changedRel = new Set(getChangedRelPaths());
    if (changedRel.size === 0) {
      console.log('No changed skill markdown files — nothing to upload');
      return;
    }
    files = files.filter((file) => changedRel.has(relative(join(ROOT, '..'), file)));
    console.log(`Found ${files.length} changed markdown file(s)`);
  } else {
    console.log(`Found ${files.length} markdown files`);
  }

  let uploaded = 0;
  let failed = 0;
  let skillMeta = null;
  let skillMdChanged = false;

  const results = await mapPool(files, concurrency, async (file) => {
    const relPath = relative(SKILL_DIR, file);
    const r2Key = `${R2_PREFIX}/${relPath}`;

    try {
      const body = readFileSync(file);
      await uploadObject(r2Key, body, 'text/markdown; charset=utf-8');
      if (relPath === 'SKILL.md') {
        skillMeta = parseFrontmatter(body.toString('utf8'));
        skillMdChanged = true;
      }
      return { relPath, r2Key, ok: true };
    } catch (err) {
      return { relPath, r2Key, ok: false, error: err.message };
    }
  });

  for (const result of results) {
    process.stdout.write(`  ${result.relPath} → ${result.r2Key} ... `);
    if (result.ok) {
      console.log('OK');
      uploaded++;
    } else {
      console.log(`FAILED (${result.error})`);
      failed++;
    }
  }

  const shouldUploadMeta =
    !changedOnly || skillMdChanged || changedRel?.has('skills/ShareOutSkill/SKILL.md');

  if (uploaded > 0 || !changedOnly) {
    const zipEntries = {};
    for (const file of walkDir(SKILL_DIR)) {
      const relPath = relative(SKILL_DIR, file);
      zipEntries[relPath] = readFileSync(file);
    }

    const r2Key = `${R2_PREFIX}/_bundle.zip`;
    process.stdout.write(`  _bundle.zip (${Object.keys(zipEntries).length} files) → ${r2Key} ... `);

    try {
      await uploadObject(r2Key, zipSync(zipEntries), 'application/zip');
      console.log('OK');
      uploaded++;
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      failed++;
    }
  }

  if (shouldUploadMeta) {
    if (!skillMeta) {
      const skillPath = join(SKILL_DIR, 'SKILL.md');
      skillMeta = parseFrontmatter(readFileSync(skillPath, 'utf8'));
    }

    if (skillMeta) {
      const metaJson = JSON.stringify(
        {
          name: skillMeta.name || 'shareout-skill',
          version: skillMeta.version || '0.0.0',
          updated_at: skillMeta.updated_at || new Date().toISOString(),
          description: skillMeta.description || '',
        },
        null,
        2
      );

      const r2Key = `${R2_PREFIX}/_meta.json`;
      process.stdout.write(`  _meta.json → ${r2Key} ... `);

      try {
        await uploadObject(r2Key, metaJson, 'application/json');
        console.log('OK');
        uploaded++;
      } catch (err) {
        console.log(`FAILED (${err.message})`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${uploaded} uploaded, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
