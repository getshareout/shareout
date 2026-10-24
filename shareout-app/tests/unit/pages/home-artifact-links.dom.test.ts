// @vitest-environment happy-dom
//
// Studio opens /a/<slug>/ links as tabs, but the full-editor link must navigate.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_artifact_links_JS as linksJs } from '../../../src/pages/home/render-workspace/client-script/artifact-links';

let opened: string[];

beforeEach(() => {
  document.body.innerHTML = '<div id="wsxBody"><a id="view" href="/a/inc/">x</a><a id="edit" href="/a/inc/edit" target="_blank">e</a></div>';
  opened = [];
  const scope = new Proxy({}, {
    has: () => true,
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'openArtifact') return (slug: string) => opened.push(slug);
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  new Function('scope', `with (scope) {\n${linksJs}\n}`)(scope);
});

const click = (id: string) => {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  document.getElementById(id)!.dispatchEvent(ev);
  return ev.defaultPrevented;
};

describe('artifact links', () => {
  it('opens artifact links as tabs', () => {
    expect(click('view')).toBe(true);
    expect(opened).toEqual(['inc']);
  });

  it('lets "Open full editor" navigate to /a/<slug>/edit', () => {
    expect(click('edit')).toBe(false);
    expect(opened).toEqual([]);
  });
});
