// Generic, owner-authenticated artifact provisioning from inside an artifact.
//
// Lets an owner-built artifact (a "hub") create sibling artifacts in ITS OWN
// workspace, authenticated by the data-tier owner identity — no API token ever
// leaves the server, and the front-end never holds a publish credential. This is
// the safe primitive behind patterns like "a dashboard that spins up per-client
// rooms". Hard constraints: only the calling artifact's owner/editor can call it,
// and the new artifact is forced into the caller's workspace (no cross-tenant).
//
// Body: { name, slug?, entrypoint?, visibility?, agent?,
//         files?: FileEntry[],                       // raw files, OR
//         fromArtifact?: string, replace?: {k:v} }   // clone+stamp a template
import type { DataContext } from './middleware';
import { publishArtifact } from '../publish';
import { coerceVisibility } from '../visibility-config';
import { json } from '../artifacts/json-response';
import { generateSlug } from '../validation';
import { createLogger, logError } from '../logging';
import type { FileEntry, Visibility } from '../types';

const SAFE_TEMPLATE_ERRORS = new Set([
  'template artifact not found',
  'template not accessible',
  'template has no production version',
]);

function userFacingTemplateError(err: unknown): string {
  if (err instanceof Error && SAFE_TEMPLATE_ERRORS.has(err.message)) {
    return err.message;
  }
  return 'Failed to load template';
}

function mapProvisionFailure(err: unknown): { message: string; code: string; status: number } {
  if (err instanceof Error && err.message === 'FORBIDDEN') {
    return { message: 'Forbidden', code: 'FORBIDDEN', status: 403 };
  }
  return { message: 'Provisioning failed', code: 'PROVISION_FAILED', status: 500 };
}

const TEXT_RE = /^text\/|application\/(json|javascript|xml|.*\+xml|.*\+json)$|image\/svg/;

async function loadArtifactFiles(ctx: DataContext, artifactId: string): Promise<FileEntry[]> {
  const env = ctx.env;
  // Only allow cloning a template the caller may read: same owner OR same workspace.
  const art = await env.DB.prepare(
    'SELECT owner_id, workspace_id FROM artifacts WHERE id = ? AND deleted_at IS NULL'
  ).bind(artifactId).first<{ owner_id: string | null; workspace_id: string | null }>();
  if (!art) throw new Error('template artifact not found');
  const sameOwner = art.owner_id && art.owner_id === ctx.artifact.owner_id;
  const sameWorkspace = art.workspace_id && art.workspace_id === ctx.artifact.workspace_id;
  if (!sameOwner && !sameWorkspace) throw new Error('template not accessible');

  const dep = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  ).bind(artifactId).first<{ version_id: string }>();
  if (!dep) throw new Error('template has no production version');

  const rows = await env.DB.prepare(
    'SELECT path, r2_key, mime FROM assets WHERE version_id = ?'
  ).bind(dep.version_id).all<{ path: string; r2_key: string; mime: string }>();

  const files: FileEntry[] = [];
  for (const a of rows.results || []) {
    const obj = await env.ARTIFACTS.get(a.r2_key);
    if (!obj) continue;
    if (TEXT_RE.test(a.mime || '')) {
      files.push({ path: a.path, content: await obj.text(), mime: a.mime, encoding: 'utf8' });
    } else {
      const buf = await obj.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      files.push({ path: a.path, content: b64, mime: a.mime, encoding: 'base64' });
    }
  }
  return files;
}

function applyReplacements(files: FileEntry[], replace: Record<string, string>): FileEntry[] {
  const keys = Object.keys(replace || {});
  if (!keys.length) return files;
  return files.map((f) => {
    if (f.encoding === 'base64') return f;
    let content = f.content;
    for (const k of keys) content = content.split(k).join(String(replace[k]));
    return { ...f, content };
  });
}

export async function handleProvision(request: Request, ctx: DataContext): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  }
  // Owner/editor only. A gated viewer of the hub can never provision.
  if (!ctx.isOwner || !ctx.artifact.owner_id) {
    return json({ error: 'Only the artifact owner can provision', code: 'FORBIDDEN' }, 403);
  }

  let body: {
    name?: string; slug?: string; entrypoint?: string; visibility?: string;
    files?: FileEntry[]; fromArtifact?: string; replace?: Record<string, string>;
    agent?: unknown;
  };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  if (!body.name || typeof body.name !== 'string') {
    return json({ error: 'name is required', code: 'MISSING_PARAM' }, 400);
  }

  let files: FileEntry[] | undefined = body.files;
  if (body.fromArtifact) {
    try {
      files = applyReplacements(await loadArtifactFiles(ctx, body.fromArtifact), body.replace || {});
    } catch (e) {
      const message = userFacingTemplateError(e);
      if (message === 'Failed to load template') {
        logError(
          createLogger(ctx.env, {
            scope: 'provision',
            event: 'template.load.failed',
            artifact_id: ctx.artifactId,
            template_artifact_id: body.fromArtifact,
          }),
          'artifact provision template load failed',
          e,
        );
      }
      return json({ error: message, code: 'TEMPLATE_ERROR' }, 400);
    }
  }
  if (!Array.isArray(files) || files.length === 0) {
    return json({ error: 'files or fromArtifact required', code: 'MISSING_PARAM' }, 400);
  }

  // New artifact is forced into the caller's workspace — no cross-tenant provisioning.
  const workspaceId = ctx.artifact.workspace_id ?? null;
  const visibility = coerceVisibility(ctx.env, (body.visibility || ctx.artifact.visibility || 'workspace') as Visibility, false);
  const user = { id: ctx.artifact.owner_id, email: null, username: null };

  try {
    const result = await publishArtifact(ctx.env, user, {
      name: body.name,
      slug: body.slug || generateSlug(body.name),
      entrypoint: body.entrypoint || 'index.html',
      files,
      visibility,
      authMethod: 'google',
      shareWith: [],
      credentials: [],
      workspaceId,
      folderId: null,
      artifactType: 'html',
      agent: body.agent,
    } as Parameters<typeof publishArtifact>[2]);
    return json(result, 200);
  } catch (e) {
    const failure = mapProvisionFailure(e);
    logError(
      createLogger(ctx.env, {
        scope: 'provision',
        event: 'publish.failed',
        artifact_id: ctx.artifactId,
        code: failure.code,
        status: failure.status,
      }),
      'artifact provision publish failed',
      e,
    );
    return json({ error: failure.message, code: failure.code }, failure.status);
  }
}
