import type { HttpGetConfig } from '../../scheduling/jobs';
import type { Destination } from '../types';
import { destinationRefusal, safeFetch } from '../safe-fetch';

export const httpGetDestination: Destination<HttpGetConfig> = {
  kind: 'http_get',

  async validate(env, _ctx, config) {
    if (!config.url) return 'HTTP GET url required';
    try {
      if (new URL(config.url).protocol !== 'https:') return 'HTTP GET URL must use HTTPS';
      const refusal = destinationRefusal(env, config.url);
      if (refusal) return `HTTP GET URL not allowed: ${refusal}`;
    } catch {
      return 'Invalid HTTP GET URL';
    }
    return null;
  },

  async deliver(env, _ctx, config) {
    try {
      const response = await safeFetch(env, config.url, {
        method: 'GET',
        headers: { 'User-Agent': 'ShareOut-Trigger/1.0', ...config.headers },
      });
      return response.ok ? { success: true } : { success: false, error: `HTTP GET returned ${response.status}` };
    } catch (err) {
      return { success: false, error: `HTTP GET failed: ${err}` };
    }
  },
};
