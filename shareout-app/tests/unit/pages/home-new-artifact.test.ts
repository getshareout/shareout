// POST /v1/home/new — the Studio "New" menu's blank document / template path.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const hostWorkspaceId = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());

vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/publish/publish-generated-html', () => ({ publishGeneratedHtml }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));

import { handleHomeNewArtifactApi, buildDocHtml, NEW_DOC_TEMPLATES } from '../../../src/pages/home/new-artifact';

const env = {} as Env;
const user = { id: 'usr_1', email: 'laura@example.com' };
const post = (body: unknown, qs = '') =>
  handleHomeNewArtifactApi(new Request(`https://shareout.site/v1/home/new${qs}`, { method: 'POST', body: JSON.stringify(body) }), env, user);

beforeEach(() => {
  hostWorkspaceId.mockReset().mockResolvedValue(null);
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
  publishGeneratedHtml.mockReset().mockResolvedValue({ artifact: { id: 'art_1' }, deployment: { slug: 'informe-abc123' } });
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
});

describe('POST /v1/home/new', () => {
  it('creates a private blank document by default and returns where to open it', async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, artifactId: 'art_1', slug: 'informe-abc123', name: 'Untitled document' });
    const opts = publishGeneratedHtml.mock.calls[0][2];
    expect(opts).toMatchObject({ visibility: 'private', workspaceId: null, name: 'Untitled document' });
    expect(opts.slug).toMatch(/^untitled-document-[0-9a-f]{6}$/);
    expect(incrementRateLimit).toHaveBeenCalledOnce();
  });

  it('localizes a template and never reuses a slug (a second doc must not overwrite the first)', async () => {
    await post({ template: 'meeting', lang: 'es' });
    await post({ template: 'meeting', lang: 'es' });
    const [a, b] = publishGeneratedHtml.mock.calls.map((c) => c[2]);
    expect(a.name).toBe('Minuta de reunión');
    expect(a.slug).toMatch(/^minuta-de-reunion-/);
    expect(a.slug).not.toBe(b.slug);
    expect(a.html).toContain('<html lang="es">');
    expect(a.html).toContain('<h2>Decisiones</h2>');
  });

  it('rejects an unknown template', async () => {
    const res = await post({ template: 'nope' });
    expect(res.status).toBe(400);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });

  it('creates inside the workspace for an internal member', async () => {
    hostWorkspaceId.mockResolvedValue('wsp_incro');
    await post({ template: 'report' });
    expect(getInternalWorkspaceRole).toHaveBeenCalledWith(env, 'wsp_incro', 'usr_1');
    expect(publishGeneratedHtml.mock.calls[0][2].workspaceId).toBe('wsp_incro');
  });

  it('refuses a workspace the caller is not an internal member of', async () => {
    getInternalWorkspaceRole.mockResolvedValue(null);
    const res = await post({}, '?workspace=wsp_other');
    expect(res.status).toBe(403);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });

  it('honours the daily publish limit and the storage cap', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, reset: Math.floor(Date.now() / 1000) + 60 });
    expect((await post({})).status).toBe(429);
    checkStorageQuota.mockResolvedValueOnce({ allowed: false, used: 10 * 1024 * 1024, incoming: 1, max: 10 * 1024 * 1024 });
    expect((await post({})).status).toBe(413);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });
});

describe('buildDocHtml', () => {
  it('escapes and ships every template in both languages', () => {
    for (const key of Object.keys(NEW_DOC_TEMPLATES)) {
      for (const lang of ['en', 'es'] as const) {
        const html = buildDocHtml(NEW_DOC_TEMPLATES[key][lang], lang);
        expect(html).toContain(`<h1>${NEW_DOC_TEMPLATES[key][lang].title}</h1>`);
      }
    }
    expect(buildDocHtml({ title: '<b>x</b>', intro: '', sections: [] }, 'en')).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
