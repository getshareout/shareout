import type { Env } from '../../types';
import { renderArtifactImage, renderArtifactPdf } from '../../screenshots';
import { getPlatformOrigin } from '../../config/origins';
import {
  buildArtifactUrl,
  openDmChannel,
  postSlackMessage,
  resolveSlackMemberId,
  resolveSlackToken,
  uploadFileToSlack,
  type ArtifactUrlRow,
} from './client';

export type SlackDeliveryMode = 'message' | 'snapshot' | 'pdf' | 'both';

// Slack caps a message at 50 blocks. A header and a link button are added around the
// caller's body, so cap the body below 50 rather than letting Slack reject the post.
const MAX_BODY_BLOCKS = 45;

/** Returns a reason string when `blocks` is unusable, or null when it is fine. */
export function invalidSlackBlocks(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return 'blocks must be an array';
  if (blocks.length === 0) return 'blocks must not be empty';
  if (blocks.length > MAX_BODY_BLOCKS) return `blocks must contain at most ${MAX_BODY_BLOCKS} entries`;
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      return 'each block must be an object';
    }
    if (typeof (block as { type?: unknown }).type !== 'string') {
      return 'each block must have a string "type"';
    }
  }
  return null;
}

export interface SlackSendOptions {
  /** connections.name (workspace scope) holding the Slack bot token */
  connection: string;
  targetType?: 'channel' | 'dm';
  channelId?: string;
  slackUserId?: string;
  mode?: SlackDeliveryMode;
  message?: string;
  waitMs?: number;
  /** Set false to omit the "Open in ShareOut" button and the URL appended to
   *  snapshot/PDF comments — for briefings that link out to their own system of
   *  record. Defaults to true. */
  includeArtifactLink?: boolean;
  /** Block Kit blocks for the message body, replacing the single mrkdwn section
   *  built from `message`. The header and the "Open in ShareOut" button are still
   *  added around them. `message` stays the notification fallback text. */
  blocks?: unknown[];
}

export interface SlackResult {
  success: boolean;
  error?: string;
}

/** Resolve a Slack connection token via the artifact's owning workspace. */
export async function resolveSlackTokenForArtifact(
  env: Env,
  artifactId: string,
  connectionName: string
): Promise<Awaited<ReturnType<typeof resolveSlackToken>> | null> {
  const ws = await env.DB.prepare(
    'SELECT workspace_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ workspace_id: string | null }>();
  if (!ws?.workspace_id) return null;
  return resolveSlackToken(env, ws.workspace_id, connectionName);
}

async function getArtifactMeta(env: Env, artifactId: string): Promise<{ name: string; url: string } | null> {
  const artifact = await env.DB.prepare(
    `SELECT a.name AS name, d.slug AS slug, a.display_slug AS display_slug,
            w.slug AS workspace_slug, w.subdomain_enabled AS subdomain_enabled
     FROM artifacts a
     JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     LEFT JOIN workspaces w ON w.id = a.workspace_id
     WHERE a.id = ?`
  ).bind(artifactId).first<{ name: string } & ArtifactUrlRow>();
  if (!artifact) return null;
  return { name: artifact.name, url: buildArtifactUrl(getPlatformOrigin(env), artifact) };
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'artifact';
}

async function postArtifactMessage(
  token: string,
  channelId: string,
  name: string,
  url: string,
  message: string,
  includeLink = true,
  bodyBlocks?: unknown[],
): Promise<SlackResult> {
  // includeLink=false: briefings whose canonical home is elsewhere. Caller-supplied
  // body replaces the mrkdwn section, but never the header or the link button.
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: name } },
    ...(bodyBlocks?.length
      ? bodyBlocks
      : [{ type: 'section', text: { type: 'mrkdwn', text: message } }]),
  ];
  if (includeLink) {
    blocks.push({
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Open in ShareOut' }, url },
      ],
    });
  }
  const result = await postSlackMessage(token, channelId, message, blocks);
  return result.ok ? { success: true } : { success: false, error: `chat.postMessage failed: ${result.error}` };
}

async function uploadSnapshot(
  env: Env,
  token: string,
  channelId: string,
  artifactId: string,
  name: string,
  waitMs?: number,
  initialComment?: string
): Promise<SlackResult> {
  const image = await renderArtifactImage(env, artifactId, { type: 'png', width: 1280, fullPage: true, idleTimeout: waitMs });
  if (!image) return { success: false, error: 'Snapshot render failed' };
  const uploaded = await uploadFileToSlack(token, channelId, image, `${safeFilename(name)}.png`, 'image/png', name, initialComment);
  return uploaded.ok ? { success: true } : { success: false, error: uploaded.error };
}

async function uploadPdf(
  env: Env,
  token: string,
  channelId: string,
  artifactId: string,
  name: string,
  waitMs?: number,
  initialComment?: string
): Promise<SlackResult> {
  const pdf = await renderArtifactPdf(env, artifactId, { idleTimeout: waitMs });
  if (!pdf) return { success: false, error: 'PDF render failed' };
  const uploaded = await uploadFileToSlack(token, channelId, pdf, `${safeFilename(name)}.pdf`, 'application/pdf', name, initialComment);
  return uploaded.ok ? { success: true } : { success: false, error: uploaded.error };
}

/** Deliver an artifact to Slack via a workspace bot-token connection. */
export async function sendArtifactToSlack(
  env: Env,
  artifactId: string,
  opts: SlackSendOptions
): Promise<SlackResult> {
  const resolved = await resolveSlackTokenForArtifact(env, artifactId, opts.connection);
  if (!resolved) return { success: false, error: `Slack connection '${opts.connection}' not found` };

  const meta = await getArtifactMeta(env, artifactId);
  if (!meta) return { success: false, error: 'Artifact not found or not published' };

  let channelId: string;
  if (opts.targetType === 'dm') {
    if (!opts.slackUserId) return { success: false, error: 'slackUserId is required for a Slack DM' };
    const member = await resolveSlackMemberId(resolved.token, opts.slackUserId);
    if (!member.userId) return { success: false, error: member.error };
    const dm = await openDmChannel(resolved.token, member.userId);
    if (!dm.channelId) return { success: false, error: dm.error };
    channelId = dm.channelId;
  } else {
    if (!opts.channelId) return { success: false, error: 'channelId is required for a Slack channel post' };
    channelId = opts.channelId;
  }

  const mode = opts.mode || 'message';
  const message = opts.message || `Update from ${meta.name}`;
  const includeLink = opts.includeArtifactLink !== false;
  const comment = includeLink ? `${message}\n${meta.url}` : message;

  if (mode === 'message') {
    return postArtifactMessage(resolved.token, channelId, meta.name, meta.url, message, includeLink, opts.blocks);
  }
  if (mode === 'snapshot') {
    return uploadSnapshot(env, resolved.token, channelId, artifactId, meta.name, opts.waitMs, comment);
  }
  if (mode === 'pdf') {
    return uploadPdf(env, resolved.token, channelId, artifactId, meta.name, opts.waitMs, comment);
  }

  const msg = await postArtifactMessage(resolved.token, channelId, meta.name, meta.url, message, includeLink, opts.blocks);
  if (!msg.success) return msg;
  return uploadSnapshot(env, resolved.token, channelId, artifactId, meta.name, opts.waitMs);
}
