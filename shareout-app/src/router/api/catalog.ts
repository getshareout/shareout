import type { FetchContext } from '../context';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import {
  isCatalogEnabled,
  setCatalogEnabled,
  loadCatalog,
  upsertCatalogFile,
  deleteCatalogFile,
  searchEntries,
  buildFacets,
  buildManifest,
  buildLineage,
  seedConnectorsAsSources,
  type CatalogEntry,
} from '../../catalog';

const PREFIX_RE = /^\/v1\/workspaces\/([^/]+)\/catalog(?:\/(.*))?$/;

function neighbors(entries: CatalogEntry[], ids: string[]) {
  const byId = new Map(entries.map(e => [e.id, e]));
  return ids.map(id => {
    const e = byId.get(id);
    return { id, present: !!e, title: e?.title, kind: e?.kind };
  });
}

export async function routeCatalogApi(ctx: FetchContext): Promise<Response | null> {
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
  if (!role) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
  const canManage = role === 'owner' || role === 'admin';

  // POST /enable — opt the workspace in/out (owner/admin).
  if (sub === 'enable') {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
    const enabled = body?.enabled !== false;
    await setCatalogEnabled(ctx.env, workspaceId, enabled);
    return cors(jsonResponse({ enabled }));
  }

  // POST /seed — auto-seed source entries from workspace connectors (owner/admin).
  if (sub === 'seed') {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!canManage) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    const result = await seedConnectorsAsSources(ctx.env, workspaceId);
    return cors(jsonResponse(result));
  }

  // PUT/DELETE /files — agents (and humans) grow the catalog. Any member.
  if (sub === 'files') {
    if (method === 'PUT') {
      const body = (await request.json().catch(() => null)) as
        | { path?: string; content?: string }
        | null;
      if (!body?.path || typeof body.content !== 'string') {
        return cors(jsonError('path and content are required', 'BAD_REQUEST', 400));
      }
      await upsertCatalogFile(ctx.env, workspaceId, { path: body.path, content: body.content });
      return cors(jsonResponse({ ok: true }));
    }
    if (method === 'DELETE') {
      const target = url.searchParams.get('path');
      if (!target) return cors(jsonError('path is required', 'BAD_REQUEST', 400));
      await deleteCatalogFile(ctx.env, workspaceId, target);
      return cors(jsonResponse({ ok: true }));
    }
    return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
  }

  if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));

  const enabled = await isCatalogEnabled(ctx.env, workspaceId);
  if (!enabled) {
    return cors(jsonResponse({ enabled: false, entries: [], facets: null }));
  }

  const { entries, issues } = await loadCatalog(ctx.env, workspaceId);

  // GET /manifest — counts, adoption KPIs, orphans, dangling refs, staleness.
  if (sub === 'manifest') {
    const manifest = buildManifest(entries, { nowMs: Date.now() });
    return cors(jsonResponse({ enabled: true, manifest, issues }));
  }

  // GET /entries/{id} — one entry plus its lineage neighbors.
  if (sub.startsWith('entries/')) {
    const entryId = decodeURIComponent(sub.slice('entries/'.length));
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return cors(jsonError('Not found', 'NOT_FOUND', 404));
    return cors(
      jsonResponse({
        enabled: true,
        entry,
        upstream: neighbors(entries, entry.upstream),
        downstream: neighbors(entries, entry.downstream),
      })
    );
  }

  // GET /lineage — the full lineage graph (nodes + edges) for client rendering.
  if (sub === 'lineage') {
    return cors(jsonResponse({ enabled: true, graph: buildLineage(entries) }));
  }

  // GET (root) — search + facets.
  if (sub === '') {
    const q = url.searchParams;
    const results = searchEntries(entries, {
      q: q.get('q') ?? undefined,
      kind: q.get('kind') ?? undefined,
      domain: q.get('domain') ?? undefined,
      status: q.get('status') ?? undefined,
      tag: q.get('tag') ?? undefined,
    });
    return cors(
      jsonResponse({
        enabled: true,
        total: entries.length,
        count: results.length,
        entries: results,
        facets: buildFacets(entries),
        issues,
      })
    );
  }

  return cors(jsonError('Not found', 'NOT_FOUND', 404));
}
