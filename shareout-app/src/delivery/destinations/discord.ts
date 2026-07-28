import type { DiscordConfig } from '../../scheduling/jobs';
import type { Destination } from '../types';

export const discordDestination: Destination<DiscordConfig> = {
  kind: 'discord',

  async validate(_env, _ctx, config) {
    if (!config.webhookUrl) return 'Discord webhookUrl required';
    try {
      if (new URL(config.webhookUrl).protocol !== 'https:') return 'Discord webhook URL must use HTTPS';
    } catch {
      return 'Invalid Discord webhook URL';
    }
    return null;
  },

  async deliver(env, ctx, config) {
    const artifact = await env.DB.prepare(
      `SELECT a.id, a.name, d.slug AS slug FROM artifacts a
       JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       WHERE a.id = ?`
    ).bind(ctx.artifactId).first<{ id: string; name: string; slug: string }>();

    if (!artifact) return { success: false, error: 'Artifact not found' };

    const artifactUrl = `${env.SHAREOUT_BASE_URL}/a/${artifact.slug}/`;
    const payload: Record<string, unknown> = {
      username: config.username || 'ShareOut',
      content: config.customMessage || `Update from **${artifact.name}**`,
    };
    if (config.avatarUrl) payload.avatar_url = config.avatarUrl;
    if (config.includeArtifactLink) {
      payload.embeds = [{
        title: config.embedTitle || artifact.name,
        url: artifactUrl,
        color: config.embedColor || 3978236,
        timestamp: new Date().toISOString(),
        footer: { text: 'ShareOut' },
      }];
    }

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.ok ? { success: true } : { success: false, error: `Discord returned ${response.status}` };
    } catch (err) {
      return { success: false, error: `Discord webhook failed: ${err}` };
    }
  },
};
