import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@cloudflare/puppeteer';
import {
  captureOwnHosts,
  captureRequestHeaders,
  decideCaptureRequest,
  guardCapturePage,
  isPrivateNetworkHost,
} from '../../../src/screenshots/request-policy';
import type { Env } from '../../../src/types';

describe('isPrivateNetworkHost', () => {
  it.each([
    'localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '100.100.100.200', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '[::1]', '[::]', '[fd00::1]', '[fd00:ec2::254]', '[fe80::1]', '[::ffff:7f00:1]',
    'db.internal', 'metadata.google.internal', 'metadata.goog', 'printer.local', 'nas.home.arpa',
    'router.lan', 'intranet', 'metadata', 'localhost.',
  ])('%s is private', (host) => expect(isPrivateNetworkHost(host)).toBe(true));

  it.each(['example.com', 'cdn.jsdelivr.net', '8.8.8.8', '172.32.0.1', '100.128.0.1', '[2606:4700::1111]', '2606:4700::1111'])(
    '%s is public', (host) => expect(isPrivateNetworkHost(host)).toBe(false),
  );
});

describe('decideCaptureRequest', () => {
  const own = new Set(['shareout.example', 'localhost']);

  it('lets public web requests and inline schemes through', () => {
    expect(decideCaptureRequest('https://cdn.jsdelivr.net/npm/x@1/x.js', own)).toEqual({ allow: true });
    expect(decideCaptureRequest('wss://realtime.example.org/socket', own)).toEqual({ allow: true });
    expect(decideCaptureRequest('data:image/png;base64,AA==', own)).toEqual({ allow: true });
    expect(decideCaptureRequest('blob:https://shareout.example/0b1c', own)).toEqual({ allow: true });
  });

  it('refuses private-network addresses and local names', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5:8080/admin',
      'http://[::1]:3000/',
      'http://2130706433/',
      'https://db.internal/rows',
      'http://intranet/wiki',
    ]) {
      expect(decideCaptureRequest(url, own), url).toEqual({ allow: false, reason: 'private_network' });
    }
  });

  it('refuses non-web schemes and unparseable URLs', () => {
    expect(decideCaptureRequest('file:///etc/passwd', own)).toEqual({ allow: false, reason: 'scheme' });
    expect(decideCaptureRequest('ftp://files.example.com/a', own)).toEqual({ allow: false, reason: 'scheme' });
    expect(decideCaptureRequest('not a url', own)).toEqual({ allow: false, reason: 'scheme' });
  });

  it('lets this instance reach itself, even on loopback', () => {
    expect(decideCaptureRequest('http://localhost:55162/v1/data/art_1/json', own)).toEqual({ allow: true });
    expect(decideCaptureRequest('https://shareout.example/sdk/shareout.js', own)).toEqual({ allow: true });
  });
});

describe('captureOwnHosts', () => {
  it('names the platform origin, its apex and the artifact origin', () => {
    const env = { SHAREOUT_BASE_URL: 'https://www.shareout.example', ARTIFACT_ORIGIN: 'https://cdn.example' } as unknown as Env;
    expect(captureOwnHosts(env).sort()).toEqual(['cdn.example', 'shareout.example', 'www.shareout.example']);
  });

  it('covers a local instance', () => {
    expect(captureOwnHosts({ SHAREOUT_BASE_URL: 'http://localhost:55162' } as unknown as Env)).toEqual(['localhost']);
  });
});

type Handler = (arg: unknown) => void;

function fakePage() {
  const handlers: Record<string, Handler[]> = {};
  const page = {
    setBypassServiceWorker: vi.fn(async () => {}),
    setRequestInterception: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
      return page;
    }),
  };
  const emit = (event: string, arg: unknown) => (handlers[event] ?? []).forEach((h) => h(arg));
  return { page, asPage: page as unknown as Page, emit };
}

function fakeRequest(url: string, headers: Record<string, string> = {}) {
  return {
    url: () => url,
    headers: () => headers,
    isInterceptResolutionHandled: () => false,
    continue: vi.fn(async (_overrides?: { headers?: Record<string, string> }) => {}),
    abort: vi.fn(async () => {}),
  };
}

const fakeResponse = (url: string, ip?: string, port?: number) => ({ url: () => url, remoteAddress: () => ({ ip, port }) });

