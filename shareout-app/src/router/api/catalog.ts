import type { FetchContext } from '../context';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { isCatalogEnabled, setCatalogEnabled, upsertCatalogFile, deleteCatalogFile } from '../../catalog/store';
import { searchEntries, buildFacets } from '../../catalog/search';
import { buildManifest } from '../../catalog/manifest';
import { buildLineage, findEntry } from '../../catalog/lineage';
import { loadGovernedCatalog } from '../../catalog/governed';
import { seedConnectorsAsSources } from '../../catalog/seed';
import { type CatalogEntry } from '../../catalog/types';
import { certificationHistory, handleCatalogCertify } from './catalog-certify';
import { apiErrorResponse } from '../../http/api-error';
import { metricWriteIssue } from '../../catalog/metrics/spec';
import { syncMetricIndex } from '../../catalog/metrics/index-sync';
import { listCatalogFiles } from '../../catalog/store';

const PREFIX_RE = /^\/v1\/workspaces\/([^/]+)\/catalog(?:\/(.*))?$/;
const CERTIFY_RE = /^entries\/([^/]+)\/certify$/;

// A bearer-token write is an agent's; the Home lens writes with the session cookie.
function isBearer(request: Request): boolean {
  return /^bearer\s/i.test(request.headers.get('Authorization') ?? '');
}

function neighbors(entries: CatalogEntry[], ids: string[]) {
  const byId = new Map(entries.map(e => [e.id, e]));
  return ids.map(id => {
    const e = byId.get(id);
    return { id, present: !!e, title: e?.title, kind: e?.kind, status: e?.status };
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
    // Seeding also backfills the metric index for files written before it existed.
    const metrics = await syncMetricIndex(ctx.env, workspaceId, await listCatalogFiles(ctx.env, workspaceId));
    return cors(jsonResponse({ ...result, metrics }));
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
      // An executable `kind: metric` must be a valid spec (unknown keys refused with a hint).
      const specIssue = metricWriteIssue(body.path, body.content);
      if (specIssue) {
        return cors(
          apiErrorResponse({
            code: 'INVALID_METRIC_SPEC',
            message: specIssue.message,
            status: 400,
            ...(specIssue.param ? { param: specIssue.param } : {}),
            ...(specIssue.hint ? { hint: specIssue.hint } : {}),
          })
        );
      }
      await upsertCatalogFile(ctx.env, workspaceId, {
        path: body.path,
        content: body.content,
        updatedBy: auth.id,
        updatedByKind: isBearer(request) ? 'agent' : 'user',
      });
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

  // POST /entries/{id}/certify — certify, revoke or deprecate the current version (owner/admin).
  const certify = sub.match(CERTIFY_RE);
  if (certify) {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!canManage) {
      return cors(jsonError('Only workspace owners and admins can certify catalog entries', 'FORBIDDEN', 403));
    }
    return cors(await handleCatalogCertify(ctx.env, workspaceId, decodeURIComponent(certify[1]), auth, request));
  }

  if (method !== 'GET') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));

  const enabled = await isCatalogEnabled(ctx.env, workspaceId);
  if (!enabled) {
    return cors(jsonResponse({ enabled: false, entries: [], facets: null }));
  }

  // Effective status (owner/admin certifications on the current version) and lineage
  // from both ends of every edge, on every read below.
  const { entries, issues, decisions } = await loadGovernedCatalog(ctx.env, workspaceId);

  // GET /manifest — counts, adoption KPIs, orphans, dangling refs, staleness.
  if (sub === 'manifest') {
    const manifest = buildManifest(entries, { nowMs: Date.now() });
    return cors(jsonResponse({ enabled: true, manifest, issues }));
  }

  // GET /entries/{id} — one entry plus its lineage neighbors.
  if (sub.startsWith('entries/')) {
    const entryId = decodeURIComponent(sub.slice('entries/'.length));
    const entry = findEntry(entries, entryId);
    if (!entry) return cors(jsonError('Not found', 'NOT_FOUND', 404));
    return cors(
      jsonResponse({
        enabled: true,
        entry,
        upstream: neighbors(entries, entry.upstream),
        downstream: neighbors(entries, entry.downstream),
        history: certificationHistory(decisions.get(entry.id) ?? [], entry.certification?.content_hash ?? ''),
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
