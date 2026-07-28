import type { Env } from '../../types';
import type { SlackConfig } from '../../scheduling/jobs';
import { sendArtifactToSlack } from '../../slack/send';
import type { Destination, DeliveryContext, DeliveryResult } from '../types';

export const slackDestination: Destination<SlackConfig> = {
  kind: 'slack',

  async validate(_env, _ctx, config) {
    // Bot-token (OAuth app) delivery.
    if (config.connection) {
      if (config.targetType === 'dm') {
        if (!config.slackUserId) return 'slackUserId is required for a Slack DM';
        return null;
      }
      if (!config.channelId) return 'channelId is required when using a Slack connection';
      return null;
    }
    // Legacy incoming-webhook delivery.
    if (!config.webhookUrl) return 'Slack config requires either webhookUrl or connection';
    try {
      if (new URL(config.webhookUrl).protocol !== 'https:') return 'Slack webhook URL must use HTTPS';
    } catch {
      return 'Invalid Slack webhook URL';
    }
    return null;
  },

  async deliver(env, ctx, config): Promise<DeliveryResult> {
    if (config.connection) {
      return sendArtifactToSlack(env, ctx.artifactId, {
        connection: config.connection,
        targetType: config.targetType,
        channelId: config.channelId,
        slackUserId: config.slackUserId,
        mode: config.mode,
        message: config.customMessage,
        waitMs: config.waitMs,
      });
    }
    return deliverViaWebhook(env, ctx, config);
  },
};

async function deliverViaWebhook(env: Env, ctx: DeliveryContext, config: SlackConfig): Promise<DeliveryResult> {
  const artifact = await env.DB.prepare(
    `SELECT a.id, a.name, d.slug AS slug FROM artifacts a
     JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     WHERE a.id = ?`
  ).bind(ctx.artifactId).first<{ id: string; name: string; slug: string }>();

  if (!artifact) return { success: false, error: 'Artifact not found' };

  const artifactUrl = `${env.SHAREOUT_BASE_URL}/a/${artifact.slug}/`;
  const payload: Record<string, unknown> = {
    username: config.username || 'ShareOut',
    icon_emoji: config.iconEmoji || ':chart_with_upwards_trend:',
    text: config.customMessage || `Update from ${artifact.name}`,
  };
  if (config.channel) payload.channel = config.channel;
  if (config.includeArtifactLink) {
    payload.attachments = [{
      color: '#3b82f6',
      title: artifact.name,
      title_link: artifactUrl,
      footer: 'ShareOut',
      ts: Math.floor(Date.now() / 1000),
    }];
  }

  try {
    const response = await fetch(config.webhookUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok ? { success: true } : { success: false, error: `Slack returned ${response.status}` };
  } catch (err) {
    return { success: false, error: `Slack webhook failed: ${err}` };
  }
}
