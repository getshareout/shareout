// ShareOut Visual Editor - Main Router

import type { Env } from '../types';
import { generateEditorPage } from './visual-editor';
import { handleDraft, handlePublish, handleHistory, handleUpload } from './draft';
import { handleEditorWebSocket } from './collab/index';
import { handleEditorChat } from './chat/index';
import { handleSDKEditor } from './sdk-editors/index';
import { handleSourceEditor } from './source/index';
import { detectComponents } from './detector';
import { getPlatformOrigin } from '../config/origins';
import { openVisibilityDisabled } from '../visibility-config';
import { getAIProvider } from './chat/config';

// Re-export modules for external use
export * from './visual-editor';
export * from './collab/index';
export * from './presentation/index';
export * from './dashboard/index';

export interface EditorContext {
  artifactId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  role: 'owner' | 'editor' | 'viewer';
  env: Env;
  // Defer post-publish artifact-test runs past the response (ExecutionContext.waitUntil)
  // when available. Set by the editor route call sites. Absent → run inline.
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function handleEditor(
  request: Request,
  ctx: EditorContext,
  path: string
): Promise<Response> {
  const method = request.method;
  const parts = path.split('/').filter(Boolean);
  const action = parts[0] || '';

  // Check edit permission (owner or editor only)
  if (ctx.role === 'viewer') {
    return errorResponse('FORBIDDEN', 'View-only access. Cannot edit.', 403);
  }

  // Route based on action
  switch (action) {
    case '':
      // GET /editor - Load editor state
      if (method === 'GET') {
        return handleLoadEditor(request, ctx);
      }
      break;

    case 'draft':
      // POST/GET/DELETE /editor/draft
      return handleDraft(request, ctx, method);

    case 'publish':
      // POST /editor/publish
      if (method === 'POST') {
        return handlePublish(request, ctx);
      }
      break;

    case 'history':
      // GET /editor/history
      if (method === 'GET') {
        return handleHistory(request, ctx);
      }
      break;

    case 'rollback':
      // POST /editor/rollback
      if (method === 'POST') {
        return handleRollback(request, ctx);
      }
      break;

    case 'upload':
      // POST /editor/upload
      if (method === 'POST') {
        return handleUpload(request, ctx);
      }
      break;

    case 'ws':
      // WebSocket upgrade for real-time
      if (request.headers.get('Upgrade') === 'websocket') {
        return handleEditorWebSocket(request, ctx);
      }
      break;

    case 'chat':
      // AI Chat routes: /editor/chat/{mode}
      const chatPath = parts.slice(1).join('/');
      return handleEditorChat(request, ctx, chatPath);

    case 'sdk':
      // SDK Editor routes: /editor/sdk/{type}/{action}
      const sdkPath = parts.slice(1).join('/');
      const sdkType = parts[1];
      const componentName = request.headers.get('X-SDK-Component-Name') || undefined;
      return handleSDKEditor(request, {
        artifactId: ctx.artifactId,
        userId: ctx.userId,
        role: ctx.role,
        env: ctx.env,
        component: {
          type: sdkType as any,
          selector: '',
          name: componentName,
        },
      }, sdkPath);

    case 'source':
      // Source editor (markdown / txt / json / csv): /editor/source/{subAction}
      return handleSourceEditor(request, ctx, parts[1] || '');

    case 'detect':
      // Detect SDK components in HTML
      if (method === 'POST') {
        return handleDetectComponents(request, ctx);
      }
      break;

    default:
      return errorResponse('NOT_FOUND', `Unknown editor action: ${action}`, 404);
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
}

async function handleLoadEditor(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, env } = ctx;

  try {
    // Get artifact info
    const artifact = await env.DB.prepare(`
      SELECT a.id, a.name, a.slug, a.visibility, a.owner_id,
             d.version_id, v.entrypoint, v.version_no
      FROM artifacts a
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      LEFT JOIN versions v ON v.id = d.version_id
      WHERE a.id = ?
    `).bind(artifactId).first<{
      id: string;
      name: string;
      slug: string;
      visibility: string;
      owner_id: string;
      version_id: string | null;
      entrypoint: string | null;
      version_no: number | null;
    }>();

    if (!artifact) {
      return errorResponse('ARTIFACT_NOT_FOUND', 'Artifact not found', 404);
    }

    // Get current HTML content
    let html = '';
    if (artifact.version_id && artifact.entrypoint) {
      const asset = await env.DB.prepare(`
        SELECT r2_key FROM assets
        WHERE version_id = ? AND path = ?
      `).bind(artifact.version_id, artifact.entrypoint).first<{ r2_key: string }>();

      if (asset) {
        const obj = await env.ARTIFACTS.get(asset.r2_key);
        if (obj) {
          html = await obj.text();
        }
      }
    }

    // Get user's draft if exists
    const draft = await env.DB.prepare(`
      SELECT id, html_content, updated_at
      FROM artifact_drafts
      WHERE artifact_id = ? AND user_id = ?
    `).bind(artifactId, ctx.userId).first<{
      id: string;
      html_content: string;
      updated_at: string;
    }>();

    // Get active editor sessions (collaborators)
    const sessions = await env.DB.prepare(`
      SELECT user_id, user_name, user_avatar, user_color,
             cursor_x, cursor_y, selected_element, last_active
      FROM editor_sessions
      WHERE artifact_id = ? AND last_active > strftime('%Y-%m-%dT%H:%M:%fZ','now', '-5 minutes')
    `).bind(artifactId).all();

    const collaborators = sessions.results?.map((s: any) => ({
      userId: s.user_id,
      userName: s.user_name,
      userAvatar: s.user_avatar,
      userColor: s.user_color,
      cursor: s.cursor_x != null ? { x: s.cursor_x, y: s.cursor_y } : undefined,
      selectedElement: s.selected_element,
      isTyping: false,
      lastActive: new Date(s.last_active).getTime(),
    })) || [];

    // Get assets for this version
    const assets = artifact.version_id ? await env.DB.prepare(`
      SELECT id, path, r2_key, mime, size_bytes
      FROM assets
      WHERE version_id = ?
    `).bind(artifact.version_id).all() : { results: [] };

    const assetRefs = assets.results?.map((a: any) => ({
      id: a.id,
      path: a.path,
      url: `/a/${artifact.slug}/${a.path}`,
      mime: a.mime,
      size: a.size_bytes,
    })) || [];

    const editorHtml = draft?.html_content || html;
    console.log('[Editor:server] load', {
      artifactId,
      userId: ctx.userId,
      htmlBytes: editorHtml.length,
      hasDraft: !!draft,
      collaboratorCount: collaborators.length,
      assetCount: assetRefs.length,
    });

    return new Response(JSON.stringify({
      success: true,
      editor: {
        artifactId: artifact.id,
        name: artifact.name,
        slug: artifact.slug,
        html: editorHtml,
        versionNo: artifact.version_no || 0,
        hasDraft: !!draft,
        draftUpdatedAt: draft?.updated_at,
        assets: assetRefs,
        collaborators,
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Editor:server] load failed', { artifactId, error });
    return errorResponse('INTERNAL_ERROR', 'Failed to load editor', 500);
  }
}

async function handleRollback(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, env } = ctx;

  try {
    const body = await request.json() as { versionId: string };
    const { versionId } = body;

    if (!versionId) {
      return errorResponse('INVALID_REQUEST', 'versionId required', 400);
    }

    // Get version info
    const version = await env.DB.prepare(`
      SELECT id, artifact_id, entrypoint FROM versions WHERE id = ?
    `).bind(versionId).first<{
      id: string;
      artifact_id: string;
      entrypoint: string;
    }>();

    if (!version || version.artifact_id !== artifactId) {
      return errorResponse('VERSION_NOT_FOUND', 'Version not found', 404);
    }

    // Get HTML from that version
    const asset = await env.DB.prepare(`
      SELECT r2_key FROM assets WHERE version_id = ? AND path = ?
    `).bind(versionId, version.entrypoint).first<{ r2_key: string }>();

    if (!asset) {
      return errorResponse('ASSET_NOT_FOUND', 'Version content not found', 404);
    }

    const obj = await env.ARTIFACTS.get(asset.r2_key);
    if (!obj) {
      return errorResponse('ASSET_NOT_FOUND', 'Version content not found', 404);
    }

    const html = await obj.text();

    // Save as new draft
    const draftId = `draft_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await env.DB.prepare(`
      INSERT INTO artifact_drafts (id, artifact_id, user_id, html_content)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(artifact_id, user_id) DO UPDATE SET
        html_content = excluded.html_content,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).bind(draftId, artifactId, ctx.userId, html).run();

    return new Response(JSON.stringify({
      success: true,
      html,
      message: `Rolled back to version ${versionId}`,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error rolling back:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to rollback', 500);
  }
}

async function handleDetectComponents(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  try {
    const body = await request.json() as { html: string };

    if (!body.html) {
      return errorResponse('INVALID_REQUEST', 'html required', 400);
    }

    const detected = detectComponents(body.html);

    return new Response(JSON.stringify({
      success: true,
      components: detected,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error detecting components:', error);
    return errorResponse('INTERNAL_ERROR', 'Detection failed', 500);
  }
}

// Serve editor page HTML
export async function serveEditorPage(
  request: Request,
  artifactId: string,
  slug: string,
  env: Env,
  name?: string | null,
  description?: string | null,
  user?: { userId: string; userName: string; userAvatar?: string }
): Promise<Response> {
  const html = generateEditorPage({
    artifactId,
    slug,
    // Always this instance origin — never hardcode a founder host for self-host.
    baseUrl: getPlatformOrigin(env),
    name: name || undefined,
    description: description || undefined,
    userId: user?.userId,
    userName: user?.userName,
    userAvatar: user?.userAvatar,
    openVisDisabled: openVisibilityDisabled(env),
    // Soft signal for the Agent pane — never send keys to the client.
    aiEnabled: !!getAIProvider(env),
  });
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({
    success: false,
    error: message,
    code,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
