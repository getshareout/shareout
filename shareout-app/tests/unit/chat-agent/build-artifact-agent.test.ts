// The assistant's confirmed build with BUILD_AGENT=on: tool-using agent, progress in the user's
// language through the build_step callback, private publish, honest failure.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { GOOD_HTML, scriptedProvider, type Step } from '../build-agent/helpers';

const publishGeneratedFiles = vi.hoisted(() => vi.fn());
const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const generateArtifactHtml = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());
const getCrewProvider = vi.hoisted(() => vi.fn());
const alertOps = vi.hoisted(() => vi.fn(async () => true));
const runVerify = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/agent/build-page', async (importOriginal) => ({ ...(await importOriginal<object>()), generateArtifactHtml }));
vi.mock('../../../src/publish/publish-generated-html', () => ({ publishGeneratedFiles, publishGeneratedHtml }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));
vi.mock('../../../src/crew/provider', async (importOriginal) => ({ ...(await importOriginal<object>()), getCrewProvider }));
vi.mock('../../../src/support/alert', () => ({ alertOps }));
vi.mock('../../../src/verify/service', () => ({ runVerify }));
vi.mock('../../../src/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), logError: vi.fn() }));

import { executeBuildArtifact } from '../../../src/chat-agent/actions';

const env = (extra: Partial<Env> = {}) => ({
  BUILD_AGENT: 'on',
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ email: 'me@example.com' }) }) }) },
  ...extra,
}) as unknown as Env;

const write = (path: string, content: string): [string, Record<string, unknown>] => ['write_file', { path, content }];
const good: Step = { calls: [write('index.html', GOOD_HTML), write('styles.css', 'b{}'), write('app.js', 'document.title="x";')] };
const publish: Step = { calls: [['publish_page', {}]] };
const build = { kind: 'build_artifact' as const, name: 'Mi página', prompt: 'una página', workspace_id: 'wsp_1' };

beforeEach(() => {
  publishGeneratedFiles.mockReset().mockResolvedValue({ artifact: { id: 'art_1' }, deployment: { url: 'https://x/a/p/', subdomain_url: 'https://p.x/', slug: 'p' } });
  publishGeneratedHtml.mockReset();
  generateArtifactHtml.mockReset();
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
  getCrewProvider.mockReset();
  alertOps.mockClear();
  runVerify.mockReset();
});

describe('executeBuildArtifact with BUILD_AGENT=on', () => {
  it('builds through tools and publishes the files privately into the chat workspace', async () => {
    getCrewProvider.mockReturnValue(scriptedProvider([good, publish]).provider);
    const steps: string[] = [];
    const r = await executeBuildArtifact(env(), 'u1', build, (l) => steps.push(l), 'es');
    expect(r).toMatchObject({ ok: true, url: 'https://p.x/', slug: 'p', artifactId: 'art_1', name: 'Mi página' });
    expect(r.text).toBe('Lista y publicada ✅ https://x/a/p/');
    expect(steps).toContain('Escribiendo estilos…');
    expect(steps).toContain('Publicándola…');
    expect(publishGeneratedFiles).toHaveBeenCalledTimes(1);
    expect(publishGeneratedFiles.mock.calls[0][2]).toMatchObject({ workspaceId: 'wsp_1', visibility: 'private', name: 'Mi página' });
    expect(publishGeneratedFiles.mock.calls[0][2].files).toHaveLength(3);
    expect(incrementRateLimit).toHaveBeenCalledTimes(1);
    expect(generateArtifactHtml).not.toHaveBeenCalled();
  });

  it('does not publish a page that cannot pass its checks: localized failure, operator alerted', async () => {
    getCrewProvider.mockReturnValue(scriptedProvider([{ calls: [write('index.html', GOOD_HTML), write('app.js', 'let = ;')] }, publish]).provider);
    const r = await executeBuildArtifact(env(), 'u1', build, undefined, 'es');
    expect(r.ok).toBe(false);
    expect(r.url).toBeUndefined();
    expect(r.text).toMatch(/no la publiqué/);
    expect(publishGeneratedFiles).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
    expect(alertOps).toHaveBeenCalledTimes(1);
  });

  it('tests the page when the instance has a browser and fixes what the test found', async () => {
    runVerify
      .mockResolvedValueOnce({ ok: true, name: 'n', result: { status: 'fail', counts: { error: 1, warning: 0, info: 0 }, summary: 'fail — x', issues: [], viewports: [], artifact_id: 'art_1', version: 1, live: true } })
      .mockResolvedValueOnce({ ok: true, name: 'n', result: { status: 'pass', counts: { error: 0, warning: 0, info: 0 }, summary: 'pass — ok', issues: [], viewports: [], artifact_id: 'art_1', version: 2, live: true } });
    getCrewProvider.mockReturnValue(scriptedProvider([good, publish, { calls: [['edit_file', { path: 'app.js', old: 'x', new: 'y' }]] }, publish]).provider);
    const steps: string[] = [];
    const r = await executeBuildArtifact(env({ BROWSER: {} as Fetcher }), 'u1', build, (l) => steps.push(l), 'en');
    expect(r.ok).toBe(true);
    expect(runVerify).toHaveBeenCalledTimes(2);
    expect(steps).toEqual(expect.arrayContaining(['Testing the page…', 'Fixing 1 problem found while testing…']));
    expect(incrementRateLimit).toHaveBeenCalledTimes(1);
  });

  it('keeps the one-shot builder when the flag is off', async () => {
    generateArtifactHtml.mockResolvedValue('<!doctype html><h1>A generated page</h1>');
    publishGeneratedHtml.mockResolvedValue({ artifact: { id: 'a' }, deployment: { url: 'https://x/', slug: 'p' } });
    await executeBuildArtifact(env({ BUILD_AGENT: undefined }), 'u1', build);
    expect(getCrewProvider).not.toHaveBeenCalled();
    expect(generateArtifactHtml).toHaveBeenCalled();
  });
});
