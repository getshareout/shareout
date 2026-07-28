/**
 * Session-authenticated Workspace Library module publish (in-app authoring form).
 */
import type { Env, FileEntry } from '../types';
import type { AuthUser } from '../api-auth';
import { generateSlug } from '../validation';
import { getInternalWorkspaceRole } from '../workspaces';
import { createLogger, logError } from '../logging';
import { libraryVersionExists } from '../workspace-library';
import { json } from './http';
import { publishArtifact } from './publish-artifact';

export async function handleCreateLibraryModule(
  env: Env,
  user: AuthUser,
  request: Request,
): Promise<Response> {
  let body: {
    name?: string; version?: string; main?: string; scope?: string; workspace_id?: string;
    readme?: string; js?: string; exports?: string[] | string; slug?: string;
  };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const name = (body.name ?? '').trim();
  const version = (body.version ?? '').trim();
  const main = (body.main ?? 'index.js').trim();
  const js = body.js ?? '';
  const readme = body.readme ?? `# ${name}\n`;
  if (!name) return json({ error: 'name is required', code: 'BAD_REQUEST' }, 400);
  if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(version)) return json({ error: 'version must be semver (e.g. 1.0.0)', code: 'BAD_REQUEST' }, 400);
  if (!js.trim()) return json({ error: 'module code (js) is required', code: 'BAD_REQUEST' }, 400);

  const scope = body.scope === 'workspace' ? 'workspace' : 'personal';
  let workspaceId: string | null = null;
  if (scope === 'workspace') {
    workspaceId = body.workspace_id ?? null;
    if (!workspaceId) return json({ error: 'workspace_id required for workspace scope', code: 'BAD_REQUEST' }, 400);
    if (!(await getInternalWorkspaceRole(env, workspaceId, user.id))) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const slug = body.slug || generateSlug(name);
  const prior = workspaceId
    ? await env.DB.prepare('SELECT id FROM artifacts WHERE display_slug = ? AND workspace_id = ? AND deleted_at IS NULL').bind(slug, workspaceId).first<{ id: string }>()
    : await env.DB.prepare('SELECT id FROM artifacts WHERE display_slug = ? AND workspace_id IS NULL AND owner_id = ? AND deleted_at IS NULL').bind(slug, user.id).first<{ id: string }>();
  if (prior && await libraryVersionExists(env, prior.id, version)) {
    return json({ error: `Library version ${version} already published`, code: 'LIBRARY_VERSION_EXISTS' }, 409);
  }

  const exports = Array.isArray(body.exports)
    ? body.exports.map(String)
    : typeof body.exports === 'string'
      ? body.exports.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

  const files: FileEntry[] = [
    { path: 'README.md', content: readme, mime: 'text/markdown' },
    { path: main, content: js, mime: 'text/javascript' },
  ];

  try {
    const result = await publishArtifact(env, { id: user.id, email: user.email, username: user.username ?? null }, {
      name, slug, entrypoint: 'README.md', files,
      visibility: scope === 'workspace' ? 'workspace' : 'private',
      authMethod: 'google', shareWith: [], credentials: [],
      workspaceId, folderId: null, artifactType: 'library',
      library: { name, version, main, exports },
    });
    return json(result, 201);
  } catch (err) {
    logError(createLogger(env, { scope: 'publish', event: 'library.publish.failed' }), 'library publish failed', err);
    return json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}
