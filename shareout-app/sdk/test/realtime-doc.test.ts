import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { SdkClient } from '../src/core/sdk-client';
import { RealtimeDoc, yjsModuleUrl } from '../src/stores/realtime-doc';
import { YJS_PATH } from '../src/stores/yjs-path.generated';

// No SDK <script> in this environment, so yjs comes from the API origin.
const sdk = { _baseUrl: 'https://app.example', _artifactId: 'art_1' } as SdkClient;
const yjsUrl = `https://app.example${YJS_PATH}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock(yjsUrl);
});

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
    sockets.length = 0;
  });

  it('imports yjs by URL on first connect, then syncs over the data API socket', async () => {
    vi.doMock(yjsUrl, () => Y);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const doc = new RealtimeDoc(sdk, 'notes');

    await doc.connect();
    doc.text('body').insert(0, 'hi');

    expect(doc.toJSON()).toEqual({ body: 'hi' });
    expect(sockets.map((s) => s.url)).toEqual(['wss://app.example/v1/data/art_1/realtime/notes']);
    doc.destroy();
  });
});

// Speaks the handshake of src/realtime/coordinator.ts: step 1 on connect; a client's step 1
// gets step 2 and the server's own step 1 back; non-empty step 2s and updates are applied
// and fanned out to the other sockets.
function fakeCoordinator() {
  const [STEP1, STEP2, UPDATE] = [0, 1, 2];
  const server = new Y.Doc();
  const sockets: CoordinatorSocket[] = [];
  const frame = (type: number, body: Uint8Array) => new Uint8Array([type, ...body]);
  let inFlight = 0;
  const later = (fn: () => void) => {
    inFlight++;
    setTimeout(() => {
      inFlight--;
      fn();
    });
  };

  class CoordinatorSocket {
    static OPEN = 1;
    readyState = 1;
    binaryType = '';
    step1Received = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
    constructor(readonly url: string) {
      sockets.push(this);
      later(() => {
        this.onopen?.();
        this.deliver(frame(STEP1, Y.encodeStateVector(server)));
      });
    }
    deliver(msg: Uint8Array) {
      later(() => this.readyState === 1 && this.onmessage?.({ data: msg.slice().buffer }));
    }
    send(data: Uint8Array | string) {
      if (typeof data === 'string') return;
      const [type, body] = [data[0], data.slice(1)];
      if (type === STEP1) {
        this.step1Received++;
        this.deliver(frame(STEP2, Y.encodeStateAsUpdate(server, body)));
        this.deliver(frame(STEP1, Y.encodeStateVector(server)));
      } else if (
        type === UPDATE ||
        (type === STEP2 && !(body.length === 2 && body[0] === 0 && body[1] === 0))
      ) {
        Y.applyUpdate(server, body);
        for (const s of sockets) if (s !== this) s.deliver(frame(UPDATE, body));
      }
    }
    close() {
      this.readyState = 3;
    }
  }
  // Nothing left to deliver: the handshake and fan-out are done (a ping-pong never gets here).
  const settled = () => vi.waitFor(() => expect(inFlight).toBe(0));
  return { CoordinatorSocket, sockets, server, settled };
}

describe('RealtimeDoc sync', () => {
  it('a doc that joins after edits receives them, and both converge', async () => {
    const { CoordinatorSocket, sockets, server, settled } = fakeCoordinator();
    vi.doMock(yjsUrl, () => Y);
    vi.stubGlobal('WebSocket', CoordinatorSocket);
    const early = new RealtimeDoc(sdk, 'notes');
    const late = new RealtimeDoc(sdk, 'notes');
    try {
      await early.connect();
      early.text('body').insert(0, 'before');
      await settled();
      expect(server.getText('body').toString()).toBe('before');

      await late.connect();
      await settled();
      expect(late.text('body').toString()).toBe('before');

      late.text('body').insert(6, ' + after');
      await settled();
      expect(early.text('body').toString()).toBe('before + after');
      expect(late.text('body').toString()).toBe('before + after');
      // One step 1 per connection: the server answers each one with its own step 1.
      expect(sockets.map((s) => s.step1Received)).toEqual([1, 1]);
    } finally {
      early.destroy();
      late.destroy();
    }
  });
});
