// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock('../../../src/publish', () => ({ publishArtifact: publishMock }));
vi.mock('../../../src/visibility-config', () => ({ coerceVisibility: (_e: unknown, v: string) => v }));

import { handleProvision } from '../../../src/data/provision';
import type { DataContext } from '../../../src/data/middleware';

function ctx(over: Partial<DataContext> & { artifact?: Partial<DataContext['artifact']> } = {}): DataContext {
  return {
    artifactId: 'art_hub',
    workspaceId: 'wsp_studio',
    isOwner: over.isOwner ?? true,
    artifact: {
      id: 'art_hub', name: 'Hub', visibility: 'workspace', auth_method: 'google',
      workspace_id: 'wsp_studio', owner_id: 'usr_studio',
      ...(over.artifact || {}),
    },
    env: over.env || ({} as DataContext['env']),
    origin: null,
    db: {} as DataContext['db'],
  } as DataContext;
}
const req = (body: unknown) => new Request('https://x/v1/data/art_hub/provision', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  publishMock.mockReset();
  publishMock.mockResolvedValue({
    artifact: { id: 'art_new', type: 'html' },
    version: { id: 'ver_1', version_no: 1 },
    deployment: { slug: 'aprobaciones-lumen', url: 'https://shareout.site/a/aprobaciones-lumen/' },
  });
});

describe('handleProvision', () => {
  it('rejects non-owner with 403', async () => {
    const res = await handleProvision(req({ name: 'X', files: [{ path: 'index.html', content: 'h', mime: 'text/html' }] }), ctx({ isOwner: false }));
    expect(res.status).toBe(403);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('requires a name', async () => {
    const res = await handleProvision(req({ files: [{ path: 'index.html', content: 'h', mime: 'text/html' }] }), ctx());
    expect(res.status).toBe(400);
  });

  it('requires files or fromArtifact', async () => {
    const res = await handleProvision(req({ name: 'X' }), ctx());
    expect(res.status).toBe(400);
  });

  it('publishes raw files into the caller workspace as the owner', async () => {
    const res = await handleProvision(req({ name: 'Lumen', slug: 'aprobaciones-lumen', files: [{ path: 'index.html', content: '<h1>hi</h1>', mime: 'text/html' }] }), ctx());
    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [, user, params] = publishMock.mock.calls[0] as any[];
    expect(user.id).toBe('usr_studio');           // publishes AS the hub owner
    expect(params.workspaceId).toBe('wsp_studio');   // forced into caller workspace
    expect(params.slug).toBe('aprobaciones-lumen');
  });

  it('clones a template via fromArtifact + replace (server stamps it)', async () => {
    // fake DB + R2 for the template load
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('FROM artifacts')) return { owner_id: 'usr_studio', workspace_id: 'wsp_studio' };
              if (sql.includes('FROM deployments')) return { version_id: 'ver_tpl' };
              return null;
            },
            all: async () => ({ results: [{ path: 'index.html', r2_key: 'k1', mime: 'text/html' }] }),
          }),
        }),
      },
      ARTIFACTS: { get: async () => ({ text: async () => '<title>{{CLIENT_NAME}}</title> {{ROOM_SLUG}}' }) },
    } as unknown as DataContext['env'];

    const res = await handleProvision(
      req({ name: 'Lumen', fromArtifact: 'art_tpl', replace: { '{{CLIENT_NAME}}': 'Lumen', '{{ROOM_SLUG}}': 'aprobaciones-lumen' } }),
      ctx({ env }),
    );
    expect(res.status).toBe(200);
    const [, , params] = publishMock.mock.calls[0] as any[];
    expect(params.files[0].content).toBe('<title>Lumen</title> aprobaciones-lumen');
  });

  it('refuses a template from another owner/workspace', async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ owner_id: 'usr_other', workspace_id: 'wsp_other' }), all: async () => ({ results: [] }) }) }) },
      ARTIFACTS: { get: async () => null },
    } as unknown as DataContext['env'];
    const res = await handleProvision(req({ name: 'X', fromArtifact: 'art_foreign' }), ctx({ env }));
    expect(res.status).toBe(400); // template not accessible
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('does not leak internal errors when template load throws unexpectedly', async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error('D1_ERROR: no such table: artifacts');
            },
            all: async () => ({ results: [] }),
          }),
        }),
      },
      ARTIFACTS: { get: async () => null },
    } as unknown as DataContext['env'];
    const res = await handleProvision(req({ name: 'X', fromArtifact: 'art_tpl' }), ctx({ env }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; code: string };
    expect(body.code).toBe('TEMPLATE_ERROR');
    expect(body.error).toBe('Failed to load template');
    expect(body.error).not.toContain('D1_ERROR');
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('does not leak internal errors when publishArtifact throws', async () => {
    publishMock.mockRejectedValueOnce(new Error('D1_ERROR: database is locked'));
    const res = await handleProvision(
      req({ name: 'Lumen', files: [{ path: 'index.html', content: '<h1>hi</h1>', mime: 'text/html' }] }),
      ctx(),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string; code: string };
    expect(body.code).toBe('PROVISION_FAILED');
    expect(body.error).toBe('Provisioning failed');
    expect(body.error).not.toContain('D1_ERROR');
  });
});
