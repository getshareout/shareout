import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modalShell, componentScripts } from '../../../src/design-system/components/index';

// Runs in the happy-dom project (see vitest.config.ts) so document/window exist.
describe('component browser scripts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // @ts-expect-error reset the modal-init guard between runs
    window.__soModalInit = undefined;
    eval(componentScripts);
  });
  afterEach(() => vi.useRealTimers());

  it('soModalOpen / soModalClose toggle overlay display', () => {
    document.body.innerHTML = modalShell({ id: 'm', title: 'T', body: '', footer: '' });
    const ov = document.getElementById('m') as HTMLElement;
    expect(ov.style.display).toBe('none');
    (window as unknown as { soModalOpen(id: string): void }).soModalOpen('m');
    expect(ov.style.display).toBe('flex');
    (window as unknown as { soModalClose(id: string): void }).soModalClose('m');
    expect(ov.style.display).toBe('none');
  });

  it('showToast appends a toast and removes it after the timeout', () => {
    vi.useFakeTimers();
    (window as unknown as { showToast(m: string, t?: string): void }).showToast('Saved', 'success');
    const toast = document.querySelector('.so-c-toast');
    expect(toast?.textContent).toBe('Saved');
    expect(toast?.className).toContain('so-c-toast--success');
    vi.advanceTimersByTime(2500);
    expect(document.querySelector('.so-c-toast')).toBeNull();
  });
});
