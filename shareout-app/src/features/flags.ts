import type { Env } from '../types';
import { FEATURES, featureDefault, isKnownFeature } from './registry';

function featureLabel(key: string): string {
  return FEATURES.find((f) => f.key === key)?.label ?? key;
}

// Read-through KV cache (same pattern as src/serve/comments-config.ts). Both
// layers cache the raw sparse override map as JSON. 60s TTL is the backstop;
// admin writes bust the key for instant effect.
const FLAG_TTL = 60;
const GLOBAL_KEY = 'ff:global';
const wsKey = (id: string) => `ff:ws:${id}`;

export const GLOBAL_TARGET = 'global';
export type FlagSource = 'workspace' | 'global' | 'default';

/** Parse a sparse override map, keeping only boolean values. */
function parseOverrides(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function loadGlobalOverrides(env: Env): Promise<Record<string, boolean>> {
  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(GLOBAL_KEY);
      if (cached !== null) return parseOverrides(cached);
    } catch {}
  }
  let raw: string | null = null;
  try {
    const row = await env.DB.prepare('SELECT value FROM platform_config WHERE key = ?')
      .bind('feature_defaults').first<{ value: string }>();
    raw = row?.value ?? null;
  } catch {}
  if (env.SLUGS) {
    try { await env.SLUGS.put(GLOBAL_KEY, raw ?? '{}', { expirationTtl: FLAG_TTL }); } catch {}
  }
  return parseOverrides(raw);
}

async function loadWorkspaceOverrides(env: Env, workspaceId: string): Promise<Record<string, boolean>> {
  const key = wsKey(workspaceId);
  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(key);
      if (cached !== null) return parseOverrides(cached);
    } catch {}
  }
  let raw: string | null = null;
  try {
    const row = await env.DB.prepare('SELECT feature_flags FROM workspaces WHERE id = ?')
      .bind(workspaceId).first<{ feature_flags: string | null }>();
    raw = row?.feature_flags ?? null;
  } catch {}
  if (env.SLUGS) {
    try { await env.SLUGS.put(key, raw ?? '{}', { expirationTtl: FLAG_TTL }); } catch {}
  }
  return parseOverrides(raw);
}

/**
 * Resolve one feature for an optional workspace.
 * Order: workspace override -> global default -> registry default.
 * A falsy workspaceId (Personal / no-workspace artifacts) skips the workspace layer.
 */
export async function isFeatureEnabled(
  env: Env,
  key: string,
  workspaceId?: string | null
): Promise<boolean> {
  // Unknown keys fail open — a stale check never blocks a real feature.
  if (!isKnownFeature(key)) return true;

  if (workspaceId) {
    const ws = await loadWorkspaceOverrides(env, workspaceId);
    if (key in ws) return ws[key];
  }
  const global = await loadGlobalOverrides(env);
  if (key in global) return global[key];
  if (workspaceId) {
  }
  return featureDefault(key);
}

/**
 * Resolve a feature for an artifact when you only have its id. Looks up the
 * artifact's workspace_id, then applies the normal resolution. Centralizing the
 * lookup here keeps gate call-sites (and their tests) free of the extra query.
 */
export async function isArtifactFeatureEnabled(
  env: Env,
  key: string,
  artifactId: string
): Promise<boolean> {
  if (!isKnownFeature(key)) return true;
  const row = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  return isFeatureEnabled(env, key, row?.workspace_id ?? null);
}

/** Effective value + source for every registered feature (admin UI). */
export async function resolveEffectiveFlags(
  env: Env,
  workspaceId?: string | null
): Promise<Record<string, { value: boolean; source: FlagSource }>> {
  const ws = workspaceId ? await loadWorkspaceOverrides(env, workspaceId) : {};
  const global = await loadGlobalOverrides(env);
  const out: Record<string, { value: boolean; source: FlagSource }> = {};
  for (const f of FEATURES) {
    if (workspaceId && f.key in ws) out[f.key] = { value: ws[f.key], source: 'workspace' };
    else if (f.key in global) out[f.key] = { value: global[f.key], source: 'global' };
    else out[f.key] = { value: f.defaultEnabled, source: 'default' };
  }
  return out;
}

export interface FeaturesPayload {
  scope: { workspace_id: string | null };
  features: Record<string, boolean>;
  disabled: string[];
  catalog: Array<{ key: string; label: string; category: string; description: string; enabled: boolean }>;
}

