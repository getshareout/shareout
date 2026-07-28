import type { Env } from '../types';
import { DATA_ERRORS } from '../types';
import { generateId } from '../crypto-utils';
import { successResponse, errorResponse, type DataContext } from './middleware';
import { Errors } from './errors';
import { bustViewerConfigCache, VIEWER_CONFIG_KEY } from './viewer-config';

const MAX_KEY_LENGTH = 256;
const MAX_VALUE_SIZE = 1_000_000;
const MAX_KEYS_PER_ARTIFACT = 1000;
const KEY_PATTERN = /^[a-zA-Z0-9_\-\.]+$/;

export async function handleJsonStore(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  // The JSON store is key/value with no row field to scope on. When a row-level
  // access policy is active and the viewer is non-owner (ctx.viewerScope is set),
  // the store is owner/editor-only — viewers cannot read or write it, so per-tenant
  // data accidentally placed here can never leak. Put viewer-visible per-tenant
  // data in sdk.table() (which IS policy-filtered) instead.
  if (ctx.viewerScope) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      hint: 'This artifact has a row-level access policy; the JSON store is restricted to owners/editors.',
      suggestion: 'Store per-viewer data in sdk.table(), which is filtered by the access policy.',
    }, ctx.origin);
  }

  const key = path.slice(1) || undefined;
  const method = request.method;

  switch (method) {
    case 'GET':
      return key ? getKey(ctx, key) : listKeys(ctx);
    case 'HEAD':
      if (!key) {
        return errorResponse(Errors.missingParam('key', 'user_settings'), ctx.origin);
      }
      return checkExists(ctx, key);
    case 'PUT':
      if (!key) {
        return errorResponse(Errors.missingParam('key', 'user_settings'), ctx.origin);
      }
      return setKey(request, ctx, key);
    case 'DELETE':
      return key ? deleteKey(ctx, key) : clearAll(ctx);
    default:
      return errorResponse(Errors.methodNotAllowed(method, ['GET', 'HEAD', 'PUT', 'DELETE']), ctx.origin);
  }
}

function validateKey(key: string): string | null {
  if (!key) return 'Key is required';
  if (key.length > MAX_KEY_LENGTH) return `Key too long (max ${MAX_KEY_LENGTH} chars)`;
  if (!KEY_PATTERN.test(key)) return 'Key contains invalid characters (allowed: a-z, A-Z, 0-9, _, -, .)';
  return null;
}

async function listKeys(ctx: DataContext): Promise<Response> {
  const result = await ctx.db.prepare(
    'SELECT key FROM artifact_json WHERE artifact_id = ? ORDER BY key'
  ).bind(ctx.artifactId).all<{ key: string }>();

  return successResponse({
    keys: result.results.map(r => r.key),
    count: result.results.length
  }, 200, ctx.origin);
}

async function getKey(ctx: DataContext, key: string): Promise<Response> {
  const keyError = validateKey(key);
  if (keyError) {
    return errorResponse({
      ...DATA_ERRORS.KEY_INVALID,
      message: keyError,
      hint: `"${key}" is not a valid key.`,
    }, ctx.origin);
  }

  const row = await ctx.db.prepare(
    'SELECT key, value, updated_at FROM artifact_json WHERE artifact_id = ? AND key = ?'
  ).bind(ctx.artifactId, key).first<{ key: string; value: string; updated_at: string }>();

  if (!row) {
    return errorResponse({
      ...DATA_ERRORS.KEY_NOT_FOUND,
      hint: `Key "${key}" does not exist.`,
      suggestion: 'Use GET /json to list all keys, or HEAD /json/{key} to check existence.',
    }, ctx.origin);
  }

  return successResponse({
    key: row.key,
    value: JSON.parse(row.value),
    updatedAt: row.updated_at
  }, 200, ctx.origin);
}

async function checkExists(ctx: DataContext, key: string): Promise<Response> {
  const keyError = validateKey(key);
  if (keyError) {
    return new Response(null, { status: 400 });
  }

  const row = await ctx.db.prepare(
    'SELECT 1 FROM artifact_json WHERE artifact_id = ? AND key = ?'
  ).bind(ctx.artifactId, key).first();

  return new Response(null, { status: row ? 200 : 404 });
}

