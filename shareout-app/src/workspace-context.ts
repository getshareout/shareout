import type { Env } from './types';
import type { AuthUser } from './api-auth';
import { generateId } from './crypto-utils';
import { requireWorkspaceRole } from './workspaces';
import { json } from './artifacts/json-response';
import { knowledgeTrunkForContext } from './knowledge-context';

// Customer-owned markdown files an agent pulls when working in a workspace
// (house style, voice, conventions, data notes). Owner/admin write; member read.

const NAME_REGEX = /^[a-z0-9][a-z0-9._-]*\.md$/;
const MAX_NAME = 64;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_FILES = 100;
const DEFAULT_ENTRY = 'index.md';

function humanSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

// The filename an agent reads first. Customer-configurable; defaults to index.md.
export async function getContextEntry(env: Env, workspaceId: string): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT context_entry FROM workspaces WHERE id = ?'
  ).bind(workspaceId).first<{ context_entry: string | null }>();
  return row?.context_entry || DEFAULT_ENTRY;
}

// The workspace entry guidance file (house rules) as ambient agent context. '' when
// none. Mirrors knowledgeTrunkForContext — hot path, single-row read, never throws.
// Fixes the gap where in-app agents got the learned trunk but not the manual house style.
export async function guidanceEntryForContext(
  env: Env,
  workspaceId: string,
  opts: { maxChars?: number } = {}
): Promise<string> {
  try {
    const name = await getContextEntry(env, workspaceId);
    const row = await env.DB.prepare(
      "SELECT content FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = '' AND path = ?"
    ).bind(workspaceId, name).first<{ content: string }>();
    const body = row?.content?.trim();
    if (!body) return '';
    const max = opts.maxChars ?? 1500;
    const trimmed = body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
    return `## House rules (guidance)\n${trimmed}`;
  } catch {
    return '';
  }
}

export interface WorkspaceContextFile {
  name: string;
  content: string;
  updated_by: string | null;
  updated_at: string;
}

function validName(name: string): boolean {
  return name.length <= MAX_NAME && NAME_REGEX.test(name);
}

// Scope-aware (work/030): shareeId null = workspace-level house style (scope_id '');
// shareeId set = workspace-private notes ABOUT that Client, keyed by its id.
export async function listWorkspaceContextFiles(
  env: Env,
  workspaceId: string,
  shareeId: string | null = null
): Promise<WorkspaceContextFile[]> {
  const { results } = await env.DB.prepare(
    `SELECT path AS name, content, updated_by, updated_at
       FROM workspace_files
      WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ?
      ORDER BY path ASC`
  ).bind(workspaceId, shareeId ?? '').all<WorkspaceContextFile>();
  return results ?? [];
}

/** A Client's notes assembled for the AI — every note inlined (intel is meant to be
 *  read in full, unlike the manifest-style workspace doc). Empty when none. */
export async function buildShareeContextDoc(
  env: Env,
  workspaceId: string,
  shareeId: string,
  shareeName?: string
): Promise<string> {
  const files = await listWorkspaceContextFiles(env, workspaceId, shareeId);
  if (files.length === 0) return '';
  const heading = shareeName
    ? `# What we know about ${shareeName} (internal — do not share with them)`
    : '# Client notes (internal)';
  const parts = [heading, ''];
  for (const f of files) {
    parts.push(`## ${f.name}`, '', f.content.trim(), '');
  }
  return parts.join('\n');
}

async function shareeInWorkspace(env: Env, workspaceId: string, shareeId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM sharees WHERE id = ? AND workspace_id = ?')
    .bind(shareeId, workspaceId).first());
}

