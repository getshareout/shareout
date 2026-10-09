// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const setArtifactModeration = vi.fn(async () => ({ ok: true }));
const setArtifactPaused = vi.fn(async () => undefined);

vi.mock('../../../src/superadmin/artifacts-admin', () => ({
  setArtifactModeration: (...a: unknown[]) => setArtifactModeration(...a),
  setArtifactPaused: (...a: unknown[]) => setArtifactPaused(...a),
}));

import { handleAbuseReport } from '../../../src/moderation/abuse-reports';

// DB mock: artifact exists; distinct-IP COUNT is configurable.
function makeEnv(distinctCount = 1, locale: string | null = null): Env {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('COUNT(DISTINCT reporter_ip)')) return { n: distinctCount };
            if (sql.includes('FROM artifacts a')) return { id: 'art_1', locale };
            return null;
          },
          run: async () => ({ success: true }),
        }),
      }),
    },
  } as unknown as Env;
}

function postReport(category: string, ip: string | null = '203.0.113.9'): Request {
  const headers = new Headers();
  if (ip) headers.set('cf-connecting-ip', ip);
  const body = new URLSearchParams({ category, detail: 'bad' });
  return new Request('https://shareout.site/report/art_1', { method: 'POST', headers, body });
}

beforeEach(() => {
  setArtifactModeration.mockClear();
  setArtifactPaused.mockClear();
});

describe('handleAbuseReport', () => {
  it('renders a report form on GET', async () => {
    const res = await handleAbuseReport(new Request('https://shareout.site/report/art_1'), makeEnv(), 'art_1');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Report this page');
    expect(html).toContain('action="/report/art_1"');
    expect(html).toContain('csam');
  });

  it('renders the form in Spanish when the artifact workspace speaks Spanish', async () => {
    const res = await handleAbuseReport(new Request('https://shareout.site/report/art_1'), makeEnv(1, 'es'), 'art_1');
    const html = await res.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Denunciar esta página');
    expect(html).toContain('<option value="csam">');
  });

  it('fails closed when the client IP cannot be verified', async () => {
    const res = await handleAbuseReport(postReport('spam', null), makeEnv(), 'art_1');
    expect(res.status).toBe(403);
  });

  it('auto-pauses + blocks immediately on a CSAM report', async () => {
    const res = await handleAbuseReport(postReport('csam'), makeEnv(1), 'art_1');
    expect(res.status).toBe(200);
    expect(setArtifactPaused).toHaveBeenCalledWith(expect.anything(), 'art_1', true);
    expect(setArtifactModeration).toHaveBeenCalledWith(expect.anything(), 'art_1', 'block', expect.any(String));
  });

  it('does not block a single ordinary report', async () => {
    await handleAbuseReport(postReport('spam'), makeEnv(1), 'art_1');
    expect(setArtifactModeration).not.toHaveBeenCalled();
  });

  it('auto-blocks once enough distinct IPs report', async () => {
    await handleAbuseReport(postReport('phishing'), makeEnv(3), 'art_1');
    expect(setArtifactModeration).toHaveBeenCalledWith(expect.anything(), 'art_1', 'block', expect.any(String));
  });

  it('rejects unknown categories', async () => {
    const res = await handleAbuseReport(postReport('nonsense'), makeEnv(), 'art_1');
    expect(res.status).toBe(400);
  });
});
