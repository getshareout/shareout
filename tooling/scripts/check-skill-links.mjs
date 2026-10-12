#!/usr/bin/env node
/**
 * Guard: every relative link inside skills/ShareOutSkill/ resolves to a real file, and every
 * #anchor (same-file or cross-file) matches a heading in the target (GitHub-style slug).
 *
 * The skill is served flat at GET $ORIGIN/v1/skill/{path} — there is no directory-index
 * fallback, so a link to a bare directory 404s for an agent even though it "looks right"
 * in a repo browser. This walks every .md file under the skill tree, resolves each
 * relative markdown link against the linking file's own directory, and fails if the
 * target isn't a file on disk inside the skill tree (links that escape it 404 once served). Absolute paths, http(s) links and mailto: are skipped (not
 * doc-tree references).
 *
 * Usage: node tooling/scripts/check-skill-links.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(fileURLToPath(import.meta.url), '..', '..', '..');
const skillRoot = join(repo, 'skills', 'ShareOutSkill');

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith('.md')) yield full;
  }
}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const seen = new Map();
  const anchors = new Set();
  let fenced = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(m[1]);
    for (const m of line.matchAll(/\{#([\w-]+)\}/g)) anchors.add(m[1]);
    const h = /^#{1,6}\s+(.*?)\s*(?:\{#[\w-]+\})?\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = slugify(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

const broken = [];
for (const file of walk(skillRoot)) {
  const rel = relative(repo, file);
  const content = readFileSync(file, 'utf8');
  let m;
  while ((m = LINK_RE.exec(content))) {
    const link = m[1];
    if (/^(https?:|mailto:|\$ORIGIN)/.test(link)) continue;
    if (link.startsWith('/')) continue; // absolute API path, not a doc-tree reference
    const [pathPart, anchor] = link.split('#');
    const target = pathPart ? normalize(join(dirname(file), pathPart)) : file;
    if (relative(skillRoot, target).startsWith('..')) {
      broken.push(`${rel}: [${link}] -> ${relative(repo, target)} (outside the skill; not served at /v1/skill)`);
      continue;
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      broken.push(`${rel}: [${link}] -> ${relative(repo, target)}`);
      continue;
    }
    if (anchor && target.endsWith('.md') && !anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase())) {
      broken.push(`${rel}: [${link}] -> missing anchor #${anchor} in ${relative(repo, target)}`);
    }
  }
}

if (broken.length) {
  console.error('check:skill-links — broken relative links in skills/ShareOutSkill/:\n');
  for (const b of broken) console.error(`  ${b}`);
  console.error(`\n${broken.length} broken link(s). An agent fetching these via GET $ORIGIN/v1/skill/{path} gets a 404.`);
  process.exit(1);
}

console.log('✓ check:skill-links — all relative links and #anchors resolve');
