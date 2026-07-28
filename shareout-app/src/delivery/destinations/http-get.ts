import type { HttpGetConfig } from '../../scheduling/jobs';
import type { Destination } from '../types';

export const httpGetDestination: Destination<HttpGetConfig> = {
  kind: 'http_get',

  async validate(_env, _ctx, config) {
    if (!config.url) return 'HTTP GET url required';
    try {
      if (new URL(config.url).protocol !== 'https:') return 'HTTP GET URL must use HTTPS';
    } catch {
      return 'Invalid HTTP GET URL';
    }
    return null;
  },

  async deliver(_env, _ctx, config) {
    try {
      const response = await fetch(config.url, {
        method: 'GET',
        headers: { 'User-Agent': 'ShareOut-Trigger/1.0', ...config.headers },
      });
      return response.ok ? { success: true } : { success: false, error: `HTTP GET returned ${response.status}` };
    } catch (err) {
      return { success: false, error: `HTTP GET failed: ${err}` };
    }
  },
};
