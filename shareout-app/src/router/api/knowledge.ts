import type { FetchContext } from '../context';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { apiErrorResponse } from '../../http/api-error';
import { requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { isKnowledgeEnabled, setKnowledgeEnabled, listKnowledgeFiles, upsertKnowledgeFile, deleteKnowledgeFile, type StoredKnowledgeFile } from '../../knowledge/store';
import { enqueueIngest } from '../../knowledge/ingest';
import { parseKnowledge, parseNode } from '../../knowledge/parse';
import { runKnowledgeDistill } from '../../knowledge/distill';
import { NODE_KINDS, type KnowledgeNode } from '../../knowledge/types';
import { getAIProvider } from '../../data/agent/anthropic';
import { corpusFor } from '../../knowledge/corpus/client';
import { startIngest } from '../../knowledge/corpus/ingest';
import { searchCorpus, searchResultMarkdown, visibleSources } from '../../knowledge/corpus/search';
import { notesFromArtifact, readableNodes, sourceArtifacts } from '../../knowledge/source-links';
import { knowledgeUsage } from '../../knowledge/corpus/usage';
import { corpusStatus, reindexWorkspace, REINDEX_MAX } from '../../knowledge/corpus/reindex';
import { isPlatformAdmin } from '../../superadmin/auth';
import { entityMarkdown, listVisibleEntities, visibleEntity, visibleGraph } from '../../knowledge/corpus/graph';

const PREFIX_RE = /^\/v1\/workspaces\/([^/]+)\/knowledge(?:\/(.*))?$/;
const BACKFILL_LIMIT = 200;

function summarize(node: KnowledgeNode, meta?: StoredKnowledgeFile) {
  return {
    path: node.path,
    kind: node.kind,
    id: node.id,
    title: node.title,
    topics: node.topics,
    entities: node.entities,
    learned_at: node.learnedAt ?? null,
    pinned: node.pinned,
    sourcesCount: node.sources.length,
    source: meta?.source ?? null,
    updated_at: meta?.updatedAt ?? null,
  };
}

async function backfill(ctx: FetchContext, workspaceId: string): Promise<number> {
  const rows = (
    await ctx.env.DB.prepare(
      `SELECT a.id AS artifact_id, d.version_id
       FROM artifacts a
       JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       WHERE a.workspace_id = ? AND a.deleted_at IS NULL
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
      .bind(workspaceId, BACKFILL_LIMIT)
      .all<{ artifact_id: string; version_id: string | null }>()
  ).results;
  for (const row of rows) {
    await enqueueIngest(ctx.env, workspaceId, row.artifact_id, 'backfill', row.version_id ?? null);
  }
  return rows.length;
}

// Queue every live page and File into the corpus that isn't already learned at its
// current version, and every stored source that no longer exists (ingest forgets it). Capped per call (each start is a subrequest); `remaining` says how
// many are left for the next call.
const CORPUS_BACKFILL_MAX = 300;

async function backfillCorpus(ctx: FetchContext, workspaceId: string): Promise<{ queued: number; remaining: number }> {
  const env = ctx.env;
  const store = corpusFor(env, workspaceId);
  if (!store || !(await isKnowledgeEnabled(env, workspaceId))) return { queued: 0, remaining: 0 };
  const pages = (await env.DB.prepare(
    `SELECT a.id, d.version_id AS version FROM artifacts a
       JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.workspace_id = ? AND a.deleted_at IS NULL`,
  ).bind(workspaceId).all<{ id: string; version: string | null }>()).results || [];
  const files = (await env.DB.prepare(
    `SELECT d.id, (SELECT b.id FROM blobs b WHERE b.deliverable_id = d.id ORDER BY b.version_no DESC LIMIT 1) AS version
       FROM asset_deliverables d WHERE d.workspace_id = ? AND d.deleted_at IS NULL`,
  ).bind(workspaceId).all<{ id: string; version: string | null }>()).results || [];

  const known = await store.versions();
  const todo: { kind: 'page' | 'asset'; id: string; version: string }[] = [];
  for (const [kind, list] of [['page', pages], ['asset', files]] as const) {
    for (const r of list) {
      const k = known[r.id];
      if (!r.version || (k && k.version === r.version && k.status !== 'failed')) continue;
      // A failed version gets a fresh instance id so it actually re-runs.
      todo.push({ kind, id: r.id, version: k?.status === 'failed' ? `${r.version}:retry:${Date.now()}` : r.version });
    }
  }
  const live = new Set([...pages, ...files].map((r) => r.id));
  for (const [id, k] of Object.entries(known)) {
    if (!live.has(id)) todo.push({ kind: k.kind, id, version: `gone:${Date.now()}` });
  }
  const batch = todo.slice(0, CORPUS_BACKFILL_MAX);
  for (const t of batch) {
    await startIngest(env, ctx.executionCtx, { workspaceId, kind: t.kind, refId: t.id }, t.version, false);
  }
  return { queued: batch.length, remaining: todo.length - batch.length };
}

export async function routeKnowledgeApi(ctx: FetchContext): Promise<Response | null> {
  const { path, request, url } = ctx;
  const match = path.match(PREFIX_RE);
  if (!match) return null;

  const workspaceId = match[1];
  const sub = match[2] ?? '';
  const method = request.method;
  const cors = (r: Response) => ctx.addCORS(r);

  const auth = await requireTokenOrSession(ctx);
  if (!isAuthUser(auth)) return auth;

  const role = await getInternalWorkspaceRole(ctx.env, workspaceId, auth.id);
  // Instance admins may reindex and read status of any workspace (support / migrations);
  // a workspace agent (sot_) token never counts, as on /v1/admin/*.
  const superadmin = !role && (sub === 'reindex' || sub === 'status') && !auth.service
    && (await isPlatformAdmin(ctx.env, auth.email, auth.id));
  if (!role && !superadmin) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
  const canManage = superadmin || role === 'owner' || role === 'admin';

  // POST /reindex — re-learn the corpus even at unchanged versions (owner/admin, or an
  // instance admin). Body { artifactIds?: string[] }; once per workspace per 10 minutes.
  if (sub === 'reindex') {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    if (!(await isKnowledgeEnabled(ctx.env, workspaceId))) {
      return cors(apiErrorResponse({
        message: 'Knowledge is off for this workspace',
        code: 'KNOWLEDGE_DISABLED',
        status: 409,
        hint: `An owner or admin turns it on with POST /v1/workspaces/${workspaceId}/knowledge/enable`,
      }));
    }
    if (!corpusFor(ctx.env, workspaceId)) return cors(jsonError('Knowledge search is not configured on this instance', 'NOT_CONFIGURED', 501));
    const text = await request.text();
    let ids: string[] | null = null;
    if (text.trim()) {
      let body: { artifactIds?: unknown } | null = null;
      try { body = JSON.parse(text); } catch { /* handled below */ }
      const list = body?.artifactIds;
      const valid = Array.isArray(list) && list.length > 0 && list.length <= REINDEX_MAX
        && list.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100);
      if (!body || typeof body !== 'object' || (list !== undefined && !valid)) {
        return cors(apiErrorResponse({
          message: `Body must be {} or {"artifactIds": ["…"]} (1–${REINDEX_MAX} ids)`,
          code: 'VALIDATION_ERROR',
          status: 400,
          param: 'artifactIds',
        }));
      }
      ids = valid ? [...new Set(list as string[])] : null;
    }
    const r = await reindexWorkspace(ctx.env, ctx.executionCtx, workspaceId, ids);
    if (!r.ok) {
      return cors(apiErrorResponse({
        message: 'A reindex already ran for this workspace in the last 10 minutes',
        code: 'RATE_LIMITED',
        status: 429,
        hint: `Try again in ${r.retryAfterSec} seconds; GET /v1/workspaces/${workspaceId}/knowledge/status shows progress.`,
      }, { headers: { 'Retry-After': String(r.retryAfterSec) } }));
    }
    return cors(jsonResponse({ queued: r.queued, remaining: r.remaining, skipped: r.skipped }, 202));
  }

  // POST /enable — turn knowledge on/off (owner/admin).
  if (sub === 'enable') {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
    const enabled = body?.enabled !== false;
    await setKnowledgeEnabled(ctx.env, workspaceId, enabled);
    return cors(jsonResponse({ enabled }));
  }

  // POST /backfill — queue recent live pages for the distiller (owner/admin).
  if (sub === 'backfill') {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    const queued = await backfill(ctx, workspaceId);
    const corpus = await backfillCorpus(ctx, workspaceId);
    // Bounded on-demand distill kick so the client's progress bar moves right away; the
    // rest drains via the hourly cron. kicked=false when no AI provider (distill no-ops).
    const kicked = !!getAIProvider(ctx.env) && !!ctx.executionCtx;
    ctx.executionCtx?.waitUntil(
      runKnowledgeDistill(ctx.env, { workspaceId, maxItems: 10, maxMs: 25_000 }).catch(() => {})
    );
    return cors(jsonResponse({ queued, kicked, corpus: corpus.queued, corpusRemaining: corpus.remaining }));
  }

  // GET /status — training progress over a 24h window, plus `corpus`: per-source status
  // (members: only sources they may open). Answers even when disabled (before the
  // enabled-gate block) so the client can poll from any lens state.
  if (sub === 'status') {
    if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!(await isKnowledgeEnabled(ctx.env, workspaceId))) {
      return cors(jsonResponse({ enabled: false, queued: 0, processed: 0, total: 0, running: false, lastProcessedAt: null }));
    }
    const row = await ctx.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN processed_at IS NOT NULL THEN 1 ELSE 0 END) AS processed,
         COUNT(*) AS total,
         MAX(processed_at) AS last
       FROM knowledge_ingest
       WHERE workspace_id = ? AND queued_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', '-1 day')`
    )
      .bind(workspaceId)
      .first<{ queued: number | null; processed: number | null; total: number | null; last: string | null }>();
    const queued = row?.queued ?? 0;
    return cors(
      jsonResponse({
        enabled: true,
        queued,
        processed: row?.processed ?? 0,
        total: row?.total ?? 0,
        running: queued > 0,
        lastProcessedAt: row?.last ?? null,
        corpus: await corpusStatus(ctx.env, workspaceId, canManage ? null : auth.id).catch(() => null),
      })
    );
  }

  // GET /from/{artifactId} — notes learned from this artifact (the reverse of a note's
  // sources). Empty, not 404, when knowledge is off or the caller may not open the artifact.
  if (sub.startsWith('from/')) {
    if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!(await isKnowledgeEnabled(ctx.env, workspaceId))) return cors(jsonResponse({ enabled: false, notes: [] }));
    const artifactId = decodeURIComponent(sub.slice('from/'.length));
    return cors(jsonResponse({ enabled: true, notes: artifactId ? await notesFromArtifact(ctx.env, workspaceId, auth.id, artifactId) : [] }));
  }

  // /files/{path+} — one node: GET (member), PUT (member, human edit wins),
  // DELETE (owner/admin, ?forget=1 tombstones so it isn't re-learned).
  if (sub === 'files' || sub.startsWith('files/')) {
    if (!(await isKnowledgeEnabled(ctx.env, workspaceId))) {
      return cors(jsonError('Not found', 'NOT_FOUND', 404));
    }
    const target = decodeURIComponent(sub.slice('files'.length).replace(/^\//, ''));

    if (method === 'PUT') {
      if (!target) return cors(jsonError('path is required', 'BAD_REQUEST', 400));
      let raw = await request.text();
      if ((request.headers.get('Content-Type') || '').includes('application/json')) {
        let content: unknown;
        try { content = (JSON.parse(raw) as { content?: unknown })?.content; } catch { /* handled below */ }
        if (typeof content !== 'string') {
          return cors(apiErrorResponse({
            message: 'JSON body must be {"content": "<markdown with frontmatter>"}',
            code: 'VALIDATION_ERROR',
            status: 400,
            param: 'content',
            hint: 'Or send the markdown itself with Content-Type: text/markdown.',
          }));
        }
        raw = content;
      }
      if (typeof raw !== 'string' || !raw.trim()) {
        return cors(jsonError('markdown body is required', 'BAD_REQUEST', 400));
      }
      const { issue } = target.toLowerCase().endsWith('.md')
        ? parseNode(target, raw)
        : { issue: { message: 'path must end in .md' } };
      if (issue) {
        return cors(apiErrorResponse({
          message: `Invalid knowledge note: ${issue.message}`,
          code: 'VALIDATION_ERROR',
          status: 400,
          param: issue.message.startsWith('path') ? 'path' : 'content',
          hint: `Start the markdown with frontmatter: ---\nkind: topic\nid: topic.example\ntitle: Example\n---. kind is one of ${NODE_KINDS.join(', ')}.`,
        }));
      }
      await upsertKnowledgeFile(ctx.env, workspaceId, { path: target, content: raw, source: 'manual' });
      return cors(jsonResponse({ ok: true, source: 'manual' }));
    }

    if (method === 'DELETE') {
      if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
      if (!target) return cors(jsonError('path is required', 'BAD_REQUEST', 400));
      const forget = url.searchParams.get('forget') === '1';
      await deleteKnowledgeFile(ctx.env, workspaceId, target, { forget });
      return cors(jsonResponse({ ok: true, forgotten: forget }));
    }

    if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!target) return cors(jsonError('path is required', 'BAD_REQUEST', 400));
    const files = await listKnowledgeFiles(ctx.env, workspaceId);
    const file = files.find(f => f.path === target);
    if (!file) return cors(jsonError('Not found', 'NOT_FOUND', 404));
    const node = (await readableNodes(ctx.env, workspaceId, auth.id, parseKnowledge([file]).nodes))[0];
    if (!node) return cors(jsonError('Not found', 'NOT_FOUND', 404));
    return cors(
      jsonResponse({
        enabled: true,
        node: { ...summarize(node, file), body: node.body, sources: node.sources, source_artifacts: await sourceArtifacts(ctx.env, workspaceId, auth.id, node.sources) },
      })
    );
  }

  // GET /search?q=&limit=&format=md — cited passages from the workspace's Files and pages.
  const corpusRoute = ['search', 'sources', 'usage', 'graph', 'entities'].includes(sub) || sub.startsWith('entities/');
  if (corpusRoute) {
    if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!(await isKnowledgeEnabled(ctx.env, workspaceId))) {
      return cors(apiErrorResponse({
        message: 'Knowledge is off for this workspace',
        code: 'KNOWLEDGE_DISABLED',
        status: 409,
        hint: `An owner or admin turns it on with POST /v1/workspaces/${workspaceId}/knowledge/enable`,
      }));
    }
    const store = corpusFor(ctx.env, workspaceId);
    if (!store) return cors(jsonError('Knowledge search is not configured on this instance', 'NOT_CONFIGURED', 501));
    const num = (k: string, d: number, max: number) => Math.min(Math.max(Number(url.searchParams.get(k)) || d, 1), max);

    // GET /usage?days=30 — what Knowledge cost this workspace (owner/admin).
    if (sub === 'usage') {
      if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
      const days = num('days', 30, 365);
      return cors(jsonResponse(await knowledgeUsage(ctx.env, workspaceId, store, days)));
    }

    // GET /entities?type=&q=&limit= — the things the workspace is about, most-mentioned first.
    if (sub === 'entities') {
      return cors(jsonResponse(await listVisibleEntities(ctx.env, store, workspaceId, auth.id, {
        type: url.searchParams.get('type') || undefined,
        q: url.searchParams.get('q') || undefined,
        limit: num('limit', 50, 100),
      })));
    }

    // GET /entities/{id}[?format=md] — one entity: facts, connections and quoted evidence.
    if (sub.startsWith('entities/')) {
      const found = await visibleEntity(ctx.env, store, workspaceId, auth.id, decodeURIComponent(sub.slice('entities/'.length)));
      if (!found) return cors(jsonError('Entity not found', 'NOT_FOUND', 404));
      if (url.searchParams.get('format') === 'md') {
        return cors(new Response(entityMarkdown(found), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }));
      }
      return cors(jsonResponse(found));
    }

    // GET /graph?focus=&depth=&limit= — nodes + edges, around an entity or the whole workspace.
    if (sub === 'graph') {
      return cors(jsonResponse(await visibleGraph(ctx.env, store, workspaceId, auth.id, {
        focus: url.searchParams.get('focus') || undefined,
        depth: num('depth', 1, 3),
        limit: num('limit', 100, 300),
      })));
    }

    if (sub === 'sources') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      const listed = await store.listSources(limit);
      const { visible } = await visibleSources(ctx.env, workspaceId, auth.id, listed.sources);
      return cors(jsonResponse({ ...listed, sources: listed.sources.filter((r) => visible.has(r.refId)) }));
    }

    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return cors(jsonError('q is required', 'BAD_REQUEST', 400));
    const result = await searchCorpus(ctx.env, workspaceId, auth.id, q, {
      limit: Number(url.searchParams.get('limit')) || undefined,
      ctx: ctx.executionCtx,
    });
    if (url.searchParams.get('format') === 'md') {
      return cors(new Response(searchResultMarkdown(q, result), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }));
    }
    return cors(jsonResponse({ query: q, ...result }));
  }

  if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));

  const enabled = await isKnowledgeEnabled(ctx.env, workspaceId);
  if (!enabled) {
    return cors(jsonResponse({ enabled: false, counts: {}, lastUpdated: null, nodes: [] }));
  }

  const files = await listKnowledgeFiles(ctx.env, workspaceId);
  const metaByPath = new Map(files.map(f => [f.path, f]));
  const parsed = parseKnowledge(files);
  const { issues } = parsed;
  const nodes = await readableNodes(ctx.env, workspaceId, auth.id, parsed.nodes);
  const lastUpdated = files.reduce<string | null>(
    (max, f) => (!max || f.updatedAt > max ? f.updatedAt : max),
    null
  );

  // GET /tree — all node summaries (no bodies), grouped by kind.
  if (sub === 'tree') {
    const groups: Record<string, ReturnType<typeof summarize>[]> = {};
    for (const k of NODE_KINDS) groups[k] = [];
    for (const n of nodes) (groups[n.kind] ??= []).push(summarize(n, metaByPath.get(n.path)));
    return cors(jsonResponse({ enabled: true, groups, count: nodes.length, issues }));
  }

  // GET (root) — settings + manifest.
  if (sub === '') {
    const counts: Record<string, number> = {};
    for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    // Training leaves unchanged notes untouched; its last processed item counts as an update too.
    const trained = (await ctx.env.DB.prepare('SELECT MAX(processed_at) AS last FROM knowledge_ingest WHERE workspace_id = ?')
      .bind(workspaceId).first<{ last: string | null }>())?.last ?? null;
    const latest = trained && (!lastUpdated || trained > lastUpdated) ? trained : lastUpdated;
    return cors(jsonResponse({ enabled: true, counts, lastUpdated: latest, total: nodes.length }));
  }

  return cors(jsonError('Not found', 'NOT_FOUND', 404));
}
