/**
 * The `mcp` capability an author declares at publish: which workspace MCP
 * connections, and which of their tools, the page may call as its viewer. It is
 * stored in the version's manifest_json, so it is tied to the version being served
 * and is already loaded on the serve path.
 */
import type { Env } from '../types';

export const MAX_MCP_CONNECTIONS = 10;
export const MAX_MCP_TOOLS = 50;

export interface McpCapability {
  connections: { name: string; tools: string[] }[];
}

export interface VersionCapabilities {
  mcp?: McpCapability;
}

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const TOOL = /^[a-zA-Z0-9_.-]{1,128}$/;

export function parseMcpCapabilityInput(raw: unknown): { ok: true; value: McpCapability } | { ok: false; error: string } {
  const conns = (raw as { connections?: unknown } | null)?.connections;
  if (!Array.isArray(conns) || conns.length === 0) return { ok: false, error: 'capabilities.mcp.connections must be a non-empty array' };
  if (conns.length > MAX_MCP_CONNECTIONS) return { ok: false, error: `At most ${MAX_MCP_CONNECTIONS} MCP connections` };
  const seen = new Set<string>();
  const out: McpCapability['connections'] = [];
  for (const c of conns as { name?: unknown; tools?: unknown }[]) {
    if (typeof c?.name !== 'string' || !NAME.test(c.name)) return { ok: false, error: 'Each MCP connection needs a valid name' };
    if (seen.has(c.name)) return { ok: false, error: `Duplicate MCP connection "${c.name}"` };
    seen.add(c.name);
    if (!Array.isArray(c.tools) || c.tools.length === 0) {
      return { ok: false, error: `List the tools "${c.name}" may call; an empty list is not "all tools"` };
    }
    if (c.tools.length > MAX_MCP_TOOLS) return { ok: false, error: `At most ${MAX_MCP_TOOLS} tools per connection` };
    if (!c.tools.every((t) => typeof t === 'string' && TOOL.test(t))) return { ok: false, error: `Invalid tool name in "${c.name}"` };
    out.push({ name: c.name, tools: [...new Set(c.tools as string[])].sort() });
  }
  return { ok: true, value: { connections: out.sort((a, b) => a.name.localeCompare(b.name)) } };
}

export function mcpCapabilityFromManifest(manifestJson: string | null | undefined): McpCapability | null {
  if (!manifestJson) return null;
  try {
    const cap = (JSON.parse(manifestJson) as { capabilities?: VersionCapabilities }).capabilities?.mcp;
    return cap && Array.isArray(cap.connections) && cap.connections.length > 0 ? cap : null;
  } catch {
    return null;
  }
}

export function hasMcpCapability(manifestJson: string | null | undefined): boolean {
  return mcpCapabilityFromManifest(manifestJson) !== null;
}

/** Stable hash of a (normalized) capability. Consent and broker tokens are bound to it. */
export async function mcpCapabilityHash(cap: McpCapability): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(cap)));
  return Array.from(new Uint8Array(digest).slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function productionManifestJson(env: Env, artifactId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT v.manifest_json FROM deployments d JOIN versions v ON v.id = d.version_id
     WHERE d.artifact_id = ? AND d.channel = 'production'`,
  ).bind(artifactId).first<{ manifest_json: string | null }>();
  return row?.manifest_json ?? null;
}

/** What a new version written without an explicit declaration inherits from the live one. */
export async function carriedCapabilities(env: Env, artifactId: string): Promise<VersionCapabilities | undefined> {
  const cap = mcpCapabilityFromManifest(await productionManifestJson(env, artifactId));
  return cap ? { mcp: cap } : undefined;
}

/** manifest_json for versions written outside publish (editor saves): only the carried capabilities. */
export async function carriedManifestJson(env: Env, artifactId: string): Promise<string> {
  const capabilities = await carriedCapabilities(env, artifactId);
  return capabilities ? JSON.stringify({ capabilities }) : '{}';
}

/** Names in the declaration that are not MCP connections of this workspace. */
export async function unknownMcpConnections(env: Env, workspaceId: string, cap: McpCapability): Promise<string[]> {
  const names = cap.connections.map((c) => c.name);
  const placeholders = names.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT name FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND kind = 'platform' AND provider = 'mcp' AND name IN (${placeholders})`,
  ).bind(workspaceId, ...names).all<{ name: string }>();
  const found = new Set(results.map((r) => r.name));
  return names.filter((n) => !found.has(n));
}
