// Every control-plane call (`_authFetch` → /v1/…, not /v1/data/…) against the body its
// real handler sends. Some routes wrap in `{ success, data }`, most answer bare; the SDK
// must return the payload either way. Shapes mirror the handlers named on each test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareOut, ShareOutError } from '../src/index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sdkAnswering(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body, status));
  vi.stubGlobal('fetch', fetchMock);
  const sdk = new ShareOut({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
  return { sdk, fetchMock };
}

const template = { id: 'tpl_1', name: 'Weekly', subject: 'Hi', html: '<p>x</p>', scope: 'account' };
const rendered = { subject: 'Hi', html: '<p>x</p>' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('control-plane calls', () => {
  // src/workspace-library.ts handleResolveLibrary — bare object.
  it('lib(name) resolves the bare { url } body and imports it', async () => {
    // Real shape; a data: URL stands in for /lib/<ns>/<name>@<semver>.js so the import stays local.
    const { sdk, fetchMock } = sdkAnswering({
      name: 'charts', scope: 'workspace', version: '1.2.0', pinned: false, url: 'data:text/javascript,export const bar = 1;',
    });
    await expect(sdk.lib<{ bar: number }>('charts')).resolves.toMatchObject({ bar: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/artifacts/art_1/lib/charts');
  });

  // src/router/api/workspace-crew-usage.ts handleGetWorkspaceCrewUsage — bare object.
  it('crew.usage(workspaceId) returns the bare rollup', async () => {
    const usage = {
      summary: { runs: 2, errors: 0, errorRate: 0, costUsd: 0.01 },
      runs: [], totals: [], toolBreakdown: [], approvalStats: [], limit: 50, offset: 0,
    };
    const { sdk, fetchMock } = sdkAnswering(usage);
    await expect(sdk.crew.usage('wsp_1')).resolves.toEqual(usage);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/workspaces/wsp_1/crew-usage');
  });

  // src/scheduling/templates-handler.ts — every handler wraps in { success, data }.
  it('templates.list() unwraps { templates, count }', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { templates: [template], count: 1 } });
    await expect(sdk.templates.list()).resolves.toEqual([template]);
  });

  it('templates.get(id) unwraps { template }', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { template } });
    await expect(sdk.templates.get('tpl_1')).resolves.toEqual(template);
  });

  it('templates.get(id) returns null on NOT_FOUND', async () => {
    const { sdk } = sdkAnswering({ success: false, error: 'Template not found', code: 'NOT_FOUND' }, 404);
    await expect(sdk.templates.get('tpl_x')).resolves.toBeNull();
  });

  it('templates.create(params) unwraps { template }', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { template } }, 201);
    await expect(sdk.templates.create({ name: 'Weekly', subject: 'Hi', html: '<p>x</p>' })).resolves.toEqual(template);
  });

  it('templates.update(id, params) unwraps { template }', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { template } });
    await expect(sdk.templates.update('tpl_1', { name: 'Weekly' })).resolves.toEqual(template);
  });

  it('templates.delete(id) resolves true', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { success: true } });
    await expect(sdk.templates.delete('tpl_1')).resolves.toBe(true);
  });

  it('templates.preview(id, artifactId) unwraps { rendered }', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { rendered } });
    await expect(sdk.templates.preview('tpl_1', 'art_1')).resolves.toEqual(rendered);
  });

  it('templates.previewInline(html, subject, artifactId) unwraps { rendered }', async () => {
    const { sdk } = sdkAnswering({ success: true, data: { rendered } });
    await expect(sdk.templates.previewInline('<p>x</p>', 'Hi', 'art_1')).resolves.toEqual(rendered);
  });

  // src/http/api-error.ts envelope, as withErrorContext stamps it.
  it('a control-plane error carries request_id and reason', async () => {
    const { sdk } = sdkAnswering(
      { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED', reason: 'expired', request_id: 'req_123' },
      401,
    );
    const err = await sdk.crew.usage('wsp_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareOutError);
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401, requestId: 'req_123', reason: 'expired' });
  });
});
