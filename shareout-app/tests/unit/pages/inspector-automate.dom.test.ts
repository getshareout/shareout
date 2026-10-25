// @vitest-environment happy-dom
//
// Automate tab: jobs + alerts are fetched scoped to THIS artifact. An artifact opened by
// slug has no id until meta resolves; it must wait for it, never list the whole workspace.
import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script/index';
import { workspace_client_inspector_automate_JS as AUTOMATE } from '../../../src/pages/home/render-workspace/client-script/inspector-automate';

type Art = { id?: string; slug?: string; name?: string };

function harness(meta: { id: string } | null) {
  const urls: string[] = [];
  const ctx = {
    rbodyEl: document.createElement('div'),
    autoCache: {} as Record<string, unknown>,
    metaCache: {} as Record<string, unknown>,
    activeArt: null as Art | null,
    retried: 0,
    i18nLoad: () => 'loading',
    i18nEmpty: (k: string) => k,
    esc: (s: string) => String(s),
    t: (k: string) => k,
    cronHuman: (s: string) => s,
    isvg: () => '',
    okOr: (r: unknown) => r,
    failToast: () => {},
    openAutoForm: () => {},
    agentAsk: () => {},
    railRetry: () => { ctx.retried++; },
    fetchMeta: (art: Art, cb: (d: unknown) => void) => {
      queueMicrotask(() => { if (meta) art.id = meta.id; cb(meta); });
    },
    fetch: vi.fn((url: string) => {
      urls.push(url);
      const body = url.startsWith('/v1/jobs')
        ? { jobs: [{ id: 'job_1', title: 'Weekly send', artifact_id: 'art_1', schedule: '0 9 * * 1' }] }
        : { alerts: [{ id: 'mar_1', name: 'Revenue drop', artifact_id: 'art_1', enabled: 1 }] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  };
  const run = new Function('ctx', `with (ctx) { ${AUTOMATE}; return { renderAutomate: renderAutomate }; }`)(ctx) as {
    renderAutomate: (a: Art) => void;
  };
  return { ctx, urls, run };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('inspector Automate tab', () => {
  it('is part of the workspace client and parses', () => {
    expect(WORKSPACE_CLIENT).toContain('function renderAutomate(art)');
    expect(() => new Function(WORKSPACE_CLIENT)).not.toThrow();
  });

  it('with no id yet: shows loading, resolves meta, then fetches scoped to that artifact', async () => {
    const { ctx, urls, run } = harness({ id: 'art_1' });
    const art: Art = { slug: 'demo', name: 'Demo' };
    ctx.activeArt = art;
    run.renderAutomate(art);
    expect(ctx.rbodyEl.innerHTML).toContain('loading');
    expect(urls).toEqual([]);
    await flush();
    expect(urls.sort()).toEqual(['/v1/jobs?artifact_id=art_1', '/v1/metric-alerts?artifact_id=art_1']);
    expect(urls.some((u) => u.includes('workspace_id'))).toBe(false);
    expect(ctx.rbodyEl.innerHTML).toContain('Weekly send');
    expect(ctx.rbodyEl.innerHTML).toContain('Revenue drop');
  });

  it('meta failure: offers a retry and never fetches unscoped lists', async () => {
    const { ctx, urls, run } = harness(null);
    const art: Art = { slug: 'demo' };
    ctx.activeArt = art;
    run.renderAutomate(art);
    await flush();
    expect(ctx.retried).toBe(1);
    expect(urls).toEqual([]);
  });

  it('a stale response does not paint over another artifact', async () => {
    const { ctx, run } = harness({ id: 'art_1' });
    const art: Art = { slug: 'demo' };
    ctx.activeArt = art;
    run.renderAutomate(art);
    ctx.activeArt = { id: 'art_2' };
    ctx.rbodyEl.innerHTML = 'other';
    await flush();
    expect(ctx.rbodyEl.innerHTML).toBe('other');
  });
});
