#!/usr/bin/env node
/**
 * Guard: every relative link inside skills/ShareOutSkill/ resolves to a real file.
 *
 * The skill is served flat at GET $ORIGIN/v1/skill/{path} — there is no directory-index
 * fallback, so a link to a bare directory 404s for an agent even though it "looks right"
 * in a repo browser. This walks every .md file under the skill tree, resolves each
 * relative markdown link against the linking file's own directory, and fails if the
 * target isn't a file on disk. Absolute paths, http(s) links, mailto:, and #anchors-only
 * are skipped (not doc-tree references).
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

const broken = [];
for (const file of walk(skillRoot)) {
  const rel = relative(repo, file);
  const content = readFileSync(file, 'utf8');
  let m;
  while ((m = LINK_RE.exec(content))) {
    const link = m[1];
    if (/^(https?:|mailto:|#|\$ORIGIN)/.test(link)) continue;
    if (link.startsWith('/')) continue; // absolute API path, not a doc-tree reference
    const pathPart = link.split('#')[0];
    if (!pathPart) continue; // pure #anchor within the same file
    const target = normalize(join(dirname(file), pathPart));
    if (!existsSync(target) || statSync(target).isDirectory()) {
      broken.push(`${rel}: [${link}] -> ${relative(repo, target)}`);
    }
  }
}

if (broken.length) {
  console.error('check:skill-links — broken relative links in skills/ShareOutSkill/:\n');
  for (const b of broken) console.error(`  ${b}`);
  console.error(`\n${broken.length} broken link(s). An agent fetching these via GET $ORIGIN/v1/skill/{path} gets a 404.`);
  process.exit(1);
}

console.log('✓ check:skill-links — all relative links resolve');
