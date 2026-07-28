import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createScrollController } from '../src/scroll-controller';

// happy-dom does no layout, so scroll metrics are stubbed. scrollTop clamps to
// [0, scrollHeight - clientHeight] like a real browser so scroll-to-bottom lands.
function makeViewport(scrollHeight: number, clientHeight: number) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let sh = scrollHeight;
  let st = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => sh });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => st,
    set: (v: number) => {
      st = Math.max(0, Math.min(v, sh - clientHeight));
    },
  });
  el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  return {
    el,
    setHeight(v: number) {
      sh = v;
    },
    scrollTo(v: number) {
      el.scrollTop = v;
      el.dispatchEvent(new Event('scroll'));
    },
  };
}

function maxScroll(scrollHeight: number, clientHeight: number) {
  return scrollHeight - clientHeight;
}

describe('createScrollController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('follows by default: stickToBottom scrolls to the edge', () => {
    const v = makeViewport(1000, 200);
    const c = createScrollController(v.el);
    c.stickToBottom();
    expect(v.el.scrollTop).toBe(maxScroll(1000, 200));
    expect(c.following).toBe(true);
  });

  it('stops following when the reader scrolls away, and does not move them on append', () => {
    const v = makeViewport(1000, 200);
    const onAway = vi.fn();
    const c = createScrollController(v.el, { onAppendWhileAway: onAway });
    v.scrollTo(100); // far from bottom (max 800)
    expect(c.following).toBe(false);
    expect(c.mode).toBe('away');
    c.stickToBottom();
    expect(v.el.scrollTop).toBe(100); // unmoved
    expect(onAway).toHaveBeenCalledOnce();
  });

  it('resumes following when the reader returns to the edge', () => {
    const v = makeViewport(1000, 200);
    const c = createScrollController(v.el);
    v.scrollTo(100);
    expect(c.following).toBe(false);
    v.scrollTo(maxScroll(1000, 200)); // back to bottom
    expect(c.following).toBe(true);
  });

  it('ignores the scroll event caused by its own programmatic scroll', () => {
    const v = makeViewport(1000, 200);
    const c = createScrollController(v.el);
    c.stickToBottom(); // sets scrollTop, real browser would fire scroll
    v.el.dispatchEvent(new Event('scroll')); // the programmatic echo
    expect(c.following).toBe(true); // not flipped to away
  });

  it('anchor-and-hold: anchors a new turn near the top and does not scroll while it fits', () => {
    const v = makeViewport(400, 200); // content fits-ish
    const c = createScrollController(v.el);
    const turn = document.createElement('div');
    turn.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
    v.el.appendChild(turn);
    c.anchorTop(turn);
    expect(c.mode).toBe('hold');
    expect(v.el.scrollTop).toBe(Math.min(300 - 12, maxScroll(400, 200)));
    const held = v.el.scrollTop;
    c.stickToBottom(); // answer not past the bottom yet
    expect(v.el.scrollTop).toBe(held); // still held, no jump
  });

  it('begins following once the held answer grows past the viewport bottom', () => {
    const v = makeViewport(400, 200);
    const c = createScrollController(v.el);
    const turn = document.createElement('div');
    turn.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    v.el.appendChild(turn);
    c.anchorTop(turn);
    expect(c.mode).toBe('hold');
    v.setHeight(2000); // answer streamed in, now overflows
    c.stickToBottom();
    expect(c.mode).toBe('follow');
    expect(v.el.scrollTop).toBe(maxScroll(2000, 200));
  });

  it('pauses follow while text is selected inside the list', () => {
    const v = makeViewport(1000, 200);
    const c = createScrollController(v.el);
    const node = document.createElement('span');
    v.el.appendChild(node);
    const range = { commonAncestorContainer: node };
    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    document.dispatchEvent(new Event('selectionchange'));
    c.stickToBottom();
    expect(v.el.scrollTop).toBe(0); // did not stick while selecting
  });

  it('jumpToLatest returns to the edge and re-arms follow', () => {
    const v = makeViewport(1000, 200);
    const c = createScrollController(v.el);
    v.scrollTo(0);
    expect(c.following).toBe(false);
    c.jumpToLatest();
    expect(v.el.scrollTop).toBe(maxScroll(1000, 200));
    expect(c.following).toBe(true);
  });

  it('preserveOnPrepend keeps the reader on the same content', () => {
    const v = makeViewport(1000, 200);
    const c = createScrollController(v.el);
    v.scrollTo(300);
    c.preserveOnPrepend(() => v.setHeight(1500)); // +500 above
    expect(v.el.scrollTop).toBe(800); // 300 + 500
  });

  it('onEdgeChange fires on transitions only', () => {
    const v = makeViewport(1000, 200);
    const onEdge = vi.fn();
    const c = createScrollController(v.el, { onEdgeChange: onEdge });
    v.scrollTo(0); // follow -> away
    v.scrollTo(maxScroll(1000, 200)); // away -> follow
    expect(onEdge).toHaveBeenCalledTimes(2);
    expect(onEdge).toHaveBeenNthCalledWith(1, false);
    expect(onEdge).toHaveBeenNthCalledWith(2, true);
  });
});
