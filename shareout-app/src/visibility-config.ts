import type { Env, Visibility } from './types';

const ALL_VISIBILITIES: Visibility[] = ['public', 'workspace', 'private'];

// 'unlisted' was retired 2026-07 (folded into 'public'). Normalize legacy API
// input and any pre-migration DB rows so old clients and stragglers still work.
export function normalizeVisibility(v: string | null | undefined): string {
  return v === 'unlisted' ? 'public' : (v ?? '');
}

// "Closed" visibilities never expose an artifact to the open internet: private
// (owner + explicitly shared) and workspace (all members). These stay available
// even when the open-visibility launch flag is on.
const CLOSED_VISIBILITIES: Visibility[] = ['workspace', 'private'];

// Launch flag: when on, "open" visibility (public) is disabled and
// every artifact stays closed (private/workspace, share via email allowlist,
// password, or other auth).
export function openVisibilityDisabled(env: Env): boolean {
  const v = (env.OPEN_VISIBILITY_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Workspace slugs exempt from the launch gate (config: PUBLIC_SHOWCASE_WORKSPACES).
// Add a slug to the comma-separated env var to add another showcase — no code change.
export function publicShowcaseSlugs(env: Env): Set<string> {
  return new Set(
    (env.PUBLIC_SHOWCASE_WORKSPACES || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isShowcaseSlug(env: Env, slug: string | null | undefined): boolean {
  return !!slug && publicShowcaseSlugs(env).has(slug.toLowerCase());
}

// --- Gradual rollout (Workstream Rollout) -----------------------------------
// Public artifacts roll out to free accounts in waves while OPEN_VISIBILITY_DISABLED
// stays ON as the default-deny baseline. A user is "in the rollout" (and so gets
// allowOpen, like a showcase workspace) when their id is allowlisted OR falls under
// the rollout percentage. Advance by raising PUBLIC_ROLLOUT_PCT; kill instantly by
// setting it to 0 and clearing PUBLIC_ROLLOUT_USERS (env vars are dashboard-editable,
// no code deploy). The master kill remains OPEN_VISIBILITY_DISABLED — see note in
// resolveAllowOpen below.

function publicRolloutUsers(env: Env): Set<string> {
  return new Set(
    (env.PUBLIC_ROLLOUT_USERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function publicRolloutPct(env: Env): number {
  const n = parseInt(env.PUBLIC_ROLLOUT_PCT || '0', 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// Deterministic 0..99 bucket for a user id (FNV-1a), so a given user is stably in
// or out of a percentage rollout (no flapping between publishes).
function rolloutBucket(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

export function isUserInPublicRollout(env: Env, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (publicRolloutUsers(env).has(userId)) return true;
  return rolloutBucket(userId) < publicRolloutPct(env);
}

function allowedVisibilities(env: Env): Visibility[] {
  return openVisibilityDisabled(env) ? CLOSED_VISIBILITIES : ALL_VISIBILITIES;
}

function isVisibilityAllowed(env: Env, v: Visibility): boolean {
  return allowedVisibilities(env).includes(v);
}

// Silently downgrade disabled open visibility (public) to private.
// Closed visibilities (workspace/private) pass through unchanged. When allowOpen
// is set (the artifact lives in a public showcase workspace), the launch gate is
// bypassed and the requested visibility passes through as-is.
export function coerceVisibility(env: Env, v: Visibility, allowOpen = false): Visibility {
  if (allowOpen) return v;
  return isVisibilityAllowed(env, v) ? v : 'private';
}
