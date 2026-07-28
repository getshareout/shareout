import type { Env } from '../../types';
import { createMiniDb, type MiniDb } from '../../data/minidb-client';
import { extractTextFromHtml } from '../../serve/utils';
import { buildScopeClause } from '../../data/tables';
import type { ViewerScope } from '../../data/access-policy';
import {
  resolveArtifactAccessForUser,
  getTelegramVisibilityScope,
  listWorkspacesForUser,
  TELEGRAM_PERSONAL_WORKSPACE,
  type TelegramWorkspaceSelection,
} from '../access';
import { placeholders } from '../../account-links';
import { quickSearch, type SearchGroup, type SearchHit } from '../../search/quick-search';
import type { AccountTool } from './types';

const MAX_REPORT_CHARS = 12_000;
const MAX_JSON_CHARS = 8_000;
const SAMPLE_ROWS = 5;
const MAX_TABLES = 20;

interface ArtifactListItem {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  artifact_type: string;
  updated_at: string | null;
  created_at: string;
}

// Owner OR collaborator OR workspace-visible (in a workspace the user belongs to).
// Mirrors handleListArtifacts plus the workspace-visibility branch from the gate.
export async function listArtifactsForUser(
  env: Env,
  userId: string,
  opts: { search?: string; limit: number; workspaceId?: TelegramWorkspaceSelection }
): Promise<ArtifactListItem[]> {
  const scope = await getTelegramVisibilityScope(env, userId);
  const idPh = placeholders(scope.userIds.length);
  const emailPh = placeholders(scope.emails.length);
  // Keyword bridge toward semantic search: match name, slug, description, and tags
  // (not just the title), so "CPM artifacts" finds pages tagged/described with CPM.
  // (Full embedding search via Vectorize is a later upgrade behind this same surface.)
  const searchClause = opts.search
    ? ' AND (a.name LIKE ? OR a.slug LIKE ? OR a.description LIKE ? OR EXISTS (SELECT 1 FROM artifact_tags at WHERE at.artifact_id = a.id AND at.label LIKE ?))'
    : '';
  let scopeClause: string;
  let scopeBinds: unknown[];

  if (opts.workspaceId === TELEGRAM_PERSONAL_WORKSPACE) {
    scopeClause = `a.workspace_id IS NULL AND (a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))`;
    scopeBinds = [...scope.userIds, ...scope.emails];
  } else if (opts.workspaceId) {
    const workspaces = await listWorkspacesForUser(env, userId);
    if (!workspaces.some((w) => w.id === opts.workspaceId)) return [];
    scopeClause = `a.workspace_id = ? AND (a.visibility != 'private' OR a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))`;
    scopeBinds = [opts.workspaceId, ...scope.userIds, ...scope.emails];
  } else {
    const wsIds = (await listWorkspacesForUser(env, userId)).map((w) => w.id);
    const wsClause = wsIds.length
      ? ` OR (a.visibility = 'workspace' AND a.workspace_id IN (${placeholders(wsIds.length)}))`
      : '';
    scopeClause = `(a.owner_id IN (${idPh}) OR c.email IN (${emailPh})${wsClause})`;
    scopeBinds = [...scope.userIds, ...scope.emails, ...wsIds];
  }

  const sql = `
    SELECT DISTINCT a.id, a.name, a.slug, a.visibility, a.artifact_type,
      d.updated_at, a.created_at
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email IN (${emailPh})
    WHERE (${scopeClause})${searchClause}
    ORDER BY COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ?`;

  const binds: unknown[] = [...scope.emails, ...scopeBinds];
  if (opts.search) {
    const like = `%${opts.search}%`;
    binds.push(like, like, like, like); // name, slug, description, tag label
  }
  binds.push(opts.limit);

  const res = await env.DB.prepare(sql).bind(...binds).all<ArtifactListItem>();
  return res.results;
}

function toSummary(items: ArtifactListItem[]) {
  return items.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.artifact_type || 'html',
    visibility: a.visibility,
    updated_at: a.updated_at || a.created_at,
  }));
}

export const listArtifactsTool: AccountTool = {
  name: 'list_artifacts',
  description:
    "List the user's ShareOut pages (most recently updated first). Returns id, name, type, visibility, updated_at. Use the id with read_artifact.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const items = await listArtifactsForUser(ctx.env, ctx.userId, { limit: 50, workspaceId: ctx.selectedWorkspaceId });
    return { artifacts: toSummary(items) };
  },
};

export const searchArtifactsTool: AccountTool = {
  name: 'search_artifacts',
  description: "Find the user's pages whose name or slug matches the given text.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Text to match in the page name or slug.' } },
    required: ['query'],
  },
  async execute(ctx, input) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return { error: 'Missing search text.' };
    const items = await listArtifactsForUser(ctx.env, ctx.userId, {
      search: query,
      limit: 25,
      workspaceId: ctx.selectedWorkspaceId,
    });
    return { artifacts: toSummary(items) };
  },
};

