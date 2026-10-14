// @vitest-environment happy-dom
//
// Studio artifact panes by type: a PDF stage is never sandboxed (Chrome blocks its
// PDF viewer in any sandboxed frame) and binary types never offer Edit.
import { describe, expect, it } from 'vitest';
import { workspace_client_tabs_JS as tabsJs } from '../../../src/pages/home/render-workspace/client-script/tabs';

type Art = { key: string; id: string; slug: string; name: string; type?: string; canEdit?: boolean };
type Rec = { iframe: HTMLIFrameElement; art: Art };

function load(meta: Record<string, unknown> | null = null) {
  document.body.innerHTML = '<div id="wsxTabs"></div><div id="wsxPanes"></div><div id="wsxHomePane"></div>'
    + '<div id="wsxTabMode"><button data-mode="view"></button><button data-mode="edit"></button></div>'
    + '<button id="wsxTabDevice"></button><button id="wsxTabFull"></button>';
  const metaCalls: string[] = [];
  const base: Record<string, unknown> = {
    t: (k: string) => k,
    esc: (s: unknown) => String(s ?? ''),
    isvg: () => '',
    statsCache: {},
    metaCache: {},
    fetchMeta: (a: Art, cb: (d: unknown) => void) => { metaCalls.push(a.slug); cb(meta); },
    setEditMode: () => {}, publishEdit: () => {}, undoEdit: () => {}, redoEdit: () => {}, discardDraft: () => {},
  };
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in base) return base[prop];
      return (globalThis as Record<string, unknown>)[prop];
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  const api = new Function('scope', `with (scope) {\n${tabsJs}\n; return { makeArtifactPane, panes: panes, syncTabMode, activate: function (k, r) { panes[k] = r; activeKey = k; } }; }`)(scope) as {
    makeArtifactPane: (a: Art) => Rec;
    panes: Record<string, Rec>;
    syncTabMode: () => void;
    activate: (k: string, r: Rec) => void;
  };
  return { ...api, metaCalls };
}

const art = (type?: string): Art => ({ key: 'k', id: 'art_1', slug: 'doc', name: 'Doc', ...(type !== undefined ? { type } : {}) });
const editToggleHidden = () => (document.getElementById('wsxTabMode') as HTMLElement).hidden;

describe('stage iframe by artifact type', () => {
  it('loads a PDF without a sandbox', () => {
    const { makeArtifactPane } = load();
    const rec = makeArtifactPane(art('pdf'));
    expect(rec.iframe.hasAttribute('sandbox')).toBe(false);
    expect(rec.iframe.getAttribute('src')).toBe('/a/doc/?wsx=1');
  });

  it('keeps HTML and Markdown stages sandboxed', () => {
    const { makeArtifactPane } = load();
    for (const type of ['html', 'markdown', 'image']) {
      const rec = makeArtifactPane(art(type));
      expect(rec.iframe.getAttribute('sandbox'), type).toContain('allow-scripts');
    }
  });

  it('resolves an unknown type before the first load (tabs opened from links)', () => {
    const { makeArtifactPane, metaCalls } = load({ id: 'art_1', artifact_type: 'pdf' });
    const rec = makeArtifactPane(art());
    expect(metaCalls).toEqual(['doc']);
    expect(rec.art.type).toBe('pdf');
    expect(rec.iframe.hasAttribute('sandbox')).toBe(false);
  });

  it('falls back to a sandboxed stage when the type cannot be resolved', () => {
    const { makeArtifactPane } = load(null);
    const rec = makeArtifactPane(art());
    expect(rec.iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(rec.iframe.getAttribute('src')).toBe('/a/doc/?wsx=1');
  });
});

describe('Edit toggle by artifact type', () => {
  it('is hidden for PDF, image and video', () => {
    const { makeArtifactPane, activate, syncTabMode } = load();
    for (const type of ['pdf', 'image', 'video']) {
      activate('k', makeArtifactPane(art(type))); syncTabMode();
      expect(editToggleHidden(), type).toBe(true);
    }
  });

  it('shows for HTML and Markdown', () => {
    const { makeArtifactPane, activate, syncTabMode } = load();
    for (const type of ['html', 'markdown', 'csv']) {
      activate('k', makeArtifactPane(art(type))); syncTabMode();
      expect(editToggleHidden(), type).toBe(false);
    }
  });
});
