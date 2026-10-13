/**
 * POST /v1/home/import — one-step import from the Studio Home: a dropped or pasted
 * file, pasted HTML, or the share link of a chat-made page becomes a private artifact
 * in the current workspace/folder. Same gates as /v1/home/new and /v1/publish: internal
 * membership, the daily publish count, the storage cap; moderation runs inside
 * publishArtifact. Images, video and other files are not artifacts here — the client
 * sends them to the Assets library (upload + AI enrichment) instead.
 */
import type { ArtifactType, Env, FileEntry } from '../../types';
import { checkRateLimit, incrementRateLimit } from '../../api-auth';
import { checkStorageQuota } from '../../quota';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { publishArtifact } from '../../publish/publish-artifact';
import { rateLimitExceededResponse, storageLimitExceededResponse } from '../../publish/limits';
import { generateSlug } from '../../validation';
import { hostWorkspaceId } from './host';
import { IMPORT_ARTIFACT_EXTS, IMPORT_MAX_BYTES, importArtifactType, isShareLink } from './import-rules';

const TYPE_MIME: Partial<Record<ArtifactType, string>> = {
  html: 'text/html', csv: 'text/csv', markdown: 'text/markdown', json: 'application/json', txt: 'text/plain', pdf: 'application/pdf',
};

function htmlTitle(html: string): string {
  return (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Best-effort fetch of a shared page. Null when it's behind a login or rendered by JS. */
export async function fetchSharedHtml(url: string): Promise<string | null> {
  if (!isShareLink(url)) return null;
  try {
    const res = await fetch(url, { headers: { Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!res.ok || !isShareLink(res.url || url) || !(res.headers.get('content-type') || '').includes('text/html')) return null;
    const html = await res.text();
    if (html.length > IMPORT_MAX_BYTES) return null;
    const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length >= 200 ? html : null;
  } catch { return null; }
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function handleHomeImportApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown; content?: unknown; encoding?: unknown; html?: unknown; url?: unknown; folder?: unknown; lang?: unknown;
  };
  const es = body.lang === 'es';

  const workspaceId = (await hostWorkspaceId(request, env)) || new URL(request.url).searchParams.get('workspace')?.trim() || null;
  if (workspaceId && !(await getInternalWorkspaceRole(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const folderId = typeof body.folder === 'string' && body.folder ? body.folder : null;
  if (folderId) {
    const folder = workspaceId
      ? await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id = ?').bind(folderId, workspaceId).first()
      : await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id IS NULL AND owner_id = ?').bind(folderId, user.id).first();
    if (!folder) return json({ error: 'Folder not found', code: 'FOLDER_NOT_FOUND' }, 404);
  }

  let name: string;
  let type: ArtifactType;
  let file: FileEntry;
  if (typeof body.url === 'string' && body.url) {
    if (!isShareLink(body.url)) return json({ error: 'Only Claude, ChatGPT and Gemini share links can be imported', code: 'URL_NOT_SUPPORTED' }, 400);
    const html = await fetchSharedHtml(body.url);
    if (!html) return json({ error: 'Could not read that page. Copy its HTML and paste it here instead.', code: 'URL_NOT_FETCHABLE' }, 422);
    name = htmlTitle(html) || new URL(body.url).hostname;
    type = 'html';
    file = { path: 'index.html', content: html, mime: 'text/html' };
  } else if (typeof body.html === 'string' && body.html.trim()) {
    name = htmlTitle(body.html) || (es ? 'Página pegada' : 'Pasted page');
    type = 'html';
    file = { path: 'index.html', content: body.html, mime: 'text/html' };
  } else if (typeof body.name === 'string' && typeof body.content === 'string') {
    const t = importArtifactType(body.name);
    if (!t) return json({ error: 'This file type is stored in Assets, not published as an artifact', code: 'UNSUPPORTED_TYPE', allowed: Object.keys(IMPORT_ARTIFACT_EXTS) }, 415);
    type = t;
    name = body.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || body.name;
    const base64 = body.encoding === 'base64';
    file = {
      path: type === 'html' ? 'index.html' : body.name.replace(/[^\w.-]+/g, '-'),
      content: body.content,
      mime: TYPE_MIME[type]!,
      ...(base64 ? { encoding: 'base64' as const } : {}),
    };
  } else {
    return json({ error: 'Send a file (name + content), html, or url', code: 'VALIDATION_ERROR' }, 400);
  }

  const size = file.encoding === 'base64' ? Math.floor((file.content.length * 3) / 4) : file.content.length;
  if (size > IMPORT_MAX_BYTES) return json({ error: `File is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB`, code: 'FILE_TOO_LARGE' }, 413);

  const rate = await checkRateLimit(env, user.id, 'publish', user.email);
  if (!rate.allowed) return rateLimitExceededResponse(rate.reset);
  const quota = await checkStorageQuota(env, user.id, [file]);
  if (!quota.allowed) return storageLimitExceededResponse(quota);

  const slug = `${generateSlug(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))}-${crypto.randomUUID().slice(0, 6)}`;
  const published = await publishArtifact(env, { id: user.id, email: user.email || '', username: null }, {
    name, slug, entrypoint: file.path, files: [file], visibility: 'private', authMethod: 'google',
    shareWith: [], credentials: [], workspaceId, folderId, artifactType: type,
  }, executionCtx);
  await incrementRateLimit(env, user.id, 'publish', user.email);
  return json({
    ok: true, artifactId: published.artifact.id, slug: published.deployment.slug, name, type,
    ...(published.moderation ? { moderation: published.moderation } : {}),
  });
}
