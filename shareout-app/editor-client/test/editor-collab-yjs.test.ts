import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { EditorCollab } from '../src/sidecars/editor-collab';

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;

// Fake socket: OPEN, forwards each binary frame to `deliver`.
function fakeSocket(deliver: (frame: Uint8Array) => void): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: (m: unknown) => deliver(m as Uint8Array),
  } as unknown as WebSocket;
}

// Wire two clients so each one's outbound frames arrive at the other's handler,
// mirroring what the coordinator does when it fans out UPDATE/SYNC frames.
function link(a: EditorCollab, b: EditorCollab): void {
  a.ws = fakeSocket((frame) => b.handleSocketData(frame.buffer));
  b.ws = fakeSocket((frame) => a.handleSocketData(frame.buffer));
}

describe('EditorCollab Yjs sync', () => {
  it('converges two clients after concurrent (offline) edits', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new EditorCollab('art', 'uA', 'A');
    const b = new EditorCollab('art', 'uB', 'B');
    a.attachDoc(docA);
    b.attachDoc(docB);

    // Edit both before either socket exists — pure concurrent divergence.
    docA.transact(() => docA.getMap('elements').set('a1', 'from-A'), 'uA');
    docB.transact(() => docB.getMap('elements').set('b1', 'from-B'), 'uB');

    link(a, b);

    // onopen handshake: each side advertises its state vector, gets the other's diff.
    a.sendBinary(SYNC_STEP1, Y.encodeStateVector(docA));
    b.sendBinary(SYNC_STEP1, Y.encodeStateVector(docB));

    expect(docA.getMap('elements').get('a1')).toBe('from-A');
    expect(docA.getMap('elements').get('b1')).toBe('from-B');
    expect(docB.getMap('elements').get('a1')).toBe('from-A');
    expect(docB.getMap('elements').get('b1')).toBe('from-B');
    expect(Y.encodeStateVector(docA)).toEqual(Y.encodeStateVector(docB));
  });

  it('streams a live edit to the connected peer as a binary UPDATE (no echo loop)', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new EditorCollab('art', 'uA', 'A');
    const b = new EditorCollab('art', 'uB', 'B');
    a.attachDoc(docA);
    b.attachDoc(docB);
    link(a, b);

    docA.transact(() => docA.getMap('elements').set('live', 42), 'uA');

    expect(docB.getMap('elements').get('live')).toBe(42);
  });

  it('lets a late joiner pull current state via the handshake', () => {
    // Stand-in for the coordinator's authoritative doc.
    const server = new Y.Doc();
    server.getMap('elements').set('seed', 'server-value');

    const docL = new Y.Doc();
    const late = new EditorCollab('art', 'uL', 'L');
    late.attachDoc(docL);

    // Server replies to the joiner's SYNC_STEP1 with the diff it's missing.
    late.ws = fakeSocket((frame) => {
      if (frame[0] !== SYNC_STEP1) return;
      const diff = Y.encodeStateAsUpdate(server, frame.subarray(1));
      const step2 = new Uint8Array(diff.length + 1);
      step2[0] = SYNC_STEP2;
      step2.set(diff, 1);
      late.handleSocketData(step2.buffer);
    });

    late.sendBinary(SYNC_STEP1, Y.encodeStateVector(docL));

    expect(docL.getMap('elements').get('seed')).toBe('server-value');
  });

  it('replies to an inbound SYNC_STEP1 with its own state as SYNC_STEP2', () => {
    const doc = new Y.Doc();
    doc.getMap('elements').set('mine', 1);
    const client = new EditorCollab('art', 'uC', 'C');
    client.attachDoc(doc);

    const sent: Uint8Array[] = [];
    client.ws = fakeSocket((frame) => sent.push(frame));

    // Server's initial sync advertises an empty state vector.
    const sv = Y.encodeStateVector(new Y.Doc());
    const step1 = new Uint8Array(sv.length + 1);
    step1[0] = SYNC_STEP1;
    step1.set(sv, 1);
    client.handleSocketData(step1.buffer);

    const step2 = sent.find((f) => f[0] === SYNC_STEP2);
    expect(step2).toBeDefined();
    const verify = new Y.Doc();
    Y.applyUpdate(verify, step2!.subarray(1));
    expect(verify.getMap('elements').get('mine')).toBe(1);
  });
});
