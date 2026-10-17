/**
 * /v1/artifact-templates — save artifacts or folders as templates, browse the ones a
 * workspace can use, install them in one call, and move installed copies to a newer
 * version. (`/v1/templates` is the older email-template API.) The MCP tools
 * list_templates / install_template / save_as_template replay these routes.
 */
import type { FetchContext } from '../context';
import type { AuthUser } from '../../api-auth';
import { hasScope } from '../../api-auth';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { buildApiErrorBody } from '../../http/api-error';
import { requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import { getUserRole } from '../../artifacts/roles';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { createLogger, logError } from '../../logging';
import {
  TemplateError, addVersion, applyUpdate, canManage, canSee, createTemplate, deleteTemplate, getTemplate,
  installInfo, installTemplate, isAdmin, isTemplateScope, listTemplates, loadItemFiles, loadVersion, parseTags,
  planUpdate, previewOf, readPreviewImage, resolveTokens, sharedWith, snapshotSource, tagsOf, updateMeta, validateShares,
  LIMITS, type Snapshot, type TemplateRow, type TemplateScope,
} from '../../templates';
import { createViewToken, verifyViewToken } from '../../templates/view-token';

const PREFIX = '/v1/artifact-templates';

type Body = Record<string, unknown>;

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

async function readBody(request: Request): Promise<Body | Response> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Body : jsonError('Body must be a JSON object', 'INVALID_JSON', 400);
  } catch {
    return jsonError('Invalid JSON', 'INVALID_JSON', 400);
  }
}

function errorOut(e: TemplateError): Response {
  return Response.json({ ...buildApiErrorBody({ code: e.code, message: e.message }), ...(e.extra ?? {}) }, { status: e.status });
}

export async function summary(env: FetchContext['env'], user: AuthUser, t: TemplateRow) {
  const v = await loadVersion(env, t).catch(() => null);
  const items = v?.manifest.items ?? [];
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    tags: tagsOf(t),
    scope: t.scope,
    workspace_id: t.workspace_id,
    version_no: t.current_version_no,
    version: v?.label ?? null,
    updated_at: t.updated_at,
    created_at: t.created_at,
    has_image: !!t.preview_r2_key,
    image_url: t.preview_r2_key ? `${PREFIX}/${t.id}/image` : null,
    preview_url: items.length && v ? `${PREFIX}/${t.id}/view/${await createViewToken(env, t.id, v.versionNo)}/${items[0].key}/` : null,
    item_count: items.length,
    items: items.map((i) => ({ key: i.key, name: i.name, artifact_type: i.artifact_type })),
    has_folders: !!v?.manifest.root_folder,
    setup: v?.manifest.setup ?? [],
    can_manage: await canManage(env, user, t),
  };
}

function sourceOf(body: Body): { kind: 'artifact' | 'folder'; id: string } | Response {
  const artifactId = str(body.artifact_id, 100);
  const folderId = str(body.folder_id, 100);
  if (!!artifactId === !!folderId) return jsonError('Give exactly one of artifact_id or folder_id', 'VALIDATION_ERROR', 400);
  return artifactId ? { kind: 'artifact', id: artifactId } : { kind: 'folder', id: folderId! };
}

function reviewRequired(snap: Snapshot): Response {
  return Response.json({
    ...buildApiErrorBody({
      code: 'REVIEW_REQUIRED',
      message: 'This content may include personal or customer details. Review the findings, edit the source if needed, then save again with acknowledge_findings: true.',
    }),
    findings: snap.findings,
    preview: previewOf(snap),
  }, { status: 409 });
}

