// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';

type Opts = {
  key?: string;
  apply?: () => void;
  rollback?: () => void;
  request: () => unknown;
  error?: string;
  errors?: Record<string, string>;
};
type Described = { kind: string; detail?: string; retry?: boolean; ask?: boolean; ref?: string };
type Opt = ((o: Opts) => Promise<boolean>) & {
  labels: Record<string, string>;
  adminRequestUrl?: string;
  describe(e: unknown): Described;
  check(r: Response): Promise<Response> | Response;
  report(e: unknown, head: string, retry?: () => void): unknown;
  text(e: unknown, head: string): string;
};
const opt = () => (window as unknown as { soOptimistic: Opt }).soOptimistic;
const toasts = () => [...document.querySelectorAll('.so-c-toast')];
const last = () => toasts()[toasts().length - 1];
const act = (t: Element) => t.querySelector<HTMLButtonElement>('.so-c-toast__act');
const detail = (t: Element) => t.querySelector('.so-c-toast__detail')?.textContent;
const envelope = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ success: false, ...body }), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (res: Response | (() => never), error = "Couldn't create the folder. Try again?", extra: Partial<Opts> = {}) =>
  opt()({ request: typeof res === 'function' ? res : async () => res, error, ...extra });

beforeEach(() => {
  document.body.innerHTML = '';
  eval(componentScripts);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('soOptimistic error mapping', () => {
  it('a member refused by an admin gate: says who can, offers Ask an admin, never Retry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: 'sent' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    opt().adminRequestUrl = '/v1/workspaces/ws_1/admin-requests';
    const request = vi.fn(async () => envelope(403, { error: 'Only workspace admins can create Team Space folders', code: 'ADMIN_REQUIRED' }));
    await fail(request as never, "Couldn't create the folder. Try again?", { errors: { ADMIN_REQUIRED: 'Only workspace admins can create folders here.' } });
    const t = last();
    expect(t.querySelector('.so-c-toast__msg')!.textContent).toBe("Couldn't create the folder.");
    expect(detail(t)).toBe('Only workspace admins can create folders here.');
    expect(act(t)!.textContent).toBe('Ask an admin');

    act(t)!.click();
    await vi.waitFor(() => expect(last().textContent).toContain('Request sent to your workspace admins.'));
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/workspaces/ws_1/admin-requests');
    expect(JSON.parse(String(init.body))).toEqual({
      code: 'ADMIN_REQUIRED',
      action: "Couldn't create the folder.",
      message: 'Only workspace admins can create Team Space folders',
    });
  });

  it('a 403 with no ask endpoint on the page shows the reason with no action', async () => {
    await fail(envelope(403, { error: 'Requires workspace admin role.', code: 'INSUFFICIENT_ROLE' }));
    expect(detail(last())).toBe('Requires workspace admin role.');
    expect(act(last())).toBeNull();
  });

  it('replaces a bare status message ("Forbidden") with our own copy', async () => {
    await fail(envelope(403, { error: 'Forbidden', code: 'FORBIDDEN' }));
    expect(detail(last())).toBe("You don't have permission to do this.");
  });

  it('401 → session expired + Log in again', async () => {
    await fail(envelope(401, { error: 'Authentication required', code: 'UNAUTHORIZED' }));
    expect(detail(last())).toContain('session expired');
    expect(act(last())!.textContent).toBe('Log in again');
  });

  it('404 → deleted or moved + Refresh', async () => {
    await fail(envelope(404, { error: 'Folder not found', code: 'NOT_FOUND' }));
    expect(detail(last())).toBe('It may have been deleted or moved.');
    expect(act(last())!.textContent).toBe('Refresh');
  });

  it('400 / 409 / limits show the server reason, with no Retry', async () => {
    await fail(envelope(400, { error: 'Folder name is required', code: 'VALIDATION_ERROR' }));
    expect(detail(last())).toBe('Folder name is required');
    expect(act(last())).toBeNull();
    await fail(envelope(409, { error: 'A folder with that name already exists', code: 'CONFLICT' }));
    expect(detail(last())).toBe('A folder with that name already exists');
    expect(act(last())).toBeNull();
    await fail(envelope(403, { error: 'Storage is full (1 GB).', code: 'STORAGE_LIMIT_EXCEEDED' }));
    expect(detail(last())).toBe('Storage is full (1 GB).');
    expect(act(last())).toBeNull();
  });

  it('429 → wait a moment, Retry is fine', async () => {
    await fail(envelope(429, { error: 'Rate limit reached', code: 'RATE_LIMIT_EXCEEDED' }));
    expect(detail(last())).toContain('Wait a moment');
    expect(act(last())!.textContent).toBe('Retry');
    expect(last().querySelector('.so-c-toast__msg')!.textContent).toContain('Try again?');
  });

  it('5xx → our side + Retry + a copyable request reference', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write }, onLine: true });
    await fail(envelope(500, { error: 'Internal error', code: 'INTERNAL_ERROR', request_id: '1a2b3c4d-5e6f-7a8b-9c0d-112233445566' }));
    expect(detail(last())).toBe('Something went wrong on our side.');
    expect(act(last())!.textContent).toBe('Retry');
    const ref = last().querySelector<HTMLButtonElement>('.so-c-toast__ref')!;
    expect(ref.textContent).toBe('Ref 1a2b3c4d');
    ref.click();
    expect(write).toHaveBeenCalledWith('1a2b3c4d-5e6f-7a8b-9c0d-112233445566');
  });

  it('a request that never reached the server → connection copy + Retry', async () => {
    await fail(() => { throw new TypeError('Failed to fetch'); });
    expect(detail(last())).toContain('Check your connection');
    expect(act(last())!.textContent).toBe('Retry');
  });

  it('a non-JSON error page still maps by status', async () => {
    await fail(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(detail(last())).toBe('Something went wrong on our side.');
  });

  it('uses the surface labels for reasons and actions', async () => {
    opt().labels = { adminOnly: 'Solo los admins del workspace pueden hacer esto.', askAdmin: 'Pedir acceso al admin' };
    opt().adminRequestUrl = '/x';
    await fail(envelope(403, { error: 'x', code: 'ADMIN_REQUIRED' }), 'No se pudo crear la carpeta. ¿Probás de nuevo?');
    expect(last().querySelector('.so-c-toast__msg')!.textContent).toBe('No se pudo crear la carpeta.');
    expect(detail(last())).toBe('Solo los admins del workspace pueden hacer esto.');
    expect(act(last())!.textContent).toBe('Pedir acceso al admin');
  });
});

describe('soOptimistic helpers for plain fetches', () => {
  it('check() passes ok replies and rejects others with the envelope; text()/report() reuse the mapping', async () => {
    const ok = new Response('{}');
    expect(opt().check(ok)).toBe(ok);
    const err = await (opt().check(envelope(409, { error: 'Name taken', code: 'CONFLICT' })) as Promise<Response>).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT', serverMessage: 'Name taken' });
    expect(opt().describe(err)).toMatchObject({ kind: 'conflict', detail: 'Name taken' });
    expect(opt().text(err, "Couldn't rename. Try again?")).toBe("Couldn't rename. Name taken");
    opt().report(err, "Couldn't rename");
    expect(detail(last())).toBe('Name taken');
  });

  it('keeps old behavior for errors a call site throws itself (noRetry still wins)', async () => {
    await fail(() => { const e = new Error('approval') as Error & { noRetry?: boolean }; e.noRetry = true; throw e; }, 'Needs approval');
    expect(act(last())).toBeNull();
    await fail(() => { throw new Error('partial'); }, 'Some moves failed');
    expect(act(last())!.textContent).toBe('Retry');
  });
});
