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

export interface SlackSendOptions {
  /** connections.name (workspace scope) holding the Slack bot token */
  connection: string;
  targetType?: 'channel' | 'dm';
  channelId?: string;
  slackUserId?: string;
  mode?: SlackDeliveryMode;
  message?: string;
  waitMs?: number;
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
  message: string
): Promise<SlackResult> {
  const result = await postSlackMessage(token, channelId, message, [
    { type: 'header', text: { type: 'plain_text', text: name } },
    { type: 'section', text: { type: 'mrkdwn', text: message } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Open in ShareOut' }, url },
      ],
    },
  ]);
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
  const comment = `${message}\n${meta.url}`;

  if (mode === 'message') {
    return postArtifactMessage(resolved.token, channelId, meta.name, meta.url, message);
  }
  if (mode === 'snapshot') {
    return uploadSnapshot(env, resolved.token, channelId, artifactId, meta.name, opts.waitMs, comment);
  }
  if (mode === 'pdf') {
    return uploadPdf(env, resolved.token, channelId, artifactId, meta.name, opts.waitMs, comment);
  }

  const msg = await postArtifactMessage(resolved.token, channelId, meta.name, meta.url, message);
  if (!msg.success) return msg;
  return uploadSnapshot(env, resolved.token, channelId, artifactId, meta.name, opts.waitMs);
}
