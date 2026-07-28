import { generateId } from '../../crypto-utils';
import {
  MAX_FILE_SIZE,
  MAX_ARTIFACT_STORAGE,
  isAllowedMimeType,
  validateFilename,
} from '../../data/blobs/handler';
import { blobPublicUrl } from './ids';
import { dispatchAction } from './dispatch';
import { errorResponse, jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

// Blobs live in the shared-D1 `blobs` table + `artifact_storage` quota — NOT the
// never-created `artifact_blobs`. Reuses the validators/accounting from
// src/data/blobs/handler.ts so editor uploads match the SDK upload path.

export const handleBlobsEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;

  return dispatchAction(action, {
    get: async () => {
      const blobs = await env.DB.prepare(`
        SELECT id, filename, mime_type, size_bytes, created_at
        FROM blobs WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 100
      `).bind(artifactId).all<{
        id: string;
        filename: string;
        mime_type: string;
        size_bytes: number;
        created_at: string;
      }>();

      return jsonResponse({
        success: true,
        files: (blobs.results || []).map((b) => ({
          id: b.id,
          filename: b.filename,
          mime: b.mime_type,
          size: b.size_bytes,
          url: blobPublicUrl(artifactId, b.id),
          createdAt: b.created_at,
        })),
      });
    },

    upload: async () => {
      const formData = await request.formData();
      const file = formData.get('file') as unknown as File | null;
      if (!file || typeof file.arrayBuffer !== 'function') {
        return errorResponse('INVALID_REQUEST', 'file required', 400);
      }
      const f = file;

      const filenameError = validateFilename(f.name);
      if (filenameError) return errorResponse('INVALID_FILENAME', filenameError, 400);
      if (!isAllowedMimeType(f.type)) {
        return errorResponse('MIME_NOT_ALLOWED', `File type not allowed: ${f.type || 'unknown'}`, 400);
      }
      if (f.size > MAX_FILE_SIZE) {
        return errorResponse('FILE_TOO_LARGE', `File exceeds ${MAX_FILE_SIZE / 1_000_000}MB`, 400);
      }

      const storage = await env.DB.prepare(
        'SELECT used_bytes FROM artifact_storage WHERE artifact_id = ?'
      ).bind(artifactId).first<{ used_bytes: number }>();
      if ((storage?.used_bytes ?? 0) + f.size > MAX_ARTIFACT_STORAGE) {
        return errorResponse(
          'STORAGE_LIMIT_EXCEEDED',
          `Adding this file would exceed the ${MAX_ARTIFACT_STORAGE / 1_000_000}MB artifact storage limit`,
          400,
        );
      }

      const blobId = generateId('blob');
      const r2Key = `${artifactId}/blobs/${blobId}/${f.name}`;
      await env.ARTIFACTS.put(r2Key, await f.arrayBuffer(), {
        httpMetadata: { contentType: f.type },
      });

      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(blobId, artifactId, f.name, f.type, r2Key, f.size, now),
        env.DB.prepare(
          `INSERT INTO artifact_storage (artifact_id, used_bytes, blob_count, updated_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(artifact_id) DO UPDATE SET
             used_bytes = used_bytes + ?,
             blob_count = blob_count + 1,
             updated_at = ?`
        ).bind(artifactId, f.size, now, f.size, now),
      ]);

      return jsonResponse({ success: true, id: blobId, url: blobPublicUrl(artifactId, blobId) });
    },

    delete: async () => {
      let body: { id?: string };
      try {
        body = await request.json() as { id?: string };
      } catch {
        return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      }
      if (!body.id) return errorResponse('INVALID_REQUEST', 'id required', 400);

      const blob = await env.DB.prepare(
        'SELECT r2_key, size_bytes FROM blobs WHERE id = ? AND artifact_id = ?'
      ).bind(body.id, artifactId).first<{ r2_key: string; size_bytes: number }>();

      if (blob) {
        await env.ARTIFACTS.delete(blob.r2_key);
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare('DELETE FROM blobs WHERE id = ? AND artifact_id = ?').bind(body.id, artifactId),
          env.DB.prepare(
            `UPDATE artifact_storage SET
               used_bytes = MAX(0, used_bytes - ?),
               blob_count = MAX(0, blob_count - 1),
               updated_at = ?
             WHERE artifact_id = ?`
          ).bind(blob.size_bytes, now, artifactId),
        ]);
      }

      return jsonResponse({ success: true });
    },
  });
};
