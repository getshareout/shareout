// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { showConfirmDialog } from '../src/ui/confirm-dialog';

describe('showConfirmDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves true on primary action', async () => {
    const p = showConfirmDialog({ title: 'T', body: 'B', confirmLabel: 'Yes', cancelLabel: 'No' });
    const dialog = document.getElementById('so-studio-confirm');
    expect(dialog).toBeTruthy();
    (dialog!.querySelector('[data-action="confirm"]') as HTMLButtonElement).click();
    await expect(p).resolves.toBe(true);
    expect(document.getElementById('so-studio-confirm')).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const p = showConfirmDialog({ title: 'T', body: 'B' });
    (document.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();
    await expect(p).resolves.toBe(false);
  });
});
