/** Real-time collaboration client (WebSocket awareness + soft locks + Yjs doc sync). */

import * as Y from 'yjs';

type CollabHandler = (...args: unknown[]) => void;

// Yjs sync protocol frame types — must match src/realtime/coordinator.ts.
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const UPDATE = 2;

// Origin tag for updates applied from the socket, so doc.on('update') doesn't echo
// them back and the element/text managers still see them as remote (not === userId).
const REMOTE_ORIGIN = Symbol('remote-yjs');

interface SoftLock {
  selector: string;
  userId: string;
  userName: string;
  lockedAt: number;
  expiresAt: number;
}

export class EditorCollab {
  artifactId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  ws: WebSocket | null = null;
  doc: Y.Doc | null = null;
  awareness = new Map<string, Record<string, unknown>>();
  softLocks = new Map<string, SoftLock>();
  userColor: string | null = null;
  reconnectAttempts = 0;
  maxReconnectAttempts = 5;
  reconnectDelay = 1000;
  handlers: Record<string, CollabHandler> = {
    onPresenceUpdate: () => {},
    onCursorUpdate: () => {},
    onSelectionUpdate: () => {},
    onLockUpdate: () => {},
  };

  constructor(artifactId: string, userId: string, userName: string, userAvatar?: string) {
    this.artifactId = artifactId;
    this.userId = userId;
    this.userName = userName;
    this.userAvatar = userAvatar;
  }

  /** Bind the shared Y.Doc so its updates ride the socket as binary Yjs frames. */
  attachDoc(doc: Y.Doc): void {
    if (this.doc) return;
    this.doc = doc;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      this.sendBinary(UPDATE, update);
    });
  }

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/v1/artifacts/${this.artifactId}/editor/ws`;
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.sendAwareness({
        userId: this.userId,
        userName: this.userName,
        userAvatar: this.userAvatar,
        userColor: this.userColor,
        isTyping: false,
      });
      // Pull the server's current doc state (late join + reconnect resync).
      if (this.doc) this.sendBinary(SYNC_STEP1, Y.encodeStateVector(this.doc));
    };

    this.ws.onmessage = (event) => this.handleSocketData(event.data);
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => {};
  }

  handleSocketData(data: string | ArrayBuffer): void {
    if (typeof data === 'string') this.handleMessage(data);
    else this.handleBinary(data);
  }

  handleBinary(buffer: ArrayBuffer): void {
    const msg = new Uint8Array(buffer);
    if (msg.length === 0 || !this.doc) return;
    const payload = msg.subarray(1);

    switch (msg[0]) {
      case SYNC_STEP1:
        // Peer's state vector — reply with everything it's missing.
        this.sendBinary(SYNC_STEP2, Y.encodeStateAsUpdate(this.doc, payload));
        break;
      case SYNC_STEP2:
      case UPDATE:
        Y.applyUpdate(this.doc, payload, REMOTE_ORIGIN);
        break;
    }
  }

  sendBinary(type: number, payload: Uint8Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const frame = new Uint8Array(payload.length + 1);
    frame[0] = type;
    frame.set(payload, 1);
    this.ws.send(frame);
  }

  scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    setTimeout(() => this.connect(), delay);
  }

  handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'awareness': {
        const states = msg.states as Record<string, Record<string, unknown>> | undefined;
        if (states) {
          for (const [clientId, state] of Object.entries(states)) {
            if (state.userId !== this.userId) this.awareness.set(clientId, state);
            if (state.userId === this.userId && state.userColor) {
              this.userColor = state.userColor as string;
            }
          }
        } else if (msg.clientId && msg.state) {
          const state = msg.state as Record<string, unknown>;
          if (state.userId !== this.userId) {
            this.awareness.set(msg.clientId as string, state);
          }
        }
        this.handlers.onPresenceUpdate(this.getPresences());
        break;
      }
      case 'presence':
        if (msg.event === 'leave' && msg.clientId) {
          this.awareness.delete(msg.clientId as string);
          this.handlers.onPresenceUpdate(this.getPresences());
        }
        break;
      case 'lock': {
        const selector = msg.selector as string;
        if (msg.lock) {
          this.softLocks.set(selector, {
            selector,
            userId: msg.userId as string,
            userName: msg.userName as string,
            lockedAt: Date.now(),
            expiresAt: Date.now() + 2000,
          });
        } else {
          this.softLocks.delete(selector);
        }
        this.handlers.onLockUpdate(this.softLocks);
        break;
      }
    }
  }

  getPresences(): Record<string, unknown>[] {
    const presences: Record<string, unknown>[] = [];
    for (const [clientId, state] of this.awareness) {
      presences.push({ ...state, clientId });
    }
    return presences;
  }

  sendAwareness(state: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'awareness',
          state: { ...state, userId: this.userId, userName: this.userName },
        })
      );
    }
  }

  updateCursor(x: number, y: number): void {
    this.sendAwareness({
      userId: this.userId,
      userName: this.userName,
      userAvatar: this.userAvatar,
      userColor: this.userColor,
      cursor: { x, y },
      isTyping: false,
    });
  }

  updateSelection(selector: string): void {
    this.sendAwareness({
      userId: this.userId,
      userName: this.userName,
      userAvatar: this.userAvatar,
      userColor: this.userColor,
      selectedElement: selector,
      isTyping: false,
    });
  }

  setTyping(isTyping: boolean): void {
    this.sendAwareness({
      userId: this.userId,
      userName: this.userName,
      userAvatar: this.userAvatar,
      userColor: this.userColor,
      isTyping,
    });
  }

  acquireLock(selector: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'lock',
          selector,
          lock: true,
          userId: this.userId,
          userName: this.userName,
        })
      );
      this.softLocks.set(selector, {
        selector,
        userId: this.userId,
        userName: this.userName,
        lockedAt: Date.now(),
        expiresAt: Date.now() + 2000,
      });
    }
  }

  releaseLock(selector: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'lock',
          selector,
          lock: false,
          userId: this.userId,
        })
      );
    }
    this.softLocks.delete(selector);
  }

  canEdit(_selector: string): boolean {
    const lock = this.softLocks.get(_selector);
    if (!lock) return true;
    if (lock.userId === this.userId) return true;
    return Date.now() >= lock.expiresAt;
  }

  updateTextCursor(elementId: string, offset: number): void {
    this.sendAwareness({
      userId: this.userId,
      userName: this.userName,
      userAvatar: this.userAvatar,
      userColor: this.userColor,
      textCursor: { elementId, offset },
      isTyping: true,
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on(event: string, handler: CollabHandler): void {
    const key = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
    if (Object.prototype.hasOwnProperty.call(this.handlers, key)) {
      this.handlers[key] = handler;
    }
  }
}
