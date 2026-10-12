// @vitest-environment happy-dom
//
// L3: in a workspace, the Library shows the workspace's own skills first; ShareOut's
// official (English, developer-oriented) catalog follows instead of leading.
import { describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_library_JS as libraryJs } from '../../../src/pages/home/render-workspace/client-script/home-views/library';

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

function load(ws: string | null, fetchMock: ReturnType<typeof vi.fn>) {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = ws;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s));
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'loaded') return {};
      if (prop === 'ws') return document;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  return new Function('scope', `with (scope) {\n${libraryJs}\n; return { loadLibSkills }; }`)(scope) as { loadLibSkills: () => void };
}

describe('Library skills order', () => {
  it('workspace skills come before the official catalog', async () => {
    document.body.innerHTML = '<div id="wsxLibMount"></div>';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/v1/skills/recommended')) return json({ skills: [{ artifact_id: 'art_off', name: 'Test-Driven Development', official: 1 }] });
      if (url.includes('/agent-skills')) return json({ skills: [] });
      return json({ skills: [{ artifact_id: 'art_own', name: 'Procedimiento INCRO' }] });
    });
    load('wsp_1', fetchMock).loadLibSkills();
    for (let i = 0; i < 10; i++) await flush();
    const mount = document.getElementById('wsxLibMount')!;
    const own = mount.innerHTML.indexOf('Procedimiento INCRO');
    const off = mount.innerHTML.indexOf('Test-Driven Development');
    expect(own).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(own);
  });
});
