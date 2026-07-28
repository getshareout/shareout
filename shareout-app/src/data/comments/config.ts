import { generateId } from '../../crypto-utils';
import { successResponse, errorResponse, verifyOwner, type DataContext } from '../middleware';
import { CONFIG_KEY, DEFAULT_CONFIG, type CommentsConfig } from './types';

/** Load comments config from the per-artifact mini-store (ADR 28). */
export async function getConfig(ctx: DataContext): Promise<CommentsConfig> {
  const row = await ctx.db.prepare(
    'SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?'
  ).bind(ctx.artifactId, CONFIG_KEY).first<{ value: string }>();

  if (!row) return DEFAULT_CONFIG;

  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** GET/PUT `/_config` — owner-only writes. */
export async function handleConfig(request: Request, ctx: DataContext): Promise<Response> {
  if (request.method === 'GET') {
    const config = await getConfig(ctx);
    return successResponse(config);
  }

  if (request.method === 'PUT') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) {
      return errorResponse({ code: 'FORBIDDEN', message: 'Only artifact owner can modify config', status: 403 });
    }

    let body: Partial<CommentsConfig>;
    try {
      body = await request.json();
    } catch {
      return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
    }

    const currentConfig = await getConfig(ctx);
    const newConfig: CommentsConfig = {
      enabled: body.enabled ?? currentConfig.enabled,
      identityMode: body.identityMode ?? currentConfig.identityMode,
      allowReplies: body.allowReplies ?? currentConfig.allowReplies,
      maxDepth: body.maxDepth ?? currentConfig.maxDepth,
      overlayEnabled: body.overlayEnabled ?? currentConfig.overlayEnabled,
    };

    if (!['anonymous', 'named', 'authenticated'].includes(newConfig.identityMode)) {
      return errorResponse({ code: 'INVALID_REQUEST', message: 'Invalid identity mode', status: 400 });
    }

    if (newConfig.maxDepth < 1 || newConfig.maxDepth > 10) {
      return errorResponse({ code: 'INVALID_REQUEST', message: 'maxDepth must be between 1 and 10', status: 400 });
    }

    const value = JSON.stringify(newConfig);
    const sizeBytes = value.length;
    const now = new Date().toISOString();
    const existing = await ctx.db.prepare(
      'SELECT id FROM artifact_json WHERE artifact_id = ? AND key = ?'
    ).bind(ctx.artifactId, CONFIG_KEY).first<{ id: string }>();
    if (existing) {
      await ctx.db.prepare(
        'UPDATE artifact_json SET value = ?, size_bytes = ?, updated_at = ? WHERE id = ?'
      ).bind(value, sizeBytes, now, existing.id).run();
    } else {
      await ctx.db.prepare(
        'INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(generateId('jsn'), ctx.artifactId, CONFIG_KEY, value, sizeBytes, now, now).run();
    }

    if (ctx.env.SLUGS) {
      try { await ctx.env.SLUGS.delete(`cmtcfg:${ctx.artifactId}`); } catch {}
    }

    return successResponse(newConfig);
  }

  return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
}
