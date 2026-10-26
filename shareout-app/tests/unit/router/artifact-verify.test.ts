// Verify routes against the real migrated schema and R2, with the browser session
// mocked at the screenshots boundary (withArtifactBrowser): who may run and read a
// verify, the hourly limit, the no-binding fallback, and that the content-origin
// capture URL a hosted instance renders is actually served.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleFetch } from '../../../src/router/handle-fetch';
import { hashToken } from '../../../src/api-auth';
import { withArtifactBrowser } from '../../../src/screenshots';
import { _internal } from '../../../src/verify/service';
import type { PageSignals, Viewport, VerifyResult } from '../../../src/verify/types';
import type { Env } from '../../../src/types';

vi.mock('../../../src/screenshots', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/screenshots')>();
  return { ...mod, withArtifactBrowser: vi.fn() };
});

const WS = 'wsp_vfy';
const OTHER_WS = 'wsp_vfy_other';
const ART = 'art_0f1e2d3c4b5a69788796a5b4';
const AGENT_ART = 'art_1a2b3c4d5e6f708192a3b4c5';
const MD_ART = 'art_2b3c4d5e6f708192a3b4c5d6';
const DRAFT_ART = 'art_3c4d5e6f708192a3b4c5d6e7';
const CLEAN_ART = 'art_4d5e6f708192a3b4c5d6e7f8';
const HTML = '<!doctype html>\n<html>\n<head>\n<link rel="stylesheet" href="/styles.css">\n</head><body><h1>Hi</h1></body></html>';
const CLEAN_HTML = '<!doctype html>\n<html lang="en"><head><link rel="stylesheet" href="styles.css"></head><body><h1>Hi</h1></body></html>';
const tokens = {
  owner: 'so_' + 'a1'.repeat(32),
  editor: 'so_' + 'b2'.repeat(32),
  viewer: 'so_' + 'c3'.repeat(32),
  stranger: 'so_' + 'd4'.repeat(32),
  agentPublish: 'sot_' + 'e5'.repeat(32),
  agentRead: 'sot_' + 'f6'.repeat(32),
  agentOther: 'sot_' + '07'.repeat(32),
};

function signals(viewport: Viewport): PageSignals {
  return {
    viewport, loadMs: 100, pageErrors: [], console: [], requests: [], blocked: [], dialogs: [], storage: [], popups: 0,
    layout: {
      viewportWidth: viewport === 'desktop' ? 1280 : 390, scrollWidth: viewport === 'desktop' ? 1280 : 390, overflow: [],
      smallTargets: { count: 0, examples: [] }, brokenImages: [], textLength: 2, visibleMedia: 0, readyFlag: null,
    },
    design: null,
    axe: viewport === 'desktop' ? { violations: [] } : null,
    metrics: { lcpMs: 300, cls: 0, bytes: 2000, requests: 2 },
    screenshot: { bytes: new Uint8Array([82, 73, 70, 70, viewport === 'desktop' ? 1 : 2]), width: viewport === 'desktop' ? 800 : 780, height: viewport === 'desktop' ? 500 : 1688, fullPage: false },
  };
}

const rendered = () => vi.mocked(withArtifactBrowser).mockResolvedValue({ signals: [signals('desktop'), signals('mobile')], thumbnailRefreshed: true });

