// verify_artifact over MCP: same check as POST /v1/artifacts/{id}/verify, answered as a
// short report plus the desktop and phone screenshots. Browser mocked at the
// screenshots boundary.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { callTool, listTools } from '../../../src/mcp/tools';
import { withArtifactBrowser } from '../../../src/screenshots';
import type { PageSignals, Viewport } from '../../../src/verify/types';
import { applyMigrations, e } from '../helpers/migrated-db';

vi.mock('../../../src/screenshots', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/screenshots')>();
  return { ...mod, withArtifactBrowser: vi.fn() };
});

const ART = 'art_5e6f708192a3b4c5d6e7f809';
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const owner = u('usr_mcpv_owner', 'owner@example.com');
const viewer = u('usr_mcpv_viewer', 'viewer@example.com');
const ctx = (user: AuthUser) => ({ env: e, user, origin: 'https://shareout.test', authorization: 'Bearer so_test' });

function signals(viewport: Viewport, over: Partial<PageSignals> = {}): PageSignals {
  return {
    viewport, loadMs: 90, pageErrors: [], console: [], requests: [], blocked: [], dialogs: [], storage: [], popups: 0,
    layout: { viewportWidth: viewport === 'desktop' ? 1280 : 390, scrollWidth: viewport === 'desktop' ? 1280 : 390, overflow: [], smallTargets: { count: 0, examples: [] }, brokenImages: [], textLength: 10, visibleMedia: 0, readyFlag: null },
    design: null, axe: null, metrics: { lcpMs: 400, cls: 0, bytes: 1000, requests: 1 },
    screenshot: { bytes: new Uint8Array([82, 73, 70, 70, viewport === 'desktop' ? 1 : 2]), width: viewport === 'desktop' ? 800 : 780, height: 500, fullPage: false },
    ...over,
  };
}

beforeAll(async () => {
  (e as unknown as { SESSION_SECRET: string }).SESSION_SECRET = 'mcp-verify-secret';
  await applyMigrations();
  const html = '<!doctype html><html lang="en"><body><h1>Plan</h1></body></html>';
  await e.ARTIFACTS.put(`${ART}/ver_mcpv1/index.html`, html);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, 'o'), (?, ?, 'v')").bind(owner.id, owner.email, viewer.id, viewer.email),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES (?, ?, 'Launch plan', 'mcpv-plan', 'private')").bind(ART, owner.id),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES ('ver_mcpv1', ?, 1, 'index.html', '{}')").bind(ART),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES ('ast_mcpv1', 'ver_mcpv1', 'index.html', ?, 'text/html', ?, 'h')")
      .bind(`${ART}/ver_mcpv1/index.html`, html.length),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_mcpv', ?, 'ver_mcpv1', 'production', 'mcpv-plan')").bind(ART),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_mcpv', ?, ?, 'viewer')").bind(ART, viewer.email),
  ]);
});

beforeEach(() => {
  vi.mocked(withArtifactBrowser).mockReset();
});

describe('verify_artifact', () => {
  it('is listed with an artifact_id-only required input', () => {
    const tool = listTools().find((t) => t.name === 'verify_artifact');
    expect(tool?.inputSchema).toMatchObject({ required: ['artifact_id'] });
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('returns a short report and two screenshots (desktop, then phone)', async () => {
    const err = { message: 'TypeError: rows is undefined', where: 'index.html:12:7', count: 1 };
    vi.mocked(withArtifactBrowser).mockResolvedValue({ signals: [signals('desktop', { pageErrors: [err] }), signals('mobile', { pageErrors: [err] })], thumbnailRefreshed: true });
    const r = (await callTool(ctx(owner), 'verify_artifact', { artifact_id: ART }))!;
    expect(r.isError).toBeUndefined();
    const [text, desktop, phone] = r.content;
    expect(text.type).toBe('text');
    const report = (text as { text: string }).text;
    expect(report.split('\n').length).toBeLessThanOrEqual(40);
    expect(report).toMatch(/^Checked "Launch plan" v1 \(live\) — FAIL: 1 error/);
    expect(report).toContain('1. [both] Uncaught TypeError: rows is undefined — index.html:12:7');
    expect(desktop).toEqual({ type: 'image', data: 'UklGRgE=', mimeType: 'image/webp' });
    expect(phone).toEqual({ type: 'image', data: 'UklGRgI=', mimeType: 'image/webp' });
    expect(r.structuredContent).toMatchObject({ status: 'fail', version: 1, live: true, counts: { error: 1, warning: 0, info: 0 } });
  });

  it('a viewer of the page gets a plain refusal and no browser runs', async () => {
    const r = (await callTool(ctx(viewer), 'verify_artifact', { artifact_id: ART }))!;
    expect(r.isError).toBe(true);
    expect(r.content).toHaveLength(1);
    expect((r.content[0] as { text: string }).text).toContain('The page was not checked: Only owners and editors');
    expect(vi.mocked(withArtifactBrowser)).not.toHaveBeenCalled();
  });

  it('without a browser binding it still reports the source checks, without images', async () => {
    const r = (await callTool({ ...ctx(owner), env: { ...e, BROWSER: undefined } }, 'verify_artifact', { artifact_id: ART }))!;
    expect(r.content).toHaveLength(1);
    expect((r.content[0] as { text: string }).text).toContain('PARTIAL: source checks only');
    expect(r.structuredContent).toMatchObject({ status: 'partial' });
  });
});