/** Read-only effective-flags payload — shared by the agent and customer views. */
export async function buildFeaturesPayload(env: Env, workspaceId: string | null): Promise<FeaturesPayload> {
  const effective = await resolveEffectiveFlags(env, workspaceId);
  const features: Record<string, boolean> = {};
  const catalog = FEATURES.map((f) => {
    const enabled = effective[f.key].value;
    features[f.key] = enabled;
    return { key: f.key, label: f.label, category: f.category, description: f.description, enabled };
  });
  const disabled = catalog.filter((f) => !f.enabled).map((f) => f.key);
  return { scope: { workspace_id: workspaceId }, features, disabled, catalog };
}

/** The raw override maps for a target, for the admin UI to show explicit state. */
export async function getOverrides(
  env: Env,
  workspaceId?: string | null
): Promise<Record<string, boolean>> {
  return workspaceId ? loadWorkspaceOverrides(env, workspaceId) : loadGlobalOverrides(env);
}

async function bust(env: Env, key: string): Promise<void> {
  if (env.SLUGS) {
    try { await env.SLUGS.delete(key); } catch {}
  }
}

/** Set or clear (value=null) a single override on the global defaults layer. */
export async function setGlobalFlag(env: Env, key: string, value: boolean | null): Promise<void> {
  const current = await loadGlobalOverrides(env);
  if (value === null) delete current[key];
  else current[key] = value;
  await env.DB.prepare(
    `INSERT INTO platform_config (key, value, updated_at) VALUES ('feature_defaults', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(current)).run();
  await bust(env, GLOBAL_KEY);
}

/** Set or clear (value=null) a single override on a workspace. */
export async function setWorkspaceFlag(
  env: Env,
  workspaceId: string,
  key: string,
  value: boolean | null
): Promise<void> {
  const current = await loadWorkspaceOverrides(env, workspaceId);
  if (value === null) delete current[key];
  else current[key] = value;
  const json = Object.keys(current).length ? JSON.stringify(current) : null;
  await env.DB.prepare("UPDATE workspaces SET feature_flags = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(json, workspaceId).run();
  await bust(env, wsKey(workspaceId));
}

/**
 * Standard 403 returned when a gated feature is off for the caller's workspace.
 * The body names the feature and points the agent at GET /v1/features so it can
 * see the full enabled/disabled set and adjust without guessing.
 */
export function featureDisabledResponse(key: string): Response {
  const label = featureLabel(key);
  return new Response(
    JSON.stringify({
      error: `"${label}" is not enabled for this workspace. Ask the workspace owner/admin to enable it, or use a different approach. See GET /v1/features for the full list of what is enabled.`,
      code: 'FEATURE_DISABLED',
      feature: key,
      feature_label: label,
      docs: '/v1/features',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}

const WEB_AGENT_KEY = 'ai.web_agent';

/** User-facing message when the home/workspace assistant is blocked. */
export async function webAgentBlockedMessage(
  env: Env,
  workspaceId?: string | null
): Promise<string> {
  if (workspaceId) {
    const ws = await loadWorkspaceOverrides(env, workspaceId);
    if (WEB_AGENT_KEY in ws && !ws[WEB_AGENT_KEY]) {
      return 'The workspace assistant is turned off for this workspace. A workspace admin can re-enable it under **Admin → Features**.';
    }
  }
  const global = await loadGlobalOverrides(env);
  if (WEB_AGENT_KEY in global && !global[WEB_AGENT_KEY]) {
    return 'The workspace assistant isn’t available on this workspace right now.';
  }
  return 'The workspace assistant isn’t available right now. Ask a workspace admin to check **Admin → Features**.';
}

export interface WebAgentBlockedPayload {
  error: string;
  code: 'FEATURE_DISABLED';
  feature: typeof WEB_AGENT_KEY;
}

/** JSON body for API routes that reject a blocked workspace assistant. */
export async function webAgentBlockedPayload(
  env: Env,
  workspaceId: string
): Promise<WebAgentBlockedPayload> {
  return {
    error: await webAgentBlockedMessage(env, workspaceId),
    code: 'FEATURE_DISABLED',
    feature: WEB_AGENT_KEY,
  };
}
