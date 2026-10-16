// @vitest-environment happy-dom
//
// Boot-time request budget for the workspace home: the whole client bundle runs against
// the SSR body with a recording fetch, and the requests it fires before any interaction
// are counted. Guards against the fan-outs that made /home slow: one /v1/home/browser per
// folder, a second /v1/home/activity-feed for the bell, a quick-search before anyone
// searched, and a stage iframe for every restored background tab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../../src/pages/home/types';

const args = {
  user: { id: 'usr_alice', email: 'alice@example.com' }, userInfo: { name: 'Alice', picture: null },
  catalog: [], catalogTruncated: false, catalogTotal: 0, allCount: 0, favCount: 0, sharedCount: 0,
  workspaces: [{ id: 'wsp_acme', name: 'Acme', slug: 'acme', branding: null, artifact_count: 0, can_manage: false }],
  folders: [], teamFolders: [], personalFolders: [], filesScope: 'team', folderKind: '', folder: '', tags: [],
  search: '', sort: 'recent', type: '', scope: 'all', workspace: 'wsp_acme', page: 1, openVisDisabled: false,
  workspaceId: 'wsp_acme', workspaceRole: 'member', wsTeamsPlan: true, wsKnowledgePaid: true, accessRequests: [],
  hostname: 'acme.example.com', visualEditorOffWorkspaces: [], createEnabled: true, locale: null,
} as unknown as RenderArgs;

const FOLDERS = Array.from({ length: 12 }, (_, i) => `<div class="wsx-folder-card" data-folder-id="fld_${i}"></div>`).join('');

let urls: string[] = [];
let bootError: unknown = null;
const count = (prefix: string) => urls.filter((u) => u.startsWith(prefix)).length;
const flush = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  urls = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    urls.push(u.replace(/^https?:\/\/[^/]+/, ''));
    const body = u.includes('/v1/home/browser') ? { cardsHtml: '', rowsHtml: '', foldersHtml: FOLDERS, canManageFolders: false } : {};
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    localStorage.clear();
    localStorage.setItem('wsx_tabs:wsp_acme', JSON.stringify([1, 2, 3, 4].map((i) => ({ key: `art_${i}`, label: `Doc ${i}`, id: `art_${i}`, slug: `doc-${i}`, type: 'html' }))));
  } catch { /* storage unavailable */ }
  const { body, scripts } = buildWorkspaceView(args);
  document.body.innerHTML = body;
  // eslint-disable-next-line no-eval
  (0, eval)(componentScripts);
  bootError = null;
  try { (0, eval)(scripts); } catch (e) { bootError = e; }
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('workspace home boot requests', () => {
  it('fires each boot endpoint at most once and defers the rest until needed', async () => {
    await flush(10_000);
    expect(bootError).toBeNull();
    // The bell primed its badge (it shares the feed's response) — the bundle ran to the end.
    expect(count('/v1/workspaces/wsp_acme/publish-approvals')).toBe(1);
    expect(count('/v1/home/activity-feed')).toBe(1);
    // One idle warm of the default Artifacts payload; no per-folder prefetch fan-out.
    expect(count('/v1/home/browser')).toBeLessThanOrEqual(1);
    expect(count('/v1/home/quick-search')).toBe(0);
    expect(count('/v1/home/recent')).toBeLessThanOrEqual(1);
    expect(count('/v1/home/for-you')).toBeLessThanOrEqual(1);
    const dupes = urls.filter((u, i) => u.startsWith('/v1/') && urls.indexOf(u) !== i);
    expect(dupes).toEqual([]);
  });

  it('restored background tabs do not load their stage iframes', async () => {
    await flush(1_000);
    const srcs = [...document.querySelectorAll('.wsx__stageframe')].map((f) => f.getAttribute('src'));
    expect(srcs.length).toBe(4);
    expect(srcs.filter(Boolean)).toEqual([]);
  });
});
