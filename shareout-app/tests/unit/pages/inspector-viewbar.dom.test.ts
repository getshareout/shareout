// @vitest-environment happy-dom
//
// Home → Details → More → ShareOut bar: the switch that hides the viewer header,
// now that the viewer no longer has its own Settings panel.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_inspector_details_JS as detailsJs } from '../../../src/pages/home/render-workspace/client-script/inspector-details';

type Opt = { apply: () => void; rollback: () => void; request: () => Promise<Response>; error: string };
let fetchMock: ReturnType<typeof vi.fn>;
let optimisticCalls: Opt[];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function load(): (art: { id: string }) => void {
  optimisticCalls = [];
  const optimistic = (o: Opt) => {
    optimisticCalls.push(o);
    o.apply();
    return o.request().then((r) => { if (!r.ok) o.rollback(); });
  };
  const factory = new Function('t', 'esc', 'isvg', 'optimistic', `${detailsJs}\n; return wireViewBar;`);
  return factory((k: string) => k, (s: unknown) => String(s), () => '', optimistic);
}

beforeEach(() => {
  document.body.innerHTML = '<input type="checkbox" id="wsxViewBar" disabled>';
  fetchMock = vi.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = (...a: unknown[]) => fetchMock(...a);
});

describe('ShareOut bar switch', () => {
  it('reads the saved setting: on unless the owner hid the header', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { value: { hide_toolbar: true } } })));
    load()({ id: 'art_1' });
    await flush();
    const inp = document.getElementById('wsxViewBar') as HTMLInputElement;
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/data/art_1/json/_viewer_config');
    expect(inp.disabled).toBe(false);
    expect(inp.checked).toBe(false);
  });

  it('a page with no setting yet shows the bar on', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    load()({ id: 'art_2' });
    await flush();
    expect((document.getElementById('wsxViewBar') as HTMLInputElement).checked).toBe(true);
  });

  it('turning it off saves hide_toolbar: true, and a failed save flips it back', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    load()({ id: 'art_3' });
    await flush();
    const inp = document.getElementById('wsxViewBar') as HTMLInputElement;
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    inp.checked = false;
    inp.dispatchEvent(new Event('change'));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/v1/data/art_3/json/_viewer_config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ hide_toolbar: true });
    expect(optimisticCalls[0].error).toBe('inspector.viewBarFailed');
    await flush();
    expect(inp.checked).toBe(true);
  });
});