describe('guardCapturePage', () => {
  const OWN = ['shareout.example'];

  it('turns on interception, bypasses service workers, and aborts what the policy refuses', async () => {
    const { page, asPage, emit } = fakePage();
    const guard = await guardCapturePage(asPage, OWN);
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(page.setBypassServiceWorker).toHaveBeenCalledWith(true);

    const pub = fakeRequest('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.js');
    const meta = fakeRequest('http://169.254.169.254/latest/meta-data/iam/');
    emit('request', pub);
    emit('request', meta);

    expect(pub.continue).toHaveBeenCalled();
    expect(pub.abort).not.toHaveBeenCalled();
    expect(meta.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(meta.continue).not.toHaveBeenCalled();
    expect(guard.blocked()).toBe(1);
  });

  it('reports a public name that answered from a private address over a direct connection', async () => {
    const { asPage, emit } = fakePage();
    const guard = await guardCapturePage(asPage, OWN);
    emit('response', fakeResponse('https://shareout.example/a/demo/?_capture=x', '104.16.1.1', 443));
    emit('response', fakeResponse('https://cdn.jsdelivr.net/npm/x@1/x.js', '151.101.1.229', 443));
    expect(guard.privateResponse()).toBeNull();

    emit('response', fakeResponse('https://inward.example.net/secret.json', '10.0.0.7', 443));
    expect(guard.privateResponse()).toBe('10.0.0.7');
  });

  it('counts IPv6 private addresses too', async () => {
    const { asPage, emit } = fakePage();
    const guard = await guardCapturePage(asPage, OWN);
    emit('response', fakeResponse('http://inward.example.net:8080/x', '[fd12:3456::1]', 8080));
    expect(guard.privateResponse()).toBe('[fd12:3456::1]');
  });

  it('ignores responses relayed by an egress proxy (remote port is not the URL port)', async () => {
    const { asPage, emit } = fakePage();
    const guard = await guardCapturePage(asPage, OWN);
    emit('response', fakeResponse('https://cdn.jsdelivr.net/npm/x@1/x.js', '10.1.0.2', 3128));
    emit('response', fakeResponse('https://fonts.googleapis.com/css2?family=Inter', '10.1.0.2', 3128));
    expect(guard.privateResponse()).toBeNull();
  });

  it('switches the response check off when this instance itself answers from a private address', async () => {
    const { asPage, emit } = fakePage();
    const guard = await guardCapturePage(asPage, ['localhost']);
    emit('response', fakeResponse('http://localhost:55162/a/demo/?_capture=x', '127.0.0.1', 55162));
    emit('response', fakeResponse('https://cdn.example.org/lib.js', '10.0.0.9', 443));
    expect(guard.privateResponse()).toBeNull();
  });

  it('leaves requests another handler already resolved alone', async () => {
    const { asPage, emit } = fakePage();
    await guardCapturePage(asPage, OWN);
    const handled = { ...fakeRequest('http://10.0.0.1/'), isInterceptResolutionHandled: () => true };
    emit('request', handled);
    expect(handled.abort).not.toHaveBeenCalled();
    expect(handled.continue).not.toHaveBeenCalled();
  });
});

describe('captureRequestHeaders', () => {
  const session = { token: 'sess.sig', artifactId: 'art_1', origin: 'https://shareout.example' };

  it("puts the session on this artifact's data requests only", () => {
    expect(captureRequestHeaders('https://shareout.example/v1/data/art_1/tables/leads/query', { 'content-type': 'application/json' }, session))
      .toEqual({ 'content-type': 'application/json', authorization: 'Bearer sess.sig' });
    expect(captureRequestHeaders('https://shareout.example/v1/data/art_2/json', {}, session)).toBeNull();
    expect(captureRequestHeaders('https://shareout.example/a/demo/app.js', {}, session)).toBeNull();
    expect(captureRequestHeaders('https://elsewhere.example.net/v1/data/art_1/json', {}, session)).toBeNull();
    expect(captureRequestHeaders('https://shareout.example/v1/data/art_1/json', {}, undefined)).toBeNull();
  });

  it('replaces whatever Authorization the page set on a data request', () => {
    expect(captureRequestHeaders('https://shareout.example/v1/data/art_1/json', { Authorization: 'Bearer undefined' }, session))
      .toEqual({ authorization: 'Bearer sess.sig' });
  });

  it('strips the session from any other request still carrying it, and leaves page headers alone', () => {
    expect(captureRequestHeaders('https://files.example.net/blob', { authorization: 'Bearer sess.sig', accept: '*/*' }, session))
      .toEqual({ accept: '*/*' });
    expect(captureRequestHeaders('https://api.example.org/v2', { Authorization: 'Bearer page-key' }, session)).toBeNull();
  });
});

describe('guardCapturePage with a data session', () => {
  it("continues this artifact's data requests with the session and nothing else", async () => {
    const { asPage, emit } = fakePage();
    await guardCapturePage(asPage, ['shareout.example'], {
      dataSession: { token: 'sess.sig', artifactId: 'art_1', origin: 'https://shareout.example' },
    });
    const data = fakeRequest('https://shareout.example/v1/data/art_1/workspace/tables/leads/query');
    const asset = fakeRequest('https://cdn.jsdelivr.net/npm/x@1/x.js');
    emit('request', data);
    emit('request', asset);
    expect(data.continue).toHaveBeenCalledWith({ headers: { authorization: 'Bearer sess.sig' } });
    expect(asset.continue).toHaveBeenCalledWith();
  });
});
