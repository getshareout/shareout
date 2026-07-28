// ShareOut Visual Editor - Draft Management

import { getPlatformOrigin } from '../config/origins';
import type { EditorContext } from './index';
import { generateId, sha256 } from '../crypto-utils';
import { invalidateDeploymentCache } from '../serve/deployment-cache';
import { shouldBlockPublish, runPostPublishTests } from '../tests/block-gate';

export async function handleDraft(
  request: Request,
  ctx: EditorContext,
  method: string
): Promise<Response> {
  switch (method) {
    case 'GET':
      return getDraft(ctx);
    case 'POST':
      return saveDraft(request, ctx);
    case 'DELETE':
      return deleteDraft(ctx);
    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  }
}

async function getDraft(ctx: EditorContext): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const draft = await env.DB.prepare(`
      SELECT id, html_content, assets_json, created_at, updated_at
      FROM artifact_drafts
      WHERE artifact_id = ? AND user_id = ?
    `).bind(artifactId, userId).first<{
      id: string;
      html_content: string;
      assets_json: string | null;
      created_at: string;
      updated_at: string;
    }>();

    if (!draft) {
      return new Response(JSON.stringify({
        success: true,
        draft: null,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      draft: {
        id: draft.id,
        html: draft.html_content,
        assets: draft.assets_json ? JSON.parse(draft.assets_json) : [],
        createdAt: draft.created_at,
        updatedAt: draft.updated_at,
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting draft:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to get draft', 500);
  }
}

async function saveDraft(request: Request, ctx: EditorContext): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const body = await request.json() as {
      html: string;
      cursorPosition?: { x: number; y: number };
      baseUpdatedAt?: string;
    };

    if (!body.html) {
      return errorResponse('INVALID_REQUEST', 'html content required', 400);
    }

    // Optimistic concurrency (EDIT-09 F1): when the client sends the timestamp it loaded, only
    // write if the stored draft still matches. Otherwise another tab / device / the AI agent
    // saved since, and an unconditional UPSERT would silently clobber that work.
    if (body.baseUpdatedAt) {
      const current = await env.DB.prepare(`
        SELECT updated_at FROM artifact_drafts WHERE artifact_id = ? AND user_id = ?
      `).bind(artifactId, userId).first<{ updated_at: string }>();
      if (current && current.updated_at !== body.baseUpdatedAt) {
        return new Response(JSON.stringify({
          success: false,
          code: 'DRAFT_CONFLICT',
          currentUpdatedAt: current.updated_at,
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const draftId = `draft_${generateId('draft').slice(6)}`;

    await env.DB.prepare(`
      INSERT INTO artifact_drafts (id, artifact_id, user_id, html_content)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(artifact_id, user_id) DO UPDATE SET
        html_content = excluded.html_content,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).bind(draftId, artifactId, userId, body.html).run();

    // Read back the new timestamp so the client can advance its base for the next save.
    const saved = await env.DB.prepare(`
      SELECT updated_at FROM artifact_drafts WHERE artifact_id = ? AND user_id = ?
    `).bind(artifactId, userId).first<{ updated_at: string }>();

    // Update editor session if cursor position provided
    if (body.cursorPosition) {
      await updateEditorSession(ctx, {
        cursorX: body.cursorPosition.x,
        cursorY: body.cursorPosition.y,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      draftId,
      savedAt: new Date().toISOString(),
      draftUpdatedAt: saved?.updated_at,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to save draft', 500);
  }
}

async function deleteDraft(ctx: EditorContext): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    await env.DB.prepare(`
      DELETE FROM artifact_drafts
      WHERE artifact_id = ? AND user_id = ?
    `).bind(artifactId, userId).run();

    return new Response(JSON.stringify({
      success: true,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting draft:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to delete draft', 500);
  }
}

export async function handlePublish(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const body = await request.json() as {
      html: string;
      commitMessage?: string;
      baseUpdatedAt?: string;
    };

    if (!body.html) {
      return errorResponse('INVALID_REQUEST', 'html content required', 400);
    }

    // Optimistic concurrency (EDIT-09 F1): publishing deletes this user's draft and ships
    // body.html live. If another tab/device/agent saved since the client loaded, refuse
    // rather than clobber the newer draft and publish stale HTML. `force` omits the base.
    if (body.baseUpdatedAt) {
      const current = await env.DB.prepare(`
        SELECT updated_at FROM artifact_drafts WHERE artifact_id = ? AND user_id = ?
      `).bind(artifactId, userId).first<{ updated_at: string }>();
      if (current && current.updated_at !== body.baseUpdatedAt) {
        return new Response(JSON.stringify({
          success: false,
          code: 'DRAFT_CONFLICT',
          currentUpdatedAt: current.updated_at,
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Get artifact info. The routing slug (deployments.slug) drives canonical
    // /a/<slug> + caches and may be suffixed if the human slug collides across
    // workspaces — fall back to the human slug only if no deployment exists yet.
    const artifact = await env.DB.prepare(`
      SELECT a.id, a.name, a.workspace_id, COALESCE(d.slug, a.slug) AS slug
      FROM artifacts a
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.id = ?
    `).bind(artifactId).first<{ id: string; name: string; workspace_id: string | null; slug: string }>();

    if (!artifact) {
      return errorResponse('ARTIFACT_NOT_FOUND', 'Artifact not found', 404);
    }

    // Artifact Tests BLOCK gate: when tests are set to block and a passing baseline
    // exists, stage this version on the 'candidate' channel and keep serving the live
    // version; it's promoted asynchronously only if its tests pass. Otherwise it goes
    // live immediately (monitor / first publish — never goes dark). See specs §3, §11.
    const blocking = await shouldBlockPublish(env, artifactId);
    const channel = blocking ? 'candidate' : 'production';

    // Get current version number
    const currentVersion = await env.DB.prepare(`
      SELECT MAX(version_no) as max_version FROM versions WHERE artifact_id = ?
    `).bind(artifactId).first<{ max_version: number | null }>();

    const newVersionNo = (currentVersion?.max_version || 0) + 1;
    const versionId = generateId('ver');
    const assetId = generateId('ast');
    const deploymentId = generateId('dep');

    // Store HTML in R2 with a real content hash (integrity/dedup parity with the
    // canonical publish path, src/publish.ts).
    const bytes = new TextEncoder().encode(body.html);
    const hash = await sha256(bytes.buffer as ArrayBuffer);
    const r2Key = `${artifactId}/${versionId}/index.html`;
    await env.ARTIFACTS.put(r2Key, body.html, {
      httpMetadata: { contentType: 'text/html' },
      customMetadata: { sha256: hash },
    });

    // Version + asset + deployment + draft-clear in one transaction: a mid-write
    // failure can't leave an orphaned R2 object alongside half-written rows, and a
    // concurrent publish at the same version_no fails the whole batch (UNIQUE)
    // instead of corrupting state.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at)
         VALUES (?, ?, ?, 'index.html', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      ).bind(versionId, artifactId, newVersionNo),
      env.DB.prepare(
        `INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
         VALUES (?, ?, 'index.html', ?, 'text/html', ?, ?)`
      ).bind(assetId, versionId, r2Key, bytes.length, hash),
      env.DB.prepare(
        `INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(artifact_id, channel) DO UPDATE SET
           version_id = excluded.version_id,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      ).bind(deploymentId, artifactId, versionId, channel, artifact.slug),
      env.DB.prepare(
        `DELETE FROM artifact_drafts WHERE artifact_id = ? AND user_id = ?`
      ).bind(artifactId, userId),
    ]);

    // Only the production pointer is cached; a candidate stage leaves it untouched.
    if (!blocking) {
      await invalidateDeploymentCache(env, artifact.slug, artifactId);
    }

    // Run the safety net off the response (block gate promotes the candidate on pass;
    // monitor just flags failures). No-op unless tests are enabled.
    const testRun = runPostPublishTests(
      env, artifactId, artifact.workspace_id ?? '', versionId, artifact.slug, blocking,
    ).catch(() => {});
    if (ctx.waitUntil) ctx.waitUntil(testRun); else await testRun;

    return new Response(JSON.stringify({
      success: true,
      versionId,
      versionNo: newVersionNo,
      // Returned to the editor as "your page is live at …". Hardcoded, it sent the
      // author to another instance for a page that only exists on theirs.
      url: `${getPlatformOrigin(env)}/a/${artifact.slug}/`,
      ...(blocking ? { tests: { mode: 'block', pending: true } } : {}),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error publishing:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to publish', 500);
  }
}

export async function handleHistory(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, env } = ctx;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  try {
    const versions = await env.DB.prepare(`
      SELECT v.id, v.version_no, v.created_at, v.entrypoint
      FROM versions v
      WHERE v.artifact_id = ?
      ORDER BY v.version_no DESC
      LIMIT ? OFFSET ?
    `).bind(artifactId, limit, offset).all();

    const total = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM versions WHERE artifact_id = ?
    `).bind(artifactId).first<{ count: number }>();

    return new Response(JSON.stringify({
      success: true,
      versions: versions.results?.map((v: any) => ({
        versionId: v.id,
        versionNo: v.version_no,
        createdAt: v.created_at,
        entrypoint: v.entrypoint,
      })) || [],
      total: total?.count || 0,
      limit,
      offset,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting history:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to get history', 500);
  }
}

export async function handleUpload(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, env } = ctx;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return errorResponse('INVALID_REQUEST', 'No file provided', 400);
    }

    // Validate file type
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp',
      'application/pdf',
    ];

    if (!allowedTypes.includes(file.type)) {
      return errorResponse('INVALID_FILE_TYPE', 'File type not allowed', 400);
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return errorResponse('FILE_TOO_LARGE', 'File too large (max 10MB)', 400);
    }

    const assetId = generateId('upl');
    const ext = file.name.split('.').pop() || 'bin';
    const r2Key = `uploads/${artifactId}/${assetId}.${ext}`;

    // Upload to R2
    await env.ARTIFACTS.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    // This URL is embedded into the artifact HTML by the editor. Hardcoded, every
    // image uploaded on a self-hosted instance pointed at a host that does not have
    // the file — the bytes were just PUT into *this* instance's R2 — so the images
    // silently broke.
    const url = `${getPlatformOrigin(env)}/uploads/${artifactId}/${assetId}.${ext}`;

    return new Response(JSON.stringify({
      success: true,
      assetId,
      url,
      filename: file.name,
      mime: file.type,
      size: file.size,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error uploading:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to upload', 500);
  }
}

async function updateEditorSession(
  ctx: EditorContext,
  updates: {
    cursorX?: number;
    cursorY?: number;
    selectedElement?: string;
  }
): Promise<void> {
  const { artifactId, userId, userName, userAvatar, env } = ctx;

  const sessionId = `session_${generateId('ses').slice(8)}`;

  await env.DB.prepare(`
    INSERT INTO editor_sessions (id, artifact_id, user_id, user_name, user_avatar, user_color, cursor_x, cursor_y, selected_element, last_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, user_id) DO UPDATE SET
      cursor_x = COALESCE(excluded.cursor_x, cursor_x),
      cursor_y = COALESCE(excluded.cursor_y, cursor_y),
      selected_element = COALESCE(excluded.selected_element, selected_element),
      last_active = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(
    sessionId,
    artifactId,
    userId,
    userName,
    userAvatar || null,
    getRandomColor(),
    updates.cursorX ?? null,
    updates.cursorY ?? null,
    updates.selectedElement ?? null
  ).run();
}

function getRandomColor(): string {
  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
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
