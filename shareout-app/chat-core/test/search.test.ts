import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChatSearch } from '../src/search';
import type { ScrollController } from '../src/scroll-controller';

function fakeController() {
  return { scrollToAnchor: vi.fn() } as unknown as ScrollController & {
    scrollToAnchor: ReturnType<typeof vi.fn>;
  };
}

describe('createChatSearch', () => {
  let vp: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="vp">' +
      '<div class="m">hello world</div>' +
      '<div class="m">the world is wide, world over</div>' +
      '</div>';
    vp = document.getElementById('vp') as HTMLElement;
  });

  it('highlights all case-insensitive matches and counts them', () => {
    const onCount = vi.fn();
    const s = createChatSearch(vp, fakeController(), { messageSelector: '.m', onCount });
    const total = s.search('WORLD');
    expect(total).toBe(3);
    expect(vp.querySelectorAll('mark.cc-hit')).toHaveLength(3);
    expect(onCount).toHaveBeenLastCalledWith(1, 3); // first active
  });

  it('scrolls to the active hit and cycles with next/prev', () => {
    const c = fakeController();
    const s = createChatSearch(vp, c, { messageSelector: '.m' });
    s.search('world');
    expect(c.scrollToAnchor).toHaveBeenCalledTimes(1);
    const hits = () => vp.querySelectorAll('mark.cc-hit');
    expect(hits()[0].classList.contains('cc-hit-active')).toBe(true);
    s.next();
    expect(hits()[1].classList.contains('cc-hit-active')).toBe(true);
    s.prev();
    expect(hits()[0].classList.contains('cc-hit-active')).toBe(true);
    s.next();
    s.next();
    s.next(); // wraps back to first
    expect(hits()[0].classList.contains('cc-hit-active')).toBe(true);
  });

  it('clear restores the original text with no marks', () => {
    const s = createChatSearch(vp, fakeController(), { messageSelector: '.m' });
    s.search('world');
    s.clear();
    expect(vp.querySelectorAll('mark')).toHaveLength(0);
    expect(vp.querySelectorAll('.m')[0].textContent).toBe('hello world');
    expect(vp.querySelectorAll('.m')[1].textContent).toBe('the world is wide, world over');
  });

  it('empty query clears and reports zero', () => {
    const onCount = vi.fn();
    const s = createChatSearch(vp, fakeController(), { messageSelector: '.m', onCount });
    s.search('world');
    const total = s.search('   ');
    expect(total).toBe(0);
    expect(vp.querySelectorAll('mark')).toHaveLength(0);
    expect(onCount).toHaveBeenLastCalledWith(0, 0);
  });
});
