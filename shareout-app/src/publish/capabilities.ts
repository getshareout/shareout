/**
 * Validate a publish request's `capabilities` before anything is written.
 * Returns the normalized declaration, undefined when omitted, or a 400 response.
 */
import type { Env, PublishRequest } from '../types';
import type { PublishParams } from './types';
import { normalizeVisibility } from '../visibility-config';
import { parseMcpCapabilityInput, unknownMcpConnections } from '../mcp-broker/capabilities';
import { json } from './http';

export async function resolveRequestedCapabilities(
  env: Env,
  body: PublishRequest,
  workspaceId: string | null,
  visibility: string,
): Promise<PublishParams['capabilities'] | Response> {
  if (body.capabilities === undefined) return undefined;
  const raw = (body.capabilities as { mcp?: unknown } | null)?.mcp;
  if (raw === undefined) return undefined;
  if (raw === null) return { mcp: null };

  if (!workspaceId || normalizeVisibility(visibility) === 'public') {
    return json({
      error: 'MCP connections need a members-only workspace artifact',
      code: 'MCP_REQUIRES_MEMBERS_ONLY',
      hint: 'Publish into a workspace with visibility "workspace" or "private".',
    }, 400);
  }
  const parsed = parseMcpCapabilityInput(raw);
  if (!parsed.ok) return json({ error: parsed.error, code: 'INVALID_CAPABILITIES' }, 400);
  const unknown = await unknownMcpConnections(env, workspaceId, parsed.value);
  if (unknown.length) {
    return json({
      error: `Not MCP connections in this workspace: ${unknown.join(', ')}`,
      code: 'UNKNOWN_MCP_CONNECTION',
      hint: 'A workspace admin adds MCP servers under Connections; reference them by name.',
    }, 400);
  }
  return { mcp: parsed.value };
}