// Internal upsert with NO HTTP role gate — for the trusted in-workspace agent/crew to
// keep a Client's notes current. Validates name + size; stamps updated_by_kind='agent'
// when no user id is given. Returns an error code string, or null on success.
export async function upsertShareeContextFile(
  env: Env,
  workspaceId: string,
  shareeId: string,
  name: string,
  content: string,
  byUserId: string | null
): Promise<string | null> {
  if (!validName(name)) return 'INVALID_NAME';
  if (content.length === 0) return 'EMPTY_CONTENT';
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) return 'TOO_LARGE';
  if (!(await shareeInWorkspace(env, workspaceId, shareeId))) return 'NOT_FOUND';

  const existing = await env.DB.prepare(
    "SELECT 1 AS x FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ? AND path = ?"
  ).bind(workspaceId, shareeId, name).first<{ x: number }>();
  const kind = byUserId ? 'user' : 'agent';

  if (!existing) {
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ?"
    ).bind(workspaceId, shareeId).first<{ n: number }>();
    if ((countRow?.n ?? 0) >= MAX_FILES) return 'LIMIT_REACHED';
  }
  await env.DB.prepare(
    `INSERT INTO workspace_files (workspace_id, namespace, scope_id, path, content, updated_by, updated_by_kind)
     VALUES (?, 'context', ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, namespace, scope_id, path) DO UPDATE SET
       content = excluded.content, updated_by = excluded.updated_by,
       updated_by_kind = excluded.updated_by_kind,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspaceId, shareeId, name, content, byUserId, kind).run();
  return null;
}

// Markdown injected into the skill for an agent. Loads ONLY the entry file inline
// plus a manifest of the other files (names + sizes) so a workspace with many
// files never ships them all at once — the agent fetches the rest on demand.
// Empty string when the workspace has no context files.
export async function buildWorkspaceContextDoc(
  env: Env,
  workspaceId: string,
  workspaceName?: string
): Promise<string> {
  const files = await listWorkspaceContextFiles(env, workspaceId);
  const trunk = await knowledgeTrunkForContext(env, workspaceId);
  if (files.length === 0 && !trunk) return '';

  const heading = workspaceName
    ? `# ${workspaceName} — workspace context`
    : '# Workspace context';
  const parts = [heading, ''];

  if (files.length > 0) {
    const entryName = await getContextEntry(env, workspaceId);
    const entry = files.find((f) => f.name === entryName);
    const others = files.filter((f) => f.name !== entryName);

    const fetchHint =
      `Follow these house rules for any artifact you build in this workspace, unless ` +
      `the user explicitly overrides them. Fetch any file below on demand with:\n` +
      `\`GET /v1/workspaces/${workspaceId}/context/{name}\` (Bearer token).`;
    parts.push(fetchHint, '');

    if (entry) {
      parts.push(`## ${entry.name} (entry point)`, '', entry.content.trim(), '');
    }

    if (others.length > 0) {
      parts.push('## Other available context files', '');
      for (const f of others) {
        parts.push(`- \`${f.name}\` (${humanSize(f.content.length)})`);
      }
      parts.push('');
    }

    if (!entry) {
      parts.push(
        `_No \`${entryName}\` entry file is set. Read the files above as needed._`,
        ''
      );
    }
  }

  if (trunk) parts.push(trunk, '');

  return parts.join('\n');
}

// Resolve a workspace by slug or id, verify the caller is a member, and return
// its context doc for /v1/skill injection. Returns '' when not a member, the
// workspace is unknown, or it has no context files (caller stays unaware).
export async function getSkillWorkspaceContext(
  env: Env,
  workspaceParam: string,
  userId: string
): Promise<string> {
  const ws = await env.DB.prepare(
    'SELECT id, name FROM workspaces WHERE id = ? OR slug = ? LIMIT 1'
  ).bind(workspaceParam, workspaceParam).first<{ id: string; name: string }>();
  if (!ws) return '';

  const member = await env.DB.prepare(
    'SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1'
  ).bind(ws.id, userId).first();
  if (!member) return '';

  return buildWorkspaceContextDoc(env, ws.id, ws.name);
}

export async function handleListWorkspaceContext(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const [files, entry] = await Promise.all([
    listWorkspaceContextFiles(env, workspaceId),
    getContextEntry(env, workspaceId),
  ]);
  return json({
    entry,
    files: files.map((f) => ({
      name: f.name,
      size: f.content.length,
      is_entry: f.name === entry,
      updated_by: f.updated_by,
      updated_at: f.updated_at,
    })),
  });
}

