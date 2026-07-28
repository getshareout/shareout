import { describe, expect, it, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  EDITOR_ID_ATTR,
  ensureEditorId,
  resolveElementBySelector,
} from '../src/dom/editor-ids';
import { getElementSelector } from '../src/dom/element-selector';

describe('editor ids', () => {
  let doc: Document;

  beforeEach(() => {
    const window = new Window();
    doc = window.document;
    doc.body.innerHTML = '<div id="root"><p class="a">x</p></div>';
  });

  it('assigns and returns stable editor id', () => {
    const p = doc.querySelector('p')!;
    const id = ensureEditorId(p);
    expect(p.getAttribute(EDITOR_ID_ATTR)).toBe(id);
    expect(ensureEditorId(p)).toBe(id);
  });

  it('getElementSelector uses data-editor-id', () => {
    const p = doc.querySelector('p')!;
    const sel = getElementSelector(p);
    expect(sel).toMatch(/^\[data-editor-id="[^"]+"\]$/);
    expect(resolveElementBySelector(doc, sel)).toBe(p);
  });
});