async function handleInstalled(ctx: FetchContext, user: AuthUser, method: string, rest: string): Promise<Response> {
  const { env, request, url } = ctx;
  if (rest === '' && method === 'GET') {
    const artifactId = str(url.searchParams.get('artifact_id'), 100);
    if (!artifactId) return jsonError('artifact_id is required', 'VALIDATION_ERROR', 400);
    if (!(await getUserRole(env, artifactId, user.id))) return jsonError('Forbidden', 'FORBIDDEN', 403);
    const info = await installInfo(env, artifactId);
    if (info) {
      const t = await getTemplate(env, info.template_id);
      if (!t || !(await canSee(env, user, t))) return jsonResponse({ installed: null });
    }
    return jsonResponse({ installed: info });
  }
  if (rest === '/update' && method === 'POST') {
    if (!hasScope(user, 'artifacts:publish')) return jsonError('Token lacks artifacts:publish', 'INSUFFICIENT_SCOPE', 403);
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const artifactId = str(body.artifact_id, 100);
    if (!artifactId) return jsonError('artifact_id is required', 'VALIDATION_ERROR', 400);
    if (body.confirm !== true) return jsonResponse({ applied: false, plan: await planUpdate(env, user, artifactId) });
    return jsonResponse({ applied: true, ...(await applyUpdate(env, user, artifactId)) });
  }
  return jsonError('Not found', 'NOT_FOUND', 404);
}

async function handleCreate(ctx: FetchContext, user: AuthUser, body: Body, preview: boolean): Promise<Response> {
  const { env } = ctx;
  if (!hasScope(user, 'artifacts:publish')) return jsonError('Token lacks artifacts:publish', 'INSUFFICIENT_SCOPE', 403);
  const source = sourceOf(body);
  if (source instanceof Response) return source;
  const snap = await snapshotSource(env, user, {
    kind: source.kind, id: source.id,
    includeSampleRows: body.include_sample_rows === true,
    readme: typeof body.readme === 'string' ? body.readme.slice(0, LIMITS.readme) : null,
  });
  if (preview) return jsonResponse(previewOf(snap));
  if (snap.findings.length && body.acknowledge_findings !== true) return reviewRequired(snap);

  const scope: TemplateScope = isTemplateScope(body.scope) ? body.scope : 'private';
  const admin = await isAdmin(env, user);
  if (scope === 'instance' && !admin) return jsonError('Only instance admins can publish to the instance library', 'FORBIDDEN', 403);
  const version = str(body.version, 20);
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) return jsonError('version must look like 1.0.0', 'VALIDATION_ERROR', 400);
  const shares = scope === 'shared' ? await validateShares(env, user, Array.isArray(body.shared_workspace_ids) ? body.shared_workspace_ids as string[] : [], admin) : [];
  const t = await createTemplate(env, user, snap, source, {
    name: str(body.name, LIMITS.name) ?? snap.sourceName,
    description: str(body.description, LIMITS.description),
    tags: parseTags(body.tags),
    scope,
    versionLabel: version,
    notes: str(body.notes, 2000),
    sharedWorkspaceIds: shares,
    previewImage: str(body.preview_image, 1_500_000),
  });
  return jsonResponse({ template: await summary(env, user, t), findings: snap.findings, redactions: snap.redactions, excluded: snap.excluded }, 201);
}

