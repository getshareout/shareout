/**
 * Shared shape and helpers for MCP connector tools.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { listWorkspacesForUser, type BotWorkspace } from '../chat-agent/access';

export interface ToolContext {
  env: Env;
  user: AuthUser;
  origin: string;
  /** The caller's own `Authorization` header, replayed into in-process handlers. */
  authorization: string;
  executionCtx?: ExecutionContext;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  run: (ctx: ToolContext, args: Args) => Promise<ToolResult>;
}

export const ON_FAILURE = 'If something fails, call report_problem and tell the person the ShareOut team was notified.';

// ── result helpers ──────────────────────────────────────────────────────────

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) };
}

export function fail(text: string, structured?: Record<string, unknown>): ToolResult {
  return { ...ok(`${text}\n${ON_FAILURE}`, structured), isError: true };
}

export function str(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function errorText(body: Record<string, unknown>, status: number): string {
  const message = typeof body.error === 'string' ? body.error : `request failed (${status})`;
  const hint = typeof body.hint === 'string' ? ` ${body.hint}` : '';
  return `${message}${hint}`;
}

export function getRequest(ctx: ToolContext, path: string): Request {
  return new Request(`${ctx.origin}${path}`, { headers: { Authorization: ctx.authorization } });
}

/**
 * The workspace a tool acts on: the one named (id or slug), else the person's only
 * workspace. `choices` is set when they have several and must be asked.
 */
export async function resolveWorkspace(
  ctx: ToolContext,
  requested: string | null,
): Promise<{ workspace: BotWorkspace | null; choices?: BotWorkspace[]; notMember?: boolean }> {
  const workspaces = await listWorkspacesForUser(ctx.env, ctx.user.id);
  if (requested) {
    const workspace = workspaces.find((w) => w.id === requested || w.slug === requested) ?? null;
    return workspace ? { workspace } : { workspace: null, notMember: true };
  }
  if (workspaces.length === 1) return { workspace: workspaces[0] };
  if (workspaces.length > 1) return { workspace: null, choices: workspaces };
  return { workspace: null };
}

export function workspaceChoiceText(action: string, choices: BotWorkspace[]): string {
  return `Nothing was done yet. The person has ${choices.length} workspaces; ask which one, then call ${action} again with its workspace_id:\n` +
    choices.map((w) => `- ${w.name} (id ${w.id})`).join('\n');
}
