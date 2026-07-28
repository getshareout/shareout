#!/usr/bin/env node
/**
 * External-sharing spine (work/030) — access-seam invariant guard.
 *
 * canAccess()/getInternalWorkspaceRole() is the DEFAULT for every access decision so
 * an external member's workspace_members edge never satisfies a workspace-visibility
 * or artifact-read check. The danger is not the seams we already migrated — it's the
 * NEXT one a contributor adds that calls getWorkspaceRole() directly in an access
 * context and silently leaks a workspace's content to an external.
 *
 * This guard greps every getWorkspaceRole() call site and fails the build if it lives
 * in a file NOT on the allowlist below. The allowlist is the set of management/listing
 * gates where getWorkspaceRole is intentional (member directories, admin-gated
 * mutations where an external's 'member' role is denied by the role hierarchy anyway).
 *
 * If your build fails here, ask: is this an ACCESS decision (can this identity see/
 * read/use this resource)? → use getInternalWorkspaceRole() or canAccess(). Is it a
 * member-management LISTING or an admin/owner-gated mutation? → add the file below
 * with a one-line justification. Never add a read/visibility seam to the allowlist.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Files permitted to reference getWorkspaceRole(). After the work/030 sweep, the ONLY
// permitted reference is the definition itself — every access AND management call site
// now routes through getInternalWorkspaceRole()/requireWorkspaceRole()/canAccess(), so
// an external member's edge can never satisfy a role check anywhere. getWorkspaceRole
// is retained as the raw (external-inclusive) primitive but has no callers; adding one
// is exactly what this guard exists to surface for review.
const ALLOWLIST = new Set([
  'src/workspaces/roles.ts', // definition only
]);

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const CALL_RE = /\bgetWorkspaceRole\s*\(/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = file.slice(ROOT.length + 1);
  if (ALLOWLIST.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (CALL_RE.test(line) && !/getInternalWorkspaceRole/.test(line)) {
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  console.error('\n✗ check:access-seams — getWorkspaceRole() in a non-allowlisted file:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error(
    '\nAccess decision? Use getInternalWorkspaceRole()/canAccess() so externals are excluded.' +
    '\nListing/admin-gated mutation? Add the file to ALLOWLIST in scripts/check-access-seams.mjs.\n'
  );
  process.exit(1);
}
console.log('✓ check:access-seams — no un-reviewed getWorkspaceRole access-context call sites');
