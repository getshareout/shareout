import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { SdkClient } from '../src/core/sdk-client';
import { RealtimeDoc, yjsModuleUrl } from '../src/stores/realtime-doc';
import { YJS_PATH } from '../src/stores/yjs-path.generated';

describe('yjsModuleUrl', () => {
  it('resolves beside the SDK script, at its origin root', () => {
    expect(
      yjsModuleUrl('https://app.example', 'https://abc123.cdn.example/sdk/v1/shareout.js')
    ).toBe(`https://abc123.cdn.example${YJS_PATH}`);
  });

  it('falls back to the API origin without an http(s) script URL', () => {
    for (const src of ['', 'blob:https://abc123.cdn.example/5f0c'])
      expect(yjsModuleUrl('https://app.example', src)).toBe(`https://app.example${YJS_PATH}`);
  });

  it('pins the staged module by content hash', () => {
    expect(YJS_PATH).toMatch(/^\/_bundles\/yjs\.js\?v=[0-9a-f]{12}$/);
  });
});

describe('RealtimeDoc.connect', () => {
  // No SDK <script> in this environment, so yjs comes from the API origin.
  const yjsUrl = `https://app.example${YJS_PATH}`;
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    binaryType = '';
    onopen: (() => void) | null = null;
    constructor(readonly url: string) {
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send() {}
    close() {}
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock(yjsUrl);
    sockets.length = 0;
  });

  it('imports yjs by URL on first connect, then syncs over the data API socket', async () => {
    vi.doMock(yjsUrl, () => Y);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const doc = new RealtimeDoc(
      { _baseUrl: 'https://app.example', _artifactId: 'art_1' } as SdkClient,
      'notes'
    );

    await doc.connect();
    doc.text('body').insert(0, 'hi');

    expect(doc.toJSON()).toEqual({ body: 'hi' });
    expect(sockets.map((s) => s.url)).toEqual(['wss://app.example/v1/data/art_1/realtime/notes']);
    doc.destroy();
  });
});
