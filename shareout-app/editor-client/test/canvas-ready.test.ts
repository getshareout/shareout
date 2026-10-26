// @vitest-environment happy-dom
// The canvas copy runs no page scripts, so it never posts a ready message: the loading
// veil must lift as soon as the copy is parsed, not after the 3 s timeout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupReadySignal } from '../src/canvas/render-canvas';

function setup() {
  document.body.innerHTML = '<div id="canvas-loading"></div><iframe id="f"></iframe>';
  const frame = document.getElementById('f') as HTMLIFrameElement;
  return { dom: { canvasFrame: frame } as any, frame, veil: document.getElementById('canvas-loading')! };
}

afterEach(() => { vi.useRealTimers(); });

describe('canvas ready', () => {
  it('shows the canvas at once when the copy is already parsed', () => {
    vi.useFakeTimers();
    const { dom, frame, veil } = setup();
    const doc = document.implementation.createHTMLDocument('');
    setupReadySignal(dom, doc);
    expect(veil.classList.contains('hidden')).toBe(true);
    expect(frame.style.opacity).toBe('1');
  });

  it('waits for DOMContentLoaded while still parsing, not for the timeout', () => {
    vi.useFakeTimers();
    const { dom, frame, veil } = setup();
    const doc = document.implementation.createHTMLDocument('');
    Object.defineProperty(doc, 'readyState', { value: 'loading', configurable: true });
    setupReadySignal(dom, doc);
    expect(veil.classList.contains('hidden')).toBe(false);
    expect(frame.style.opacity).toBe('0');
    doc.dispatchEvent(new Event('DOMContentLoaded'));
    expect(veil.classList.contains('hidden')).toBe(true);
    expect(frame.style.opacity).toBe('1');
  });
});