function call(token: string | null, method: string, path: string, body?: unknown, env: Env = e): Promise<Response> {
  return handleFetch(new Request(`https://shareout.test${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }), env);
}

const verify = (token: string | null, id = ART, body: unknown = {}, env?: Env) => call(token, 'POST', `/v1/artifacts/${id}/verify`, body, env);

async function seedArtifact(id: string, owner: string, slug: string, opts: { entry?: string; mime?: string; live?: boolean; html?: string } = {}) {
  const entry = opts.entry ?? 'index.html';
  const mime = opts.mime ?? 'text/html';
  const html = opts.html ?? HTML;
  await e.ARTIFACTS.put(`${id}/ver_${id}_1/${entry}`, html);
  await e.ARTIFACTS.put(`${id}/ver_${id}_2/${entry}`, html);
  await e.ARTIFACTS.put(`${id}/ver_${id}_2/styles.css`, 'h1{color:red}');
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, artifact_type) VALUES (?, ?, ?, ?, 'workspace', ?, ?)")
      .bind(id, owner, `Page ${slug}`, slug, WS, mime === 'text/html' ? 'html' : 'markdown'),
    e.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, '{}'), (?, ?, 2, ?, '{}')`)
      .bind(`ver_${id}_1`, id, entry, `ver_${id}_2`, id, entry),
    e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES
      (?, ?, ?, ?, ?, ?, 'h1'), (?, ?, ?, ?, ?, ?, 'h2'), (?, ?, 'styles.css', ?, 'text/css', 13, 'h3')`)
      .bind(`ast_${id}_1`, `ver_${id}_1`, entry, `${id}/ver_${id}_1/${entry}`, mime, html.length,
        `ast_${id}_2`, `ver_${id}_2`, entry, `${id}/ver_${id}_2/${entry}`, mime, html.length,
        `ast_${id}_3`, `ver_${id}_2`, `${id}/ver_${id}_2/styles.css`),
  ]);
  if (opts.live !== false) {
    await e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)")
      .bind(`dep_${id}`, id, `ver_${id}_2`, slug).run();
  }
}

beforeAll(async () => {
  (e as unknown as { SESSION_SECRET: string }).SESSION_SECRET = 'verify-test-secret';
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, is_service) VALUES
      ('usr_vfy_owner', 'owner@example.com', 'o', 0), ('usr_vfy_editor', 'editor@example.com', 'e', 0),
      ('usr_vfy_viewer', 'viewer@example.com', 'v', 0), ('usr_vfy_stranger', 'stranger@example.com', 's', 0),
      ('usr_vfy_agent', NULL, 'agent', 1), ('usr_vfy_agent2', NULL, 'agent2', 1), ('usr_vfy_agent3', NULL, 'agent3', 1)`),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'V', 'vfy', 'usr_vfy_owner'), (?, 'O', 'vfy-other', 'usr_vfy_stranger')").bind(WS, OTHER_WS),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_vfy_1', ?, 'usr_vfy_owner', 'owner', 'internal'), ('wm_vfy_2', ?, 'usr_vfy_agent', 'member', 'internal'),
      ('wm_vfy_3', ?, 'usr_vfy_agent2', 'member', 'internal'), ('wm_vfy_4', ?, 'usr_vfy_agent3', 'member', 'internal')`)
      .bind(WS, WS, WS, OTHER_WS),
  ]);
  await seedArtifact(ART, 'usr_vfy_owner', 'vfy-page');
  await seedArtifact(AGENT_ART, 'usr_vfy_agent', 'vfy-agent-page');
  await seedArtifact(MD_ART, 'usr_vfy_owner', 'vfy-notes', { entry: 'index.md', mime: 'text/markdown' });
  await seedArtifact(DRAFT_ART, 'usr_vfy_owner', 'vfy-draft', { live: false });
  await seedArtifact(CLEAN_ART, 'usr_vfy_owner', 'vfy-clean', { html: CLEAN_HTML });
  await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_vfy_1', ?, 'editor@example.com', 'editor'), ('col_vfy_2', ?, 'viewer@example.com', 'viewer')")
    .bind(ART, ART).run();
  const personal = async (id: string, user: string, token: string) =>
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash) VALUES (?, 'user', ?, ?, ?)")
      .bind(id, user, user, await hashToken(token));
  const agent = async (id: string, user: string, ws: string, token: string, scopes: string) =>
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES (?, 'workspace', ?, ?, ?, ?)")
      .bind(id, ws, user, await hashToken(token), scopes);
  await e.DB.batch([
    await personal('tok_vfy_o', 'usr_vfy_owner', tokens.owner),
    await personal('tok_vfy_e', 'usr_vfy_editor', tokens.editor),
    await personal('tok_vfy_v', 'usr_vfy_viewer', tokens.viewer),
    await personal('tok_vfy_s', 'usr_vfy_stranger', tokens.stranger),
    await agent('sot_vfy_p', 'usr_vfy_agent', WS, tokens.agentPublish, 'artifacts:read,artifacts:publish'),
    await agent('sot_vfy_r', 'usr_vfy_agent2', WS, tokens.agentRead, 'artifacts:read'),
    await agent('sot_vfy_x', 'usr_vfy_agent3', OTHER_WS, tokens.agentOther, 'artifacts:read,artifacts:publish'),
  ]);
});

beforeEach(() => {
  vi.mocked(withArtifactBrowser).mockReset();
  rendered();
});

describe('POST /v1/artifacts/:id/verify', () => {
  it('owner: a clean page passes with two screenshots, stored as the latest run', async () => {
    const res = await verify(tokens.owner, CLEAN_ART);
    expect(res.status).toBe(200);
    const body = await res.json() as VerifyResult & { viewports: Array<{ screenshot: { url: string; width: number } }> };
    expect(body).toMatchObject({ artifact_id: CLEAN_ART, version: 2, live: true, status: 'pass', issues: [], thumbnail_refreshed: true });
    expect(body.viewports.map((v) => v.screenshot.width)).toEqual([800, 780]);
    expect(body.viewports[0].screenshot.url).toBe(`https://shareout.test/v1/artifacts/${CLEAN_ART}/verify/${body.id}/desktop.webp`);
    expect(vi.mocked(withArtifactBrowser)).toHaveBeenCalledTimes(1);

    const latest = await call(tokens.owner, 'GET', `/v1/artifacts/${CLEAN_ART}/verify/latest`);
    expect(latest.status).toBe(200);
    expect(((await latest.json()) as VerifyResult).id).toBe(body.id);

    const shot = await call(tokens.owner, 'GET', `/v1/artifacts/${CLEAN_ART}/verify/${body.id}/mobile.webp`);
    expect(shot.status).toBe(200);
    expect(shot.headers.get('Content-Type')).toBe('image/webp');
    expect(shot.headers.get('Cache-Control')).toBe('private, no-store');
    expect([...new Uint8Array(await shot.arrayBuffer())]).toEqual([82, 73, 70, 70, 2]);
  });

  it('reports the source problems of the page alongside the render', async () => {
    const body = await (await verify(tokens.owner)).json() as VerifyResult;
    expect(body.status).toBe('fail');
    expect(body.issues.map((i) => i.rule)).toEqual(['absolute_path']);
    expect(body.issues[0]).toMatchObject({ where: 'index.html:4:30' });
    expect(body.issues[0].hint).toContain('"styles.css"');
  });

  it('a new run replaces the previous run and its screenshots', async () => {
    const first = (await (await verify(tokens.owner)).json()) as VerifyResult;
    const second = (await (await verify(tokens.owner)).json()) as VerifyResult;
    expect(second.id).not.toBe(first.id);
    expect(await e.ARTIFACTS.get(`${ART}/verify/${first.id}/desktop.webp`)).toBeNull();
    expect((await call(tokens.owner, 'GET', `/v1/artifacts/${ART}/verify/${first.id}/desktop.webp`)).status).toBe(404);
    expect(await e.ARTIFACTS.get(`${ART}/verify/${second.id}/desktop.webp`)).not.toBeNull();
  });

  it('an editor may verify; a viewer and a stranger may not run or read results', async () => {
    expect((await verify(tokens.editor)).status).toBe(200);
    const runId = ((await (await call(tokens.editor, 'GET', `/v1/artifacts/${ART}/verify/latest`)).json()) as VerifyResult).id;
    for (const token of [tokens.viewer, tokens.stranger]) {
      const res = await verify(token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
      expect((await call(token, 'GET', `/v1/artifacts/${ART}/verify/latest`)).status).toBe(403);
      expect((await call(token, 'GET', `/v1/artifacts/${ART}/verify/${runId}/desktop.webp`)).status).toBe(403);
    }
  });

  it('refuses anonymous callers', async () => {
    expect((await verify(null)).status).toBe(401);
    expect((await call(null, 'GET', `/v1/artifacts/${ART}/verify/latest`)).status).toBe(401);
    expect((await call(null, 'GET', `/v1/artifacts/${ART}/verify/vfy_${'0'.repeat(24)}/desktop.webp`)).status).toBe(401);
  });

  it('only serves well-formed screenshot paths', async () => {
    for (const path of ['not-a-run/desktop.webp', `vfy_${'0'.repeat(24)}/tablet.webp`, `vfy_${'0'.repeat(24)}/desktop.webp`]) {
      const res = await call(tokens.owner, 'GET', `/v1/artifacts/${ART}/verify/${path}`);
      expect(res.status, path).toBe(404);
    }
  });

  it('over the hourly limit → 429 with Retry-After, before any browser starts', async () => {
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    await e.DB.prepare("INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count) VALUES ('user', 'usr_vfy_stranger', 'verify', ?, 30)")
      .bind(hour.toISOString()).run();
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_vfy_3', ?, 'stranger@example.com', 'editor')").bind(ART).run();
    const res = await verify(tokens.stranger);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', limit: 30, remaining: 0 });
    expect(vi.mocked(withArtifactBrowser)).not.toHaveBeenCalled();
    await e.DB.prepare("DELETE FROM collaborators WHERE id = 'col_vfy_3'").run();
  });

  it('without a Browser Rendering binding → partial, source checks only', async () => {
    const noBrowser = { ...e, BROWSER: undefined } as Env;
    const res = await verify(tokens.owner, ART, {}, noBrowser);
    expect(res.status).toBe(200);
    const body = await res.json() as VerifyResult;
    expect(body).toMatchObject({ status: 'partial', partial_reason: 'no_browser', viewports: [], thumbnail_refreshed: false });
    expect(body.issues.find((i) => i.rule === 'absolute_path')?.where).toBe('index.html:4:30');
    expect(vi.mocked(withArtifactBrowser)).not.toHaveBeenCalled();
  });

  it('a session that cannot start → partial (render_failed)', async () => {
    vi.mocked(withArtifactBrowser).mockResolvedValue(null);
    const body = await (await verify(tokens.owner)).json() as VerifyResult;
    expect(body).toMatchObject({ status: 'partial', partial_reason: 'render_failed' });
  });

  it('checks an older version without calling it live', async () => {
    const body = await (await verify(tokens.owner, ART, { version: 1, viewports: ['mobile'] })).json() as VerifyResult;
    expect(body).toMatchObject({ version: 1, version_id: `ver_${ART}_1`, live: false });
    expect(body.issues.some((i) => i.rule === 'pinned_version_files')).toBe(false);
  });

  it('validates the body', async () => {
    for (const [body, param] of [[{ version: 'x' }, 'version'], [{ viewports: ['tablet'] }, 'viewports'], [{ full_page: 'yes' }, 'full_page']] as const) {
      const res = await verify(tokens.owner, ART, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', param });
    }
    expect((await verify(tokens.owner, ART, '{not json')).status).toBe(400);
    const missing = await verify(tokens.owner, ART, { version: 99 });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'VERSION_NOT_FOUND', param: 'version' });
  });

  it('refuses pages it cannot render', async () => {
    expect(await (await verify(tokens.owner, MD_ART)).json()).toMatchObject({ code: 'VERIFY_UNSUPPORTED' });
    const draft = await verify(tokens.owner, DRAFT_ART);
    expect(draft.status).toBe(409);
    expect(await draft.json()).toMatchObject({ code: 'NOT_PUBLISHED' });
    expect((await verify(tokens.owner, 'art_does_not_exist')).status).toBe(404);
  });
});