async function setKey(request: Request, ctx: DataContext, key: string): Promise<Response> {
  const keyError = validateKey(key);
  if (keyError) {
    return errorResponse({
      ...DATA_ERRORS.KEY_INVALID,
      message: keyError,
      hint: `"${key}" is not a valid key.`,
    }, ctx.origin);
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  if (value === undefined) {
    return errorResponse(Errors.missingParam('value', '{ "setting": true }'), ctx.origin);
  }

  // Compare-and-swap for concurrent editors / counters (sdk.json.update).
  const ifMatch = request.headers.get('If-Match') || undefined;
  const ifNoneMatch = request.headers.get('If-None-Match');
  const ifNoneMatchStar = ifNoneMatch === '*';

  return writeJsonValue(ctx, key, value, { ifMatch, ifNoneMatchStar });
}

export interface JsonWriteOptions {
  /** Require existing row with this exact updated_at (HTTP If-Match). */
  ifMatch?: string;
  /** Require that the key does not exist yet (HTTP If-None-Match: *). */
  ifNoneMatchStar?: boolean;
}

// Core write shared by the HTTP handler (setKey) and the account bot (botSetJson).
// Assumes `key` is already validated and `value` is defined.
async function writeJsonValue(
  ctx: DataContext,
  key: string,
  value: unknown,
  opts: JsonWriteOptions = {},
): Promise<Response> {
  const jsonValue = JSON.stringify(value);
  const sizeBytes = new TextEncoder().encode(jsonValue).length;

  if (sizeBytes > MAX_VALUE_SIZE) {
    return errorResponse({
      ...DATA_ERRORS.VALUE_TOO_LARGE,
      hint: `Value size: ${(sizeBytes / 1000).toFixed(1)}KB exceeds limit of ${MAX_VALUE_SIZE / 1000}KB.`,
      suggestion: 'Split large data across multiple keys, or use blobs for binary data.',
    }, ctx.origin);
  }

  const [existingRes, countRes] = await ctx.db.batch([
    {
      sql: 'SELECT id, updated_at FROM artifact_json WHERE artifact_id = ? AND key = ?',
      bindings: [ctx.artifactId, key],
      mode: 'first',
    },
    {
      sql: 'SELECT COUNT(*) as count FROM artifact_json WHERE artifact_id = ?',
      bindings: [ctx.artifactId],
      mode: 'first',
    },
  ]);
  const existing = (existingRes.result ?? null) as { id: string; updated_at: string } | null;
  const keyCount = (countRes.result ?? null) as { count: number } | null;

  const now = new Date().toISOString();

  if (existing) {
    if (opts.ifNoneMatchStar) {
      return errorResponse({
        ...DATA_ERRORS.VERSION_CONFLICT,
        hint: `Key "${key}" already exists (If-None-Match: *).`,
        suggestion: 'Re-read the key and retry with If-Match, or use sdk.json.update().',
      }, ctx.origin);
    }
    if (opts.ifMatch !== undefined && existing.updated_at !== opts.ifMatch) {
      return errorResponse({
        ...DATA_ERRORS.VERSION_CONFLICT,
        hint: `Expected updatedAt ${opts.ifMatch}, current is ${existing.updated_at}.`,
        suggestion: 'Re-read with getEntry() and retry, or use sdk.json.update().',
      }, ctx.origin);
    }

    // Conditional UPDATE so a race between the SELECT and this write still fails closed.
    if (opts.ifMatch !== undefined) {
      const result = await ctx.db.prepare(
        'UPDATE artifact_json SET value = ?, size_bytes = ?, updated_at = ? WHERE id = ? AND updated_at = ?',
      ).bind(jsonValue, sizeBytes, now, existing.id, opts.ifMatch).run();
      if (!result.meta.changes) {
        return errorResponse({
          ...DATA_ERRORS.VERSION_CONFLICT,
          hint: `Key "${key}" changed during the write.`,
          suggestion: 'Re-read with getEntry() and retry, or use sdk.json.update().',
        }, ctx.origin);
      }
    } else {
      await ctx.db.prepare(
        'UPDATE artifact_json SET value = ?, size_bytes = ?, updated_at = ? WHERE id = ?',
      ).bind(jsonValue, sizeBytes, now, existing.id).run();
    }

    if (key === VIEWER_CONFIG_KEY) {
      await bustViewerConfigCache(ctx.env, ctx.artifactId);
    }

    return successResponse({ key, created: false, updatedAt: now }, 200, ctx.origin);
  }

  // No existing row
  if (opts.ifMatch !== undefined) {
    return errorResponse({
      ...DATA_ERRORS.VERSION_CONFLICT,
      hint: `Key "${key}" does not exist; If-Match cannot succeed.`,
      suggestion: 'Create without If-Match, or use sdk.json.update() which handles first write.',
    }, ctx.origin);
  }

  if (keyCount && keyCount.count >= MAX_KEYS_PER_ARTIFACT) {
    return errorResponse({
      ...DATA_ERRORS.KEY_LIMIT_EXCEEDED,
      hint: `Current key count: ${keyCount.count}/${MAX_KEYS_PER_ARTIFACT}.`,
    }, ctx.origin);
  }

  const id = generateId('jsn');
  if (opts.ifNoneMatchStar) {
    // Create-only: fail if another writer inserted the same key first.
    try {
      await ctx.db.prepare(
        `INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, ctx.artifactId, key, jsonValue, sizeBytes, now, now).run();
    } catch {
      return errorResponse({
        ...DATA_ERRORS.VERSION_CONFLICT,
        hint: `Key "${key}" was created concurrently (If-None-Match: *).`,
        suggestion: 'Re-read and retry with If-Match, or use sdk.json.update().',
      }, ctx.origin);
    }
  } else {
    // Unconditional upsert for plain PUT (backward compatible).
    await ctx.db.prepare(
      `INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(artifact_id, key) DO UPDATE SET value = excluded.value, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`,
    ).bind(id, ctx.artifactId, key, jsonValue, sizeBytes, now, now).run();
  }

  if (key === VIEWER_CONFIG_KEY) {
    await bustViewerConfigCache(ctx.env, ctx.artifactId);
  }

  return successResponse({ key, created: true, updatedAt: now }, 201, ctx.origin);
}

async function deleteKey(ctx: DataContext, key: string): Promise<Response> {
  const keyError = validateKey(key);
  if (keyError) {
    return errorResponse({
      ...DATA_ERRORS.KEY_INVALID,
      message: keyError,
      hint: `"${key}" is not a valid key.`,
    }, ctx.origin);
  }

  const result = await ctx.db.prepare(
    'DELETE FROM artifact_json WHERE artifact_id = ? AND key = ? RETURNING id'
  ).bind(ctx.artifactId, key).first();

  if (!result) {
    return errorResponse({
      ...DATA_ERRORS.KEY_NOT_FOUND,
      hint: `Key "${key}" does not exist or was already deleted.`,
      suggestion: 'Use GET /json to list all existing keys.',
    }, ctx.origin);
  }

  return successResponse({ deleted: true }, 200, ctx.origin);
}

async function clearAll(ctx: DataContext): Promise<Response> {
  const result = await ctx.db.prepare(
    'DELETE FROM artifact_json WHERE artifact_id = ?'
  ).bind(ctx.artifactId).run();

  return successResponse({ deleted: result.meta.changes }, 200, ctx.origin);
}

// Plain-return wrapper over writeJsonValue for the account bot (src/telegram).
// Mirrors handleJsonStore's guard: the JSON store is owner/editor-only when a
// row-level access policy is active (ctx.viewerScope set).
export async function botSetJson(
  ctx: DataContext,
  key: string,
  value: unknown
): Promise<{ created?: boolean; error?: string }> {
  if (ctx.viewerScope) {
    return { error: 'This page has a row-level access policy; its JSON store is restricted.' };
  }
  const keyError = validateKey(key);
  if (keyError) return { error: keyError };
  if (value === undefined) return { error: 'A value is required.' };

  const res = await writeJsonValue(ctx, key, value);
  const body = (await res.json()) as { success: boolean; data?: { created: boolean }; error?: string };
  if (!res.ok || !body.success) return { error: body.error || 'Write failed.' };
  return { created: body.data?.created };
}
