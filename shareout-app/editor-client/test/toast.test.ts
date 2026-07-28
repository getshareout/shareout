import { describe, expect, it, beforeEach } from 'vitest';
import { showToast } from '../src/toast';

const container = () => document.getElementById('toast-container');

describe('showToast', () => {
  beforeEach(() => container()?.remove()); // the container is a document singleton

  it('creates a toast container and message', () => {
    showToast('Saved', 'success');
    expect(container()).toBeTruthy();
    expect(container()?.textContent).toContain('Saved');
  });

  it('makes the container a polite live region so screen readers announce it (F9)', () => {
    showToast('Saved', 'success');
    expect(container()?.getAttribute('role')).toBe('status');
    expect(container()?.getAttribute('aria-live')).toBe('polite');
  });

  it('marks error toasts role="alert" (assertive) (F9)', () => {
    showToast('Publish failed', 'error');
    const toast = container()?.querySelector('[data-toast-message="Publish failed"]');
    expect(toast?.getAttribute('role')).toBe('alert');
  });

  it('dedupes identical messages so a retry storm does not stack them (F9)', () => {
    showToast('Save failed — retrying…', 'warning');
    showToast('Save failed — retrying…', 'warning');
    showToast('Save failed — retrying…', 'warning');
    expect(container()?.children.length).toBe(1);
  });

  it('caps the number of visible toasts (F9)', () => {
    for (let i = 0; i < 6; i++) showToast(`msg ${i}`, 'info');
    expect(container()?.children.length).toBe(3);
    // keeps the most recent
    expect(container()?.textContent).toContain('msg 5');
    expect(container()?.textContent).not.toContain('msg 0');
  });
});
