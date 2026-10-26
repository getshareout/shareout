// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));
vi.mock('../src/toast', () => ({ showToast: vi.fn() }));

import { showConfirmDialog } from '../src/ui/confirm-dialog';
import { publish, staleBaseLine } from '../src/persistence/draft';

const STALE = {
  success: false,
  code: 'STALE_BASE',
  live: { versionNo: 14, updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), by: 'Ana', byYou: false, source: 'api' },
  baseVersionNo: 12,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeCtx(): any {
  const doc = new DOMParser().parseFromString('<!doctype html><html><body><h1>Mine</h1></body></html>', 'text/html');
  return {
    config: { artifactId: 'artifact-1' },
    state: { html: '', isDirty: true, baseLiveAt: '2026-09-19T00:00:00.000Z' },
    dom: { canvasFrame: { contentDocument: doc } },
  };
}
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

describe('full editor publish over a newer live version', () => {
  beforeEach(() => {
    vi.mocked(showConfirmDialog).mockReset();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
  });

  it('sends the base, explains who changed it, and stops when the person says not now', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(STALE, 409));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(showConfirmDialog).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await publish(makeCtx());

    expect(bodyOf(fetchMock.mock.calls[0]).baseLiveAt).toBe('2026-09-19T00:00:00.000Z');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const dialog = vi.mocked(showConfirmDialog).mock.calls[1][0];
    expect(dialog.title).toBe('Changed since you started');
    expect(dialog.body).toContain('v14 · Ana · 2 hours ago');
    expect(dialog.confirmLabel).toBe('Publish anyway');
  });

  it('"Publish anyway" republishes without the base and adopts the new live timestamp', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(STALE, 409))
      .mockResolvedValueOnce(json({ success: true, versionNo: 15, liveUpdatedAt: '2026-10-25T00:00:00.000Z' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const ctx = makeCtx();

    await publish(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[1]).baseLiveAt).toBeUndefined();
    expect(ctx.state.baseLiveAt).toBe('2026-10-25T00:00:00.000Z');
    expect(ctx.state.version).toBe(15);
  });

  it('speaks Spanish to a Spanish browser', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-AR');
    expect(staleBaseLine({ live: { ...STALE.live, byYou: true } })).toMatch(/^v14 · vos · hace 2 horas$/);
  });
});