async function handleOne(ctx: FetchContext, user: AuthUser, t: TemplateRow, method: string, sub: string): Promise<Response> {
  const { env, request } = ctx;
  if (sub === '' && method === 'GET') {
    const manage = await canManage(env, user, t);
    const versions = await env.DB.prepare('SELECT version_no, version_label, notes, size_bytes, created_at FROM template_versions WHERE template_id = ? ORDER BY version_no DESC LIMIT 50')
      .bind(t.id).all<Record<string, unknown>>();
    const v = await loadVersion(env, t).catch(() => null);
    return jsonResponse({
      template: {
        ...(await summary(env, user, t)),
        readme: v?.manifest.readme ?? null,
        folders: v?.manifest.folders.map((f) => ({ key: f.key, name: f.name, parent: f.parent })) ?? [],
        items: v?.manifest.items.map((i) => ({
          key: i.key, name: i.name, artifact_type: i.artifact_type, folder: i.folder, files: i.files.length,
          tables: i.tables.map((x) => ({ name: x.name, columns: x.columns })),
          datasets: i.datasets.map((x) => ({ name: x.name, format: x.format, columns: x.columns })),
          connectors: i.connectors.map((c) => ({ name: c.name, provider: c.provider })),
        })) ?? [],
        versions: versions.results || [],
        ...(manage ? { source_kind: t.source_kind, source_id: t.source_id, shared_workspace_ids: await sharedWith(env, t.id) } : {}),
      },
    });
  }
  if (sub === '' && method === 'PATCH') {
    if (!hasScope(user, 'artifacts:publish')) return jsonError('Token lacks artifacts:publish', 'INSUFFICIENT_SCOPE', 403);
    if (!(await canManage(env, user, t))) return jsonError('Forbidden', 'FORBIDDEN', 403);
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const admin = await isAdmin(env, user);
    const scope = body.scope === undefined ? undefined : isTemplateScope(body.scope) ? body.scope : null;
    if (scope === null) return jsonError('scope must be private, shared or instance', 'VALIDATION_ERROR', 400);
    const updated = await updateMeta(env, user, t, {
      ...(body.name !== undefined ? { name: str(body.name, LIMITS.name) ?? t.name } : {}),
      ...(body.description !== undefined ? { description: str(body.description, LIMITS.description) } : {}),
      ...(body.tags !== undefined ? { tags: parseTags(body.tags) } : {}),
      ...(scope ? { scope } : {}),
      ...(body.shared_workspace_ids !== undefined ? { sharedWorkspaceIds: await validateShares(env, user, Array.isArray(body.shared_workspace_ids) ? body.shared_workspace_ids as string[] : [], admin) } : {}),
      ...(typeof body.preview_image === 'string' ? { previewImage: body.preview_image } : {}),
    }, admin);
    return jsonResponse({ template: await summary(env, user, updated) });
  }
  if (sub === '' && method === 'DELETE') {
    if (!(await canManage(env, user, t))) return jsonError('Forbidden', 'FORBIDDEN', 403);
    await deleteTemplate(env, t);
    return jsonResponse({ deleted: true });
  }
  if (sub === '/versions' && method === 'POST') {
    if (!hasScope(user, 'artifacts:publish')) return jsonError('Token lacks artifacts:publish', 'INSUFFICIENT_SCOPE', 403);
    if (!(await canManage(env, user, t))) return jsonError('Forbidden', 'FORBIDDEN', 403);
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const override = body.artifact_id || body.folder_id ? sourceOf(body) : null;
    if (override instanceof Response) return override;
    const source = override ?? (t.source_id ? { kind: t.source_kind, id: t.source_id } : null);
    if (!source) return jsonError('This template has no source to snapshot; pass artifact_id or folder_id', 'VALIDATION_ERROR', 400);
    const version = str(body.version, 20);
    if (version && !/^\d+\.\d+\.\d+$/.test(version)) return jsonError('version must look like 1.0.0', 'VALIDATION_ERROR', 400);
    const snap = await snapshotSource(env, user, {
      kind: source.kind, id: source.id,
      includeSampleRows: body.include_sample_rows === true,
      readme: typeof body.readme === 'string' ? body.readme.slice(0, LIMITS.readme) : null,
    });
    if (snap.workspaceId !== t.workspace_id && !(await isAdmin(env, user))) {
      return jsonError('A new version must come from the same workspace as the template', 'FORBIDDEN', 403);
    }
    if (body.preview === true) return jsonResponse(previewOf(snap));
    if (snap.findings.length && body.acknowledge_findings !== true) return reviewRequired(snap);
    const updated = await addVersion(env, user, t, snap, { versionLabel: version, notes: str(body.notes, 2000) });
    return jsonResponse({ template: await summary(env, user, updated), findings: snap.findings, redactions: snap.redactions }, 201);
  }
  if (sub === '/install' && method === 'POST') {
    if (!hasScope(user, 'artifacts:publish')) return jsonError('Token lacks artifacts:publish', 'INSUFFICIENT_SCOPE', 403);
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const workspaceId = body.workspace_id === null || body.workspace_id === undefined || body.workspace_id === '' ? null : str(body.workspace_id, 100);
    if (user.service && !workspaceId) return jsonError('Workspace tokens install into a workspace: pass workspace_id', 'VALIDATION_ERROR', 400);
    const result = await installTemplate(env, user, t.id, { workspaceId, folderId: str(body.folder_id, 100) });
    return jsonResponse(result, 201);
  }
  if (sub === '/image' && method === 'GET') {
    const obj = await readPreviewImage(env, t);
    if (!obj) return jsonError('No preview image', 'NOT_FOUND', 404);
    return new Response(obj.body, { headers: { 'Content-Type': t.preview_mime || 'image/png', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
  }
  return jsonError('Not found', 'NOT_FOUND', 404);
}

const VIEW_RE = /^\/v1\/artifact-templates\/(tpl_[a-f0-9]+)\/view\/([0-9]+\.[A-Za-z0-9_-]+)\/([a-z0-9]+)\/(.*)$/;

/**
 * GET /v1/artifact-templates/{id}/view/{token}/{item}/{path} — a live look at the
 * template, sandboxed: opaque origin, no cookies, no same-origin access, so the signed
 * token (handed out only to people who can see the template) is the credential. Links
 * between items are not resolved (there is no install yet) and point at '#'.
 */
async function serveView(ctx: FetchContext, m: RegExpMatchArray): Promise<Response> {
  const { env } = ctx;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const t = await getTemplate(env, m[1]);
  if (!t || t.current_version_no < 1 || !(await verifyViewToken(env, m[2], t.id, t.current_version_no))) return notFound();
  const v = await loadVersion(env, t);
  const item = v.manifest.items.find((i) => i.key === m[3]);
  if (!item) return notFound();
  let path = item.entrypoint;
  try { path = decodeURIComponent(m[4]) || item.entrypoint; } catch { return notFound(); }
  const f = item.files.find((x) => x.path === path);
  if (!f) return notFound();
  const [file] = await loadItemFiles(env, t.id, v.versionNo, { ...item, files: [f] });
  const body = file.encoding === 'base64' ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)) : resolveTokens(file.content, {}, '', null);
  return new Response(body, {
    headers: {
      'Content-Type': f.mime,
      'Content-Security-Policy': 'sandbox allow-scripts',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function routeTemplatesApi(ctx: FetchContext): Promise<Response | null> {
  const { path, request, env, url } = ctx;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return null;
  const cors = (r: Response) => ctx.addCORS(r);
  const view = request.method === 'GET' ? path.match(VIEW_RE) : null;
  if (view) return serveView(ctx, view);
  const auth = await requireTokenOrSession(ctx);
  if (!isAuthUser(auth)) return auth;
  const user = auth;
  const method = request.method;
  const rest = path.slice(PREFIX.length);

  try {
    if (!hasScope(user, 'artifacts:read')) return cors(jsonError('Token lacks artifacts:read', 'INSUFFICIENT_SCOPE', 403));
    if (rest === '' || rest === '/') {
      if (method === 'GET') {
        const workspaceId = str(url.searchParams.get('workspace') ?? url.searchParams.get('workspace_id'), 100);
        if (workspaceId && !(await getInternalWorkspaceRole(env, workspaceId, user.id))) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
        const scopeQ = url.searchParams.get('scope');
        const rows = await listTemplates(env, user, {
          workspaceId,
          q: str(url.searchParams.get('q'), 100),
          tag: str(url.searchParams.get('tag'), 32),
          scope: isTemplateScope(scopeQ) ? scopeQ : null,
        });
        const templates = [];
        for (const t of rows) templates.push(await summary(env, user, t));
        return cors(jsonResponse({ templates }));
      }
      if (method === 'POST') {
        const body = await readBody(request);
        if (body instanceof Response) return cors(body);
        return cors(await handleCreate(ctx, user, body, false));
      }
      return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    }
    if (rest === '/preview') {
      if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
      const body = await readBody(request);
      if (body instanceof Response) return cors(body);
      return cors(await handleCreate(ctx, user, body, true));
    }
    if (rest === '/installed' || rest.startsWith('/installed/')) {
      return cors(await handleInstalled(ctx, user, method, rest.slice('/installed'.length)));
    }
    const m = rest.match(/^\/(tpl_[a-f0-9]+)(\/.*)?$/);
    if (!m) return cors(jsonError('Template not found', 'NOT_FOUND', 404));
    const t = await getTemplate(env, m[1]);
    // Missing and not-visible answer the same, so template ids can't be probed.
    if (!t || !(await canSee(env, user, t))) return cors(jsonError('Template not found', 'NOT_FOUND', 404));
    return cors(await handleOne(ctx, user, t, method, m[2] ?? ''));
  } catch (e) {
    if (e instanceof TemplateError) return cors(errorOut(e));
    if (e instanceof Error && e.message === 'FORBIDDEN') return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    logError(createLogger(env, { event: 'templates.error', method, path }), 'template route failed', e);
    return cors(jsonError('Internal server error', 'INTERNAL_ERROR', 500));
  }
}
