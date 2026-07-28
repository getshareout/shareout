import { describe, expect, it, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  resolveSelectTarget,
  getCanvasElementAt,
  getSelectionContext,
} from '../src/canvas/selection-target';

describe('resolveSelectTarget', () => {
  let window: Window;
  let doc: Document;
  let ctx: { body: Element; documentElement: Element };

  beforeEach(() => {
    window = new Window();
    doc = window.document;
    doc.body.innerHTML = `
      <main>
        <section class="hero">
          <div class="copy"><h1>Title</h1></div>
          <aside class="phone"><div class="screen"><span class="label">Hi</span></div></aside>
        </section>
      </main>
    `;
    ctx = getSelectionContext(doc)!;
  });

  it('returns innermost block for nested click', () => {
    const span = doc.querySelector('.label')!;
    expect(resolveSelectTarget(span, ctx)?.className).toBe('label');
  });

  it('returns aside when clicking phone shell', () => {
    const phone = doc.querySelector('.phone')!;
    expect(resolveSelectTarget(phone, ctx)).toBe(phone);
  });

  it('does not select body', () => {
    expect(resolveSelectTarget(doc.body, ctx)).toBeNull();
  });

  it('walks up from text node parent to h1', () => {
    const h1 = doc.querySelector('h1')!;
    expect(resolveSelectTarget(h1, ctx)).toBe(h1);
  });

  it('selects unknown tags via generic fallback when no block ancestor', () => {
    const custom = doc.createElement('custom-block');
    custom.className = 'widget';
    doc.body.appendChild(custom);
    expect(resolveSelectTarget(custom, ctx)).toBe(custom);
  });
});

describe('getCanvasElementAt', () => {
  it('returns null when iframe has no document', () => {
    const iframe = document.createElement('iframe');
    const ctx = { body: document.body, documentElement: document.documentElement };
    expect(getCanvasElementAt(10, 10, iframe, ctx)).toBeNull();
  });
});
