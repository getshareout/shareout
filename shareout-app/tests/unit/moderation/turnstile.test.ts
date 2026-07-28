// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/fetch-utils', () => ({
  fetchWithTimeout: (...a: unknown[]) => mockFetch(...a),
  FetchTimeoutError: class extends Error {},
}));
const mockFetch = vi.fn();

import { verifyTurnstile, turnstileWidgetHtml } from '../../../src/turnstile';

const withSecret = { TURNSTILE_CLOUDFLARE_SECRETKEY: 'sec' } as Env;

beforeEach(() => mockFetch.mockReset());

describe('verifyTurnstile', () => {
  it('no-ops to true when no secret is configured', async () => {
    expect(await verifyTurnstile({} as Env, null)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a missing token when enabled', async () => {
    expect(await verifyTurnstile(withSecret, null)).toBe(false);
  });

  it('passes a valid token', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    expect(await verifyTurnstile(withSecret, 'tok', '1.2.3.4')).toBe(true);
  });

  it('rejects an invalid token', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
    expect(await verifyTurnstile(withSecret, 'tok')).toBe(false);
  });

  it('fails closed when the verifier returns a non-OK response', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await verifyTurnstile(withSecret, 'tok')).toBe(false);
  });
});

describe('turnstile widget', () => {
  it('renders the widget only with a site key', () => {
    expect(turnstileWidgetHtml(undefined)).toBe('');
    const html = turnstileWidgetHtml('0xSITE');
    expect(html).toContain('cf-turnstile');
    expect(html).toContain('0xSITE');
    expect(html).toContain('data-action="turnstile-spin-v1"');
  });
});