// Set which file is the entry point an agent reads first. Admin/owner only.
export async function handleSetWorkspaceContextEntry(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let body: { entry?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  // null/empty resets to the default convention (index.md).
  let entry: string | null;
  if (body.entry === null || body.entry === undefined || body.entry === '') {
    entry = null;
  } else if (typeof body.entry === 'string' && validName(body.entry)) {
    entry = body.entry;
  } else {
    return json({ error: 'entry must be a .md file name or null', code: 'INVALID_NAME' }, 400);
  }

  await env.DB.prepare('UPDATE workspaces SET context_entry = ? WHERE id = ?')
    .bind(entry, workspaceId).run();

  return json({ entry: entry || DEFAULT_ENTRY });
}

export async function handleGetWorkspaceContextFile(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  name: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  if (!validName(name)) {
    return json({ error: 'Invalid file name', code: 'INVALID_NAME' }, 400);
  }

  const row = await env.DB.prepare(
    "SELECT content FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = '' AND path = ?"
  ).bind(workspaceId, name).first<{ content: string }>();
  if (!row) return json({ error: 'File not found', code: 'NOT_FOUND' }, 404);

  return new Response(row.content, {
    status: 200,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

export async function handlePutWorkspaceContextFile(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  name: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  if (!validName(name)) {
    return json(
      { error: 'Name must be lowercase and end in .md', code: 'INVALID_NAME' },
      400
    );
  }

  // Accept raw markdown body or { "content": "..." } JSON.
  let content: string;
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    let body: { content?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
    }
    if (typeof body.content !== 'string') {
      return json({ error: 'content must be a string', code: 'INVALID_CONTENT' }, 400);
    }
    content = body.content;
  } else {
    content = await request.text();
  }

  if (content.length === 0) {
    return json({ error: 'Content is empty', code: 'EMPTY_CONTENT' }, 400);
  }
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return json({ error: 'File too large (max 64KB)', code: 'TOO_LARGE' }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT 1 AS x FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = '' AND path = ?"
  ).bind(workspaceId, name).first<{ x: number }>();

  if (!existing) {
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ''"
    ).bind(workspaceId).first<{ n: number }>();
    if ((countRow?.n ?? 0) >= MAX_FILES) {
      return json(
        { error: `Workspace context limit reached (${MAX_FILES} files)`, code: 'LIMIT_REACHED' },
        400
      );
    }
  }
  await env.DB.prepare(
    `INSERT INTO workspace_files (workspace_id, namespace, scope_id, path, content, updated_by)
     VALUES (?, 'context', '', ?, ?, ?)
     ON CONFLICT(workspace_id, namespace, scope_id, path) DO UPDATE SET
       content = excluded.content, updated_by = excluded.updated_by,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspaceId, name, content, user.id).run();

  return json({ name, size: content.length, updated: true });
}

export async function handleDeleteWorkspaceContextFile(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  name: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  if (!validName(name)) {
    return json({ error: 'Invalid file name', code: 'INVALID_NAME' }, 400);
  }

  const res = await env.DB.prepare(
    "DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = '' AND path = ?"
  ).bind(workspaceId, name).run();

  if (!res.meta.changes) return json({ error: 'File not found', code: 'NOT_FOUND' }, 404);
  return json({ name, deleted: true });
}

// --- Client (sharee) context notes (work/030). Member reads, admin writes; the AI
//     also writes via upsertShareeContextFile. Externals never reach these routes. ---

export async function handleListShareeContext(
  env: Env, user: AuthUser, workspaceId: string, shareeId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;
  if (!(await shareeInWorkspace(env, workspaceId, shareeId)))
    return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  const files = await listWorkspaceContextFiles(env, workspaceId, shareeId);
  return json({
    files: files.map((f) => ({
      name: f.name, size: f.content.length, updated_by: f.updated_by, updated_at: f.updated_at,
    })),
  });
}

export async function handleGetShareeContextFile(
  env: Env, user: AuthUser, workspaceId: string, shareeId: string, name: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;
  if (!validName(name)) return json({ error: 'Invalid file name', code: 'INVALID_NAME' }, 400);
  const row = await env.DB.prepare(
    "SELECT content FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ? AND path = ?"
  ).bind(workspaceId, shareeId, name).first<{ content: string }>();
  if (!row) return json({ error: 'File not found', code: 'NOT_FOUND' }, 404);
  return new Response(row.content, { status: 200, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}

export async function handlePutShareeContextFile(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId: string, name: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let content: string;
  if ((request.headers.get('Content-Type') || '').includes('application/json')) {
    let body: { content?: unknown };
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
    if (typeof body.content !== 'string')
      return json({ error: 'content must be a string', code: 'INVALID_CONTENT' }, 400);
    content = body.content;
  } else {
    content = await request.text();
  }

  const err = await upsertShareeContextFile(env, workspaceId, shareeId, name, content, user.id);
  if (err) {
    const status = err === 'NOT_FOUND' ? 404 : 400;
    return json({ error: err, code: err }, status);
  }
  return json({ name, size: content.length, updated: true });
}

export async function handleDeleteShareeContextFile(
  env: Env, user: AuthUser, workspaceId: string, shareeId: string, name: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;
  if (!validName(name)) return json({ error: 'Invalid file name', code: 'INVALID_NAME' }, 400);
  const res = await env.DB.prepare(
    "DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ? AND path = ?"
  ).bind(workspaceId, shareeId, name).run();
  if (!res.meta.changes) return json({ error: 'File not found', code: 'NOT_FOUND' }, 404);
  return json({ name, deleted: true });
}
