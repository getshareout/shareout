import { getPlatformHostname } from '../config/origins';
import PostalMime from 'postal-mime';
import type { Env } from '../types';
import { sha256 } from '../crypto-utils';
import { getOrCreateAssetBucket } from '../assets/bucket';
import { ingestBlobDirect } from '../data/blobs/handler';
import { getLinkedChatId } from '../telegram/linking';
import { sendMessage } from '../telegram/client';
import { bareEmail, parseAuthResults } from './inbound';

const MAX_RAW_BYTES = 25 * 1024 * 1024;
const BODY_TEXT_CAP = 10_000;

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
}

/** Inbound mail to `{workspace-slug}@inbox.shareout.site`. Members only; attachments
 *  land in the sender's workspace asset bucket with blob_origins provenance. */
export async function handleWorkspaceInbound(
  message: ForwardableEmailMessage,
  env: Env,
  workspace: WorkspaceRow,
): Promise<void> {
  if (message.rawSize > MAX_RAW_BYTES) return;

  const auth = parseAuthResults(message.headers);
  if (auth.dmarc === 'fail' && auth.dkim === 'fail') {
    message.setReject('Failed authentication');
    return;
  }

  const senderEmail = bareEmail(message.from);
  const member = await env.DB.prepare(`
    SELECT u.id FROM users u
    JOIN workspace_members wm ON wm.user_id = u.id
    WHERE wm.workspace_id = ? AND lower(u.email) = ?
    LIMIT 1
  `).bind(workspace.id, senderEmail).first<{ id: string }>();
  if (!member) return;

  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(rawBuffer);

  const rawMessageId = email.messageId || message.headers.get('message-id') || null;
  const rfcMessageId = rawMessageId ? rawMessageId.replace(/^<|>$/g, '') : null;
  const dedupeKey = rfcMessageId || `sha256:${await sha256(rawBuffer)}`;

  const dup = await env.DB.prepare(
    'SELECT 1 FROM blob_origins WHERE email_message_id = ? LIMIT 1'
  ).bind(dedupeKey).first();
  if (dup) return;

  const attachments = email.attachments || [];
  if (!attachments.length) return;

  const bucket = await getOrCreateAssetBucket(env, member.id, workspace.id);
  const subject = email.subject || null;
  const bodyText = (email.text || '').slice(0, BODY_TEXT_CAP);
  const now = new Date().toISOString();
  const ingested: { blobId: string; filename: string; priorArtifact: string | null }[] = [];

  for (const att of attachments) {
    const bytes =
      typeof att.content === 'string'
        ? new TextEncoder().encode(att.content)
        : new Uint8Array(att.content as ArrayBuffer);
    const filename = att.filename || `attachment-${ingested.length + 1}`;
    const result = await ingestBlobDirect(env, bucket.id, {
      filename,
      mimeType: att.mimeType || undefined,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    if (!result.ok || !result.blobId) continue;

    await env.DB.prepare(`
      INSERT INTO blob_origins (blob_id, source, sender, subject, body_text, email_message_id, created_at)
      VALUES (?, 'email', ?, ?, ?, ?, ?)
    `).bind(result.blobId, senderEmail, subject, bodyText || null, dedupeKey, now).run();

    const prior = await env.DB.prepare(`
      SELECT a.name FROM blobs b
      JOIN blob_artifact_links l ON l.blob_id = b.id
      JOIN artifacts a ON a.id = l.artifact_id
      JOIN asset_buckets ab ON ab.artifact_id = b.artifact_id
      WHERE ab.workspace_id = ? AND b.filename = ? AND b.id != ? AND a.deleted_at IS NULL
      LIMIT 1
    `).bind(workspace.id, filename, result.blobId).first<{ name: string }>();

    ingested.push({ blobId: result.blobId, filename, priorArtifact: prior?.name ?? null });
  }

  if (!ingested.length) return;

  await notifyWorkspaceFileReceived(env, workspace, senderEmail, ingested);
}

async function notifyWorkspaceFileReceived(
  env: Env,
  workspace: WorkspaceRow,
  sender: string,
  files: { blobId: string; filename: string; priorArtifact: string | null }[],
): Promise<void> {
  // This link is emailed to the workspace's own members. Hardcoded to the hosted
  // domain it sent a self-hoster's team to someone else's instance.
  const homeUrl = `https://${workspace.slug}.${getPlatformHostname(env)}/home`;
  const fileList = files.map(f => f.filename).join(', ');
  const updateHint = files.find(f => f.priorArtifact);
  let text = `Received ${fileList} from ${sender} in ${workspace.name}.\n\nOpen chat: ${homeUrl}`;
  if (updateHint?.priorArtifact) {
    text += `\n\nThis file previously built "${updateHint.priorArtifact}" — ask me to update it.`;
  }

  const admins = await env.DB.prepare(`
    SELECT u.id FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ? AND wm.role IN ('owner', 'admin')
  `).bind(workspace.id).all<{ id: string }>();

  await Promise.allSettled((admins.results || []).map(async (a) => {
    const chatId = await getLinkedChatId(env, a.id);
    if (chatId != null) await sendMessage(env, chatId, text);
  }));
}
