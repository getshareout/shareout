import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUnreadTracker } from '../src/unread';
import type { ScrollController } from '../src/scroll-controller';

function fakeController(mode: 'follow' | 'hold' | 'away'): ScrollController {
  return { mode, following: mode === 'follow' } as ScrollController;
}

describe('createUnreadTracker', () => {
  let list: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="l"></div>';
    list = document.getElementById('l') as HTMLElement;
  });

  it('does not count while the reader is following', () => {
    const onCount = vi.fn();
    const t = createUnreadTracker(fakeController("follow"), { onCount });
    const el = document.createElement('div');
    list.appendChild(el);
    t.onAppend(el);
    expect(t.count).toBe(0);
    expect(onCount).not.toHaveBeenCalled();
  });

  it('does not count while anchored in hold (the reader is reading the new turn)', () => {
    const onCount = vi.fn();
    const t = createUnreadTracker(fakeController('hold'), { onCount });
    const el = document.createElement('div');
    list.appendChild(el);
    t.onAppend(el);
    expect(t.count).toBe(0);
    expect(onCount).not.toHaveBeenCalled();
  });

  it('counts and reports appends while away', () => {
    const onCount = vi.fn();
    const t = createUnreadTracker(fakeController("away"), { onCount });
    const a = document.createElement('div');
    const b = document.createElement('div');
    list.append(a, b);
    t.onAppend(a);
    t.onAppend(b);
    expect(t.count).toBe(2);
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it('inserts a divider before the first unread message only', () => {
    const t = createUnreadTracker(fakeController("away"), {
      makeDivider: () => {
        const d = document.createElement('div');
        d.className = 'unread-divider';
        return d;
      },
    });
    const a = document.createElement('div');
    const b = document.createElement('div');
    list.append(a, b);
    t.onAppend(a);
    t.onAppend(b);
    const dividers = list.querySelectorAll('.unread-divider');
    expect(dividers).toHaveLength(1);
    expect(a.previousElementSibling).toBe(dividers[0]);
  });

  it('reset clears the count and removes the divider', () => {
    const onCount = vi.fn();
    const t = createUnreadTracker(fakeController("away"), {
      onCount,
      makeDivider: () => document.createElement('div'),
    });
    const a = document.createElement('div');
    list.appendChild(a);
    t.onAppend(a);
    t.reset();
    expect(t.count).toBe(0);
    expect(list.children).toHaveLength(1); // divider gone
    expect(onCount).toHaveBeenLastCalledWith(0);
  });
});
