import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

type StatusListener = (status: 'connecting' | 'connected' | 'disconnected') => void;
type PresenceListener = (users: Map<string, PresenceState>) => void;
type SyncListener = () => void;

interface PresenceState {
  [key: string]: unknown;
}

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const UPDATE = 2;

export class RealtimeDoc {
  private ws: WebSocket | null = null;
  private doc: any = null;
  private awareness: Map<string, PresenceState> = new Map();
  private localPresence: PresenceState = {};
  private clientId: string;
  private statusListeners: Set<StatusListener> = new Set();
  private presenceListeners: Set<PresenceListener> = new Set();
  private syncListeners: Set<SyncListener> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private Y: any = null;

  constructor(private sdk: SdkClient, private docName: string) {
    this.clientId = this.generateClientId();
  }

  async connect(): Promise<void> {
    if (this.ws) return;

    if (!this.Y) {
      this.Y = await import('yjs');
    }

    if (!this.doc) {
      this.doc = new this.Y.Doc();
      this.doc.on('update', this.handleLocalUpdate.bind(this));
    }

    this.emitStatus('connecting');

    const wsUrl = this.sdk._baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    const url = `${wsUrl}/v1/data/${this.sdk._artifactId}/realtime/${this.docName}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close();
          reject(new ShareOutError('Connection timeout', 'TIMEOUT', 408));
        }
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        this.emitStatus('connected');
        if (Object.keys(this.localPresence).length > 0) {
          this.sendPresence();
        }
        resolve();
      };

      this.ws.onmessage = (event) => this.handleMessage(event);

      this.ws.onclose = () => {
        clearTimeout(timeout);
        this.ws = null;
        this.emitStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
      };
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emitStatus('disconnected');
  }

  destroy(): void {
    this.disconnect();
    if (this.doc) {
      this.doc.destroy();
      this.doc = null;
    }
    this.statusListeners.clear();
    this.presenceListeners.clear();
    this.syncListeners.clear();
  }

  array<T = unknown>(name: string): any {
    this.ensureDoc();
    return this.doc.getArray(name);
  }

  map<T = unknown>(name: string): any {
    this.ensureDoc();
    return this.doc.getMap(name);
  }

  text(name: string): any {
    this.ensureDoc();
    return this.doc.getText(name);
  }

  xml(name: string): any {
    this.ensureDoc();
    return this.doc.getXmlFragment(name);
  }

  transact(fn: () => void, origin?: unknown): void {
    this.ensureDoc();
    this.doc.transact(fn, origin);
  }

  get presence() {
    return {
      set: (state: PresenceState): void => {
        this.localPresence = { ...this.localPresence, ...state };
        this.awareness.set(this.clientId, this.localPresence);
        this.sendPresence();
        this.emitPresence();
      },
      get: (): Map<string, PresenceState> => {
        return new Map(this.awareness);
      },
      subscribe: (handler: PresenceListener): (() => void) => {
        this.presenceListeners.add(handler);
        handler(this.awareness);
        return () => this.presenceListeners.delete(handler);
      }
    };
  }

  on(event: 'update' | 'status' | 'sync', handler: Function): void {
    if (event === 'update') {
      this.ensureDoc();
      this.doc.on('update', handler);
    } else if (event === 'status') {
      this.statusListeners.add(handler as StatusListener);
    } else if (event === 'sync') {
      this.syncListeners.add(handler as SyncListener);
    }
  }

  off(event: 'update' | 'status' | 'sync', handler: Function): void {
    if (event === 'update' && this.doc) {
      this.doc.off('update', handler);
    } else if (event === 'status') {
      this.statusListeners.delete(handler as StatusListener);
    } else if (event === 'sync') {
      this.syncListeners.delete(handler as SyncListener);
    }
  }

  undoManager(scope: any[]): any {
    this.ensureDoc();
    return new this.Y.UndoManager(scope);
  }

  toJSON(): unknown {
    this.ensureDoc();
    return this.doc.toJSON();
  }

  getStateVector(): Uint8Array {
    this.ensureDoc();
    return this.Y.encodeStateVector(this.doc);
  }

  getUpdate(stateVector?: Uint8Array): Uint8Array {
    this.ensureDoc();
    return this.Y.encodeStateAsUpdate(this.doc, stateVector);
  }

  get ydoc(): unknown {
    this.ensureDoc();
    return this.doc;
  }

  private ensureDoc(): void {
    if (!this.doc) {
      throw new ShareOutError(
        'Document not initialized. Call connect() first.',
        'NOT_CONNECTED',
        400
      );
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data === 'string') {
      try {
        const data = JSON.parse(event.data);
        this.handleJsonMessage(data);
      } catch {}
      return;
    }

    const msg = new Uint8Array(event.data);
    if (msg.length === 0) return;

    const messageType = msg[0];
    const payload = msg.slice(1);

    switch (messageType) {
      case SYNC_STEP1:
        this.handleSyncStep1(payload);
        break;
      case SYNC_STEP2:
        this.handleSyncStep2(payload);
        break;
      case UPDATE:
        this.Y.applyUpdate(this.doc, payload, 'remote');
        break;
    }
  }

  private handleJsonMessage(data: { type: string; [key: string]: unknown }): void {
    switch (data.type) {
      case 'awareness':
        if (data.states && typeof data.states === 'object') {
          for (const [clientId, state] of Object.entries(data.states)) {
            if (state === null) {
              this.awareness.delete(clientId);
            } else {
              this.awareness.set(clientId, state as PresenceState);
            }
          }
        } else if (data.clientId && typeof data.clientId === 'string') {
          if (data.state === null) {
            this.awareness.delete(data.clientId);
          } else {
            this.awareness.set(data.clientId, data.state as PresenceState);
          }
        }
        this.emitPresence();
        break;

      case 'presence':
        if (data.event === 'leave' && typeof data.clientId === 'string') {
          this.awareness.delete(data.clientId);
          this.emitPresence();
        }
        break;
    }
  }

  private handleSyncStep1(stateVector: Uint8Array): void {
    const diff = this.Y.encodeStateAsUpdate(this.doc, stateVector);
    const response = new Uint8Array([SYNC_STEP2, ...diff]);
    this.ws?.send(response);

    this.emitSync();
  }

  private handleSyncStep2(update: Uint8Array): void {
    this.Y.applyUpdate(this.doc, update, 'remote');
    this.emitSync();
  }

  private handleLocalUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === 'remote') return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = new Uint8Array([UPDATE, ...update]);
    this.ws.send(msg);
  }

  private sendPresence(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      type: 'awareness',
      clientId: this.clientId,
      state: this.localPresence
    }));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  private emitStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    this.statusListeners.forEach(fn => fn(status));
  }

  private emitPresence(): void {
    this.presenceListeners.forEach(fn => fn(this.awareness));
  }

  private emitSync(): void {
    this.syncListeners.forEach(fn => fn());
  }

  private generateClientId(): string {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