export const searchWorkspaceTool: AccountTool = {
  name: 'search_workspace',
  description:
    "Ranked, typo-tolerant search across the workspace — pages (by name, tags, and description), plus folders, shared datasets, connectors, people (members), schedules, crew, and alerts when in a workspace. Prefer this over search_artifacts for anything but an exact page name. Returns grouped results ordered by relevance; open a page result with read_artifact.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for. Typo/gap tolerant; matches names, tags, and descriptions.' },
      groups: {
        type: 'array',
        items: { type: 'string', enum: ['artifacts', 'folders', 'datasets', 'connectors', 'people', 'schedules', 'crew', 'alerts'] },
        description: 'Optional. Which result groups to return. Defaults to all.',
      },
      limit: { type: 'number', description: 'Max results per group (default 8, max 20).' },
    },
    required: ['query'],
  },
  async execute(ctx, input) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return { error: 'Missing search text.' };
    const groups = Array.isArray(input.groups)
      ? (input.groups.filter((g): g is SearchGroup => typeof g === 'string') as SearchGroup[])
      : undefined;
    const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 20) : 8;
    const result = await quickSearch(ctx.env, ctx.userId, {
      q: query,
      workspaceId: ctx.selectedWorkspaceId,
      groups,
      limit,
    });
    const strip = (hits: SearchHit[]) =>
      hits.map((h) => ({
        id: h.id,
        name: h.title,
        ...(h.subtitle ? { detail: h.subtitle } : {}),
        ...(h.slug ? { slug: h.slug } : {}),
        ...(h.artifactType ? { type: h.artifactType } : {}),
        ...(h.views != null ? { views: h.views } : {}),
        ...(h.owner ? { owner: h.owner } : {}),
      }));
    return {
      artifacts: strip(result.artifacts),
      folders: strip(result.folders),
      datasets: strip(result.datasets),
      connectors: strip(result.connectors),
      people: strip(result.people),
      schedules: strip(result.schedules),
      crew: strip(result.crew),
      alerts: strip(result.alerts),
    };
  },
};

async function readReportText(env: Env, artifactId: string): Promise<string | null> {
  const dep = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  ).bind(artifactId).first<{ version_id: string }>();
  if (!dep) return null;

  const ver = await env.DB.prepare('SELECT entrypoint FROM versions WHERE id = ?')
    .bind(dep.version_id)
    .first<{ entrypoint: string }>();
  if (!ver?.entrypoint) return null;

  const asset = await env.DB.prepare(
    'SELECT r2_key, mime FROM assets WHERE version_id = ? AND path = ?'
  ).bind(dep.version_id, ver.entrypoint).first<{ r2_key: string; mime: string }>();
  if (!asset) return null;

  const obj = await env.ARTIFACTS.get(asset.r2_key);
  if (!obj) return null;
  const raw = await obj.text();
  const text = asset.mime.includes('html') ? extractTextFromHtml(raw) : raw;
  return text.length > MAX_REPORT_CHARS ? text.slice(0, MAX_REPORT_CHARS) + '\n…(truncated)' : text;
}

async function readJsonStore(db: MiniDb, artifactId: string): Promise<Record<string, unknown>> {
  const rows = await db.prepare('SELECT key, value FROM artifact_json WHERE artifact_id = ? LIMIT 100')
    .bind(artifactId)
    .all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  let budget = MAX_JSON_CHARS;
  for (const r of rows.results) {
    if (budget <= 0) break;
    const sliced = r.value.length > budget ? r.value.slice(0, budget) : r.value;
    budget -= sliced.length;
    try {
      out[r.key] = JSON.parse(sliced);
    } catch {
      out[r.key] = sliced;
    }
  }
  return out;
}

// Read table samples, applying the viewer's row-level scope (never bypassed).
async function readTables(db: MiniDb, artifactId: string, scope: ViewerScope | null) {
  const tablesRes = await db.prepare(
    'SELECT id, name, row_count FROM artifact_tables WHERE artifact_id = ? ORDER BY name LIMIT ?'
  ).bind(artifactId, MAX_TABLES).all<{ id: string; name: string; row_count: number }>();

  const clause = buildScopeClause(scope);
  const out: Array<{ name: string; rowCount: number; sample: unknown[] }> = [];
  for (const t of tablesRes.results) {
    const rowsRes = await db.prepare(
      `SELECT data FROM artifact_rows WHERE table_id = ? AND ${clause.sql} ORDER BY created_at DESC LIMIT ?`
    ).bind(t.id, ...clause.params, SAMPLE_ROWS).all<{ data: string }>();
    const sample = rowsRes.results.map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return r.data;
      }
    });
    out.push({ name: t.name, rowCount: t.row_count, sample });
  }
  return out;
}

async function readBlobMeta(env: Env, artifactId: string) {
  const res = await env.DB.prepare(
    'SELECT id, filename, mime_type, size_bytes FROM blobs WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(artifactId).all<{ id: string; filename: string; mime_type: string; size_bytes: number }>();
  return res.results.map((b) => ({ id: b.id, filename: b.filename, mime: b.mime_type, sizeBytes: b.size_bytes }));
}

export const readArtifactTool: AccountTool = {
  name: 'read_artifact',
  description:
    'Read a page so you can summarize it or answer questions about its numbers. Returns the rendered report text, stored JSON values, table samples (respecting the viewer’s row access), and a list of files (metadata only — you cannot read file contents). Get the id from list_artifacts or search_artifacts.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The id of the page to read.' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    if (!artifactId) return { error: 'Missing artifact_id.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };

    const meta = await ctx.env.DB.prepare(
      'SELECT name, slug, visibility, artifact_type FROM artifacts WHERE id = ?'
    ).bind(artifactId).first<{ name: string; slug: string; visibility: string; artifact_type: string }>();

    const db = createMiniDb(ctx.env, artifactId, access.workspaceId ?? '');
    const [reportText, json, tables, files] = await Promise.all([
      readReportText(ctx.env, artifactId),
      readJsonStore(db, artifactId),
      readTables(db, artifactId, access.viewerScope),
      readBlobMeta(ctx.env, artifactId),
    ]);

    return {
      id: artifactId,
      name: meta?.name ?? '',
      type: meta?.artifact_type || 'html',
      visibility: meta?.visibility ?? '',
      reportText,
      json,
      tables,
      files,
    };
  },
};
