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
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
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

export function invalid(text: string, structured?: Record<string, unknown>): ToolResult {
  return { ...ok(text, structured), isError: true };
}

export const NOT_MEMBER = 'The person is not a member of that workspace. Call list_workspaces to see the right ids.';

type PropSchema = { type?: string | string[]; enum?: unknown[]; minimum?: number; maximum?: number };

/** The declared argument closest to a misspelt one ("sender" → "senders", "page" → none). */
function closestArg(name: string, known: string[]): string | null {
  const n = name.toLowerCase();
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  };
  let best: string | null = null, bestD = 3;
  for (const k of known) {
    const d = k.startsWith(n) || n.startsWith(k) ? 1 : dist(n, k.toLowerCase());
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
}

/** Checks arguments against a tool's inputSchema (required, type, enum, range, and — when the
 *  schema says additionalProperties: false — no arguments it does not take). Returns what is wrong, or null. */
export function validateArgs(schema: Record<string, unknown>, args: Args): string | null {
  const props = (schema.properties ?? {}) as Record<string, PropSchema>;
  if (schema.additionalProperties === false) {
    // A misspelt or invented argument was silently ignored before, so the call "worked" without it.
    const known = Object.keys(props);
    const unknown = Object.keys(args).find((k) => !(k in props));
    if (unknown) {
      const near = closestArg(unknown, known);
      return `unknown argument “${unknown}”${near ? ` (did you mean “${near}”?)` : ''}. This tool takes: ${known.join(', ') || 'no arguments'}.`;
    }
  }
  for (const key of (schema.required ?? []) as string[]) {
    if (args[key] === undefined || args[key] === null) return `${key} is required.`;
  }
  for (const [key, value] of Object.entries(args)) {
    const p = props[key];
    if (!p || value === undefined || value === null) continue;
    const typeOk = p.type === 'string' ? typeof value === 'string'
      : p.type === 'integer' ? Number.isInteger(value)
      : p.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : p.type === 'boolean' ? typeof value === 'boolean'
      : p.type === 'array' ? Array.isArray(value)
      : true;
    if (!typeOk) return `${key} must be ${p.type === 'integer' ? 'an' : 'a'} ${p.type}.`;
    if (p.enum && !p.enum.includes(value)) return `${key} must be one of: ${p.enum.map((v) => JSON.stringify(v)).join(', ')}.`;
    if (typeof value === 'number' && ((p.minimum !== undefined && value < p.minimum) || (p.maximum !== undefined && value > p.maximum))) {
      return `${key} must be between ${p.minimum ?? '-∞'} and ${p.maximum ?? '∞'}.`;
    }
  }
  return null;
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

/** A folder of the workspace, named by id or by name. */
export async function resolveFolder(ctx: ToolContext, workspaceId: string | null, folder: string): Promise<{ id?: string; error?: string }> {
  if (!workspaceId) return { error: 'Folders belong to a workspace; this page is in the personal space, so it cannot go in a folder.' };
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, name FROM folders WHERE workspace_id = ? AND (id = ? OR name = ? COLLATE NOCASE) LIMIT 6'
  ).bind(workspaceId, folder, folder).all<{ id: string; name: string }>();
  const exact = results.find((f) => f.id === folder);
  if (exact) return { id: exact.id };
  if (results.length === 1) return { id: results[0].id };
  if (!results.length) return { error: `There is no folder "${folder}" in that workspace. Ask the person for the exact folder name.` };
  return { error: `Several folders are called "${folder}"; call again with one of these ids as folder: ${results.map((f) => f.id).join(', ')}.` };
}
