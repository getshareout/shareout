import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLiveAnnouncer } from '../src/announce';

describe('createLiveAnnouncer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function region() {
    return document.querySelector('[aria-live="polite"]') as HTMLElement;
  }

  it('mounts a visually-hidden polite live region', () => {
    createLiveAnnouncer();
    const r = region();
    expect(r).toBeTruthy();
    expect(r.getAttribute('role')).toBe('status');
    expect(r.style.position).toBe('absolute');
  });

  it('announces the first message immediately', () => {
    const a = createLiveAnnouncer({ throttleMs: 1000 });
    a.announce('Response complete');
    expect(region().textContent).toBe('Response complete');
  });

  it('coalesces rapid announcements to the latest within the window', () => {
    const a = createLiveAnnouncer({ throttleMs: 1000 });
    a.announce('one'); // immediate
    a.announce('two'); // throttled
    a.announce('three'); // throttled, latest wins
    expect(region().textContent).toBe('one');
    vi.advanceTimersByTime(1000);
    expect(region().textContent).toBe('three');
  });

  it('now:true bypasses the throttle', () => {
    const a = createLiveAnnouncer({ throttleMs: 1000 });
    a.announce('one');
    a.announce('urgent', { now: true });
    expect(region().textContent).toBe('urgent');
  });

  it('destroy removes the region', () => {
    const a = createLiveAnnouncer();
    a.destroy();
    expect(region()).toBeNull();
  });
});
