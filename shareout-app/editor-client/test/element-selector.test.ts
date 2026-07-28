import { describe, expect, it, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import { getElementSelector } from '../src/dom/element-selector';

describe('getElementSelector', () => {
  let doc: Document;

  beforeEach(() => {
    const window = new Window();
    doc = window.document;
    doc.body.innerHTML = '<div id="root"><p class="a b">x</p></div>';
  });

  it('uses stable data-editor-id selector', () => {
    const root = doc.getElementById('root')!;
    expect(getElementSelector(root)).toMatch(/\[data-editor-id="/);
  });

  it('resolves nested element by editor id', () => {
    const p = doc.querySelector('p')!;
    const sel = getElementSelector(p);
    expect(sel).toContain('data-editor-id');
  });
});
