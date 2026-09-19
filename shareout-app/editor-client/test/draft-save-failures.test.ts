// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/confirm-dialog', () => ({
  showConfirmDialog: vi.fn(),
}));

import { showConfirmDialog } from '../src/ui/confirm-dialog';
import { saveDraft } from '../src/persistence/draft';

function makeCtx(): any {
  const status = document.createElement('span');
  status.id = 'save-status';
  document.body.appendChild(status);

  const doc = new DOMParser().parseFromString(
    '<!doctype html><html><body><h1>Hello</h1></body></html>',
    'text/html'
  );

  return {
    config: { artifactId: 'artifact-1' },
    state: {
      html: '',
      isDirty: true,
      draftUpdatedAt: '2026-09-19T00:00:00.000Z',
    },
    dom: {
      saveStatus: status,
      canvasFrame: { contentDocument: doc },
    },
  };
}

describe('saveDraft failure surfacing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows failed state for 401 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })));
    const ctx = makeCtx();
    const ok = await saveDraft(ctx);
    expect(ok).toBe(false);
    expect(ctx.dom.saveStatus.className).toBe('save-status error');
    expect(ctx.dom.saveStatus.textContent).toBe('Save failed');
  });

  it('shows failed state for network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const ctx = makeCtx();
    const ok = await saveDraft(ctx);
    expect(ok).toBe(false);
    expect(ctx.dom.saveStatus.className).toBe('save-status error');
    expect(ctx.dom.saveStatus.textContent).toBe('Save failed');
  });

  it('surfaces 409 conflicts via the conflict dialog', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ currentUpdatedAt: '2026-09-19T00:01:00.000Z' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('save failed', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(showConfirmDialog).mockResolvedValue(false);

    const ctx = makeCtx();
    const ok = await saveDraft(ctx);
    expect(ok).toBe(false);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctx.dom.saveStatus.className).toBe('save-status error');
    expect(ctx.dom.saveStatus.textContent).toBe('Save failed');
  });
});
