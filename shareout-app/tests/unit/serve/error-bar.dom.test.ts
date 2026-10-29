// @vitest-environment happy-dom
//
// The viewer's error bar: shown when the page inside the frame broke, and — for a
// signed-in viewer — one click files a support ticket with the errors attached.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderErrorBar, type ErrorBarOptions } from '../../../src/serve/sandbox-viewer/error-bar';

const BASE = 'https://shareout.example.com';
const ERR = { kind: 'error', message: "SyntaxError: Invalid or unexpected token", where: '/index.html:125:30', stack: '', path: 'index.html' };

type Win = typeof window & { __soErrors?: unknown[] };

function mount(over: Partial<ErrorBarOptions> = {}, fetchImpl?: (url: string, init: RequestInit) => Promise<Response>) {
  const opts: ErrorBarOptions = {
    artifactId: 'art_1', versionId: 'ver_2', workspaceId: 'wsp_1', slug: 'demo', baseUrl: BASE,
    locale: 'es', canReport: true, withVars: false, ...over,
  };
  const html = renderErrorBar(opts);
  document.body.innerHTML = html;
  const fetchMock = vi.fn(fetchImpl ?? (async () => new Response(JSON.stringify({ success: true, ticket: { id: 'tkt_42' } }), { status: 201 })));
  vi.stubGlobal('fetch', fetchMock);
  const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  new Function(code)();
  const bar = document.getElementById('so-err')!;
  const q = (sel: string) => bar.querySelector(sel) as HTMLElement;
  return { bar, q, fetchMock };
}

function raise(e = ERR) {
  const w = window as Win;
  (w.__soErrors ||= []).push(e);
  window.dispatchEvent(new Event('shareout:error'));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete (window as Win).__soErrors;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('viewer error bar', () => {
  it('stays hidden until the page reports an error, then says so with the detail', () => {
    const { bar, q } = mount();
    expect(bar.hidden).toBe(true);
    raise();
    expect(bar.hidden).toBe(false);
    expect(q('.so-err-title').textContent).toContain('Algo falló en esta página');
    expect(q('.so-err-detail').hidden).toBe(true);
    q('[data-so-err="detail"]').click();
    expect(q('.so-err-detail').hidden).toBe(false);
    expect(q('.so-err-detail').textContent).toContain('SyntaxError: Invalid or unexpected token');
    expect(q('.so-err-detail').textContent).toContain('/index.html:125:30');
  });

  it('shows errors that arrived before it rendered (a broken page errors right away)', () => {
    (window as Win).__soErrors = [ERR];
    const { bar } = mount();
    expect(bar.hidden).toBe(false);
  });

  it('files one support ticket with the page, version and errors', async () => {
    const { q, fetchMock } = mount();
    raise();
    q('[data-so-err="report"]').click();
    await flush(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/support/tickets`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      category: 'bug', severity: 'normal', client: 'ui', artifactId: 'art_1', workspaceId: 'wsp_1', locale: 'es',
      pageUrl: location.href,
    });
    expect(body.subject).toMatch(/^Error en la página: /);
    expect(body.body).toContain('art_1 · version ver_2');
    expect(body.body).toContain('SyntaxError: Invalid or unexpected token');
    expect(body.idempotencyKey).toMatch(/^page-error:art_1:ver_2:[0-9a-z]+$/);
    expect(q('.so-err-status').textContent).toBe('Reportado como tkt_42. Te respondemos por mail.');
    expect(q('[data-so-err="report"]').hidden).toBe(true);
  });

  it('files a personal ticket when the viewer is not a member of the page workspace', async () => {
    const { q, fetchMock } = mount({}, async (_u, init) => {
      const b = JSON.parse(init.body as string);
      return b.workspaceId
        ? new Response('{}', { status: 403 })
        : new Response(JSON.stringify({ ticket: { id: 'tkt_7' } }), { status: 201 });
    });
    raise();
    q('[data-so-err="report"]').click();
    await flush(); await flush(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).workspaceId).toBeUndefined();
    expect(q('.so-err-status').textContent).toContain('tkt_7');
  });

  it('says so when the report fails, and lets the viewer retry', async () => {
    const { q } = mount({ locale: 'en', workspaceId: null }, async () => new Response('{}', { status: 500 }));
    raise();
    q('[data-so-err="report"]').click();
    await flush(); await flush();
    expect(q('.so-err-status').textContent).toBe('Could not send the report. Try again.');
    expect((q('[data-so-err="report"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a signed-out viewer gets no report button, just who to tell', () => {
    const { q } = mount({ canReport: false, locale: 'en' });
    raise();
    expect(q('[data-so-err="report"]').hidden).toBe(true);
    expect(q('.so-err-status').textContent).toMatch(/Sign in to report it/);
  });

  it('dismiss hides it for the rest of the visit', () => {
    const { bar, q } = mount();
    raise();
    q('.so-err-x').click();
    raise({ ...ERR, message: 'another' });
    expect(bar.hidden).toBe(true);
  });
});
