import type { WebhookConfig } from '../../scheduling/jobs';
import type { Destination } from '../types';

export const webhookDestination: Destination<WebhookConfig> = {
  kind: 'webhook',

  async validate(_env, _ctx, config) {
    if (!config.url) return 'Webhook URL required';
    try {
      if (new URL(config.url).protocol !== 'https:') return 'Webhook URL must use HTTPS';
    } catch {
      return 'Invalid webhook URL';
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

    const method = config.method || 'POST';
    const hasBody = !['GET', 'DELETE'].includes(method);

    const payload: Record<string, unknown> = {
      artifact_id: artifact.id,
      artifact_name: artifact.name,
      artifact_url: `${env.SHAREOUT_BASE_URL}/a/${artifact.slug}/`,
      triggered_at: new Date().toISOString(),
    };

    if (config.includeArtifactData && hasBody) {
      const jsonData = await env.DB.prepare(
        'SELECT key, value FROM data_json WHERE artifact_id = ? LIMIT 50'
      ).bind(ctx.artifactId).all<{ key: string; value: string }>();
      payload.data = Object.fromEntries(
        (jsonData.results || []).map(r => [r.key, JSON.parse(r.value)])
      );
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'ShareOut-Webhook/1.0',
        ...config.headers,
      };
      const fetchOptions: RequestInit = { method, headers };
      if (hasBody) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(payload);
      }
      const response = await fetch(config.url, fetchOptions);
      return response.ok ? { success: true } : { success: false, error: `Webhook returned ${response.status}` };
    } catch (err) {
      return { success: false, error: `Webhook failed: ${err}` };
    }
  },
};