describe('workspace Agent (sot_) tokens', () => {
  it('need artifacts:publish to run a verify', async () => {
    const res = await verify(tokens.agentRead, AGENT_ART);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });

  it('verify a page their principal owns in their workspace', async () => {
    const res = await verify(tokens.agentPublish, AGENT_ART);
    expect(res.status).toBe(200);
    expect((await call(tokens.agentPublish, 'GET', `/v1/artifacts/${AGENT_ART}/verify/latest`)).status).toBe(200);
  });

  it('cannot verify a page they are not an editor of, or one in another workspace', async () => {
    expect((await verify(tokens.agentPublish, ART)).status).toBe(403);
    expect((await verify(tokens.agentOther, AGENT_ART)).status).toBe(403);
  });
});

describe('content-origin render target (hosted instances)', () => {
  const cdnEnv = () => ({ ...e, ARTIFACT_ORIGIN: 'https://cdn.example' }) as Env;
  const artifact = { id: ART, name: 'Page', owner_id: 'usr_vfy_owner', workspace_id: WS, visibility: 'workspace', paused: 0, slug: 'vfy-page', live_version_id: `ver_${ART}_2`, moderation_status: 'approved' };
  const version = { id: `ver_${ART}_2`, version_no: 2, entrypoint: 'index.html', manifest_json: '{}' };

  it('renders a private page on its content host with a content capability, and serves it', async () => {
    const plan = await _internal.renderPlan(cdnEnv(), artifact, version, { viewports: ['desktop', 'mobile'], fullPage: false, live: true, isPublic: false, lockCsp: false });
    const url = new URL(plan.url);
    expect(url.host).toBe(`${ART.slice(4)}.cdn.example`);
    expect(url.pathname).toMatch(/^\/c\/[^/]+\/$/);
    expect(url.searchParams.has('_capture')).toBe(true);
    expect(plan.basePath).toBe(url.pathname);
    expect(plan.policy.csp.get('script-src')).toContain('https:');
    expect(plan.refreshThumbnail).toBe(true);

    const page = await handleFetch(new Request(plan.url), cdnEnv());
    expect(page.status).toBe(200);
    expect(page.headers.get('Set-Cookie')).toBeNull();
    const html = await page.text();
    expect(html).toContain('shareout-initial-data');
    expect(html).toContain('<h1>Hi</h1>');
    // Relative files resolve under the same capability.
    const css = await handleFetch(new Request(new URL('styles.css', plan.url).toString()), cdnEnv());
    expect(css.status).toBe(200);
  });

  it('public pages enforce the tight allowlist; pinned versions never refresh the thumbnail', async () => {
    const plan = await _internal.renderPlan(cdnEnv(), artifact, { ...version, id: `ver_${ART}_1` }, { viewports: ['desktop'], fullPage: false, live: false, isPublic: true, lockCsp: false });
    expect(new URL(plan.url).pathname).toBe('/');
    expect(new URL(plan.url).searchParams.get('_ver')).toBe(`ver_${ART}_1`);
    expect(plan.policy.csp.get('script-src')).not.toContain('https:');
    expect(plan.refreshThumbnail).toBe(false);
  });

  it('same-zone instances render the /a/{slug}/ capture view on the app origin', async () => {
    const plan = await _internal.renderPlan(e, artifact, version, { viewports: ['desktop'], fullPage: false, live: true, isPublic: false, lockCsp: false });
    expect(plan.url).toMatch(/^https:\/\/shareout\.test\/a\/vfy-page\/\?_capture=/);
    expect(plan.basePath).toBe('/a/vfy-page/');
  });
});
