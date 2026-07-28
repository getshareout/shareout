import type { Env } from '../types';
import { getSessionUser } from '../auth/session';
import { hostWorkspaceId } from '../pages/home/host';
import { getOrCreateAssetBucket } from '../assets/bucket';
import { ingestBlobDirect } from '../data/blobs/handler';

type BlobOriginSource = 'email' | 'chat' | 'share_target';

/** Record provenance for a blob the caller already owns in their asset bucket. */
export async function writeBlobOrigin(
  env: Env,
  blobId: string,
  source: BlobOriginSource,
  extra: { sender?: string | null; subject?: string | null; body_text?: string | null; email_message_id?: string | null } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO blob_origins (blob_id, source, sender, subject, body_text, email_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(blob_id) DO NOTHING
  `).bind(
    blobId,
    source,
    extra.sender ?? null,
    extra.subject ?? null,
    extra.body_text ?? null,
    extra.email_message_id ?? null,
    now,
  ).run();
}

/** PWA Web Share Target entry — authenticated users only. */
export async function handleShareTarget(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const home = `${url.origin}/home`;

  if (request.method !== 'POST') {
    return Response.redirect(home, 303);
  }

  const user = await getSessionUser(request, env);
  if (!user) {
    return Response.redirect(home, 303);
  }

  const form = await request.formData();
  let file: File | null = null;
  const direct = form.get('files') as unknown;
  if (direct && typeof (direct as File).arrayBuffer === 'function' && (direct as File).size > 0) {
    file = direct as File;
  }
  if (!file) {
    for (const val of form.values()) {
      if (typeof (val as File).arrayBuffer === 'function' && (val as File).size > 0) { file = val as File; break; }
    }
  }
  if (!file) {
    return Response.redirect(home, 303);
  }

  const wsId = await hostWorkspaceId(request, env);
  const bucket = await getOrCreateAssetBucket(env, user.id, wsId);
  const bytes = await file.arrayBuffer();
  const result = await ingestBlobDirect(env, bucket.id, {
    filename: file.name || 'shared-file',
    mimeType: file.type || undefined,
    bytes,
  });
  if (!result.ok || !result.blobId) {
    return Response.redirect(home, 303);
  }

  await writeBlobOrigin(env, result.blobId, 'share_target');

  const dest = new URL(home, url.origin);
  dest.searchParams.set('chat_file', result.blobId);
  dest.searchParams.set('chat_name', file.name || 'file');
  return Response.redirect(dest.toString(), 303);
}
