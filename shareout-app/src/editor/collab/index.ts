// ShareOut Visual Editor - Real-Time Collaboration Module

import type { EditorContext } from '../index';

export async function handleEditorWebSocket(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, userName, userAvatar, env } = ctx;

  // Get the Durable Object for this artifact's editor
  const id = env.REALTIME.idFromName(`editor:${artifactId}`);
  const stub = env.REALTIME.get(id);

  // Forward the WebSocket upgrade request to the Durable Object
  const url = new URL(request.url);
  url.pathname = `/${artifactId}/editor`;

  // Add user info as headers
  const headers = new Headers(request.headers);
  headers.set('X-User-Id', userId);
  headers.set('X-User-Name', userName);
  if (userAvatar) {
    headers.set('X-User-Avatar', userAvatar);
  }

  return stub.fetch(new Request(url.toString(), {
    method: request.method,
    headers,
  }));
}

// Legacy inline script generator — client lives in editor-client bundle (/sdk/editor.js).
// Kept for backwards compatibility if referenced elsewhere.
export function getCollabClientScript(): string {
  return `
    class EditorCollab {
      constructor(artifactId, userId, userName, userAvatar) {
        this.artifactId = artifactId;
        this.userId = userId;
        this.userName = userName;
        this.userAvatar = userAvatar;
        this.ws = null;
        this.awareness = new Map();
        this.softLocks = new Map();
        this.userColor = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.handlers = {
          onPresenceUpdate: () => {},
          onCursorUpdate: () => {},
          onSelectionUpdate: () => {},
          onLockUpdate: () => {},
          onHtmlUpdate: () => {},
        };
      }

      connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + location.host + '/v1/artifacts/' + this.artifactId + '/editor/ws';

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.sendAwareness({
            userId: this.userId,
            userName: this.userName,
            userAvatar: this.userAvatar,
            userColor: this.userColor,
            isTyping: false,
          });
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          this.scheduleReconnect();
        };

        this.ws.onerror = () => {};
      }

      scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        setTimeout(() => this.connect(), delay);
      }

      handleMessage(data) {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'awareness':
            if (msg.states) {
              for (const [clientId, state] of Object.entries(msg.states)) {
                if (state.userId !== this.userId) {
                  this.awareness.set(clientId, state);
                }
                if (state.userId === this.userId && state.userColor) {
                  this.userColor = state.userColor;
                }
              }
            } else if (msg.clientId && msg.state) {
              if (msg.state.userId !== this.userId) {
                this.awareness.set(msg.clientId, msg.state);
              }
            }
            this.handlers.onPresenceUpdate(this.getPresences());
            break;

          case 'presence':
            if (msg.event === 'leave' && msg.clientId) {
              this.awareness.delete(msg.clientId);
              this.handlers.onPresenceUpdate(this.getPresences());
            }
            break;

          case 'lock':
            if (msg.lock) {
              this.softLocks.set(msg.selector, {
                selector: msg.selector,
                userId: msg.userId,
                userName: msg.userName,
                lockedAt: Date.now(),
                expiresAt: Date.now() + 2000,
              });
            } else {
              this.softLocks.delete(msg.selector);
            }
            this.handlers.onLockUpdate(this.softLocks);
            break;

          case 'html-update':
            this.handlers.onHtmlUpdate(msg.html, msg.version);
            break;
        }
      }

      getPresences() {
        const presences = [];
        for (const [clientId, state] of this.awareness) {
          presences.push({ ...state, clientId });
        }
        return presences;
      }

      sendAwareness(state) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'awareness',
            state: { ...state, userId: this.userId, userName: this.userName },
          }));
        }
      }

      updateCursor(x, y) {
        this.sendAwareness({
          userId: this.userId,
          userName: this.userName,
          userAvatar: this.userAvatar,
          userColor: this.userColor,
          cursor: { x, y },
          isTyping: false,
        });
      }

      updateSelection(selector) {
        this.sendAwareness({
          userId: this.userId,
          userName: this.userName,
          userAvatar: this.userAvatar,
          userColor: this.userColor,
          selectedElement: selector,
          isTyping: false,
        });
      }

      setTyping(isTyping) {
        this.sendAwareness({
          userId: this.userId,
          userName: this.userName,
          userAvatar: this.userAvatar,
          userColor: this.userColor,
          isTyping,
        });
      }

      acquireLock(selector) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'lock',
            selector,
            lock: true,
            userId: this.userId,
            userName: this.userName,
          }));

          this.softLocks.set(selector, {
            selector,
            userId: this.userId,
            userName: this.userName,
            lockedAt: Date.now(),
            expiresAt: Date.now() + 2000,
          });
        }
      }

      releaseLock(selector) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'lock',
            selector,
            lock: false,
            userId: this.userId,
          }));
        }
        this.softLocks.delete(selector);
      }

      canEdit(selector) {
        const lock = this.softLocks.get(selector);
        if (!lock) return true;
        if (lock.userId === this.userId) return true;
        return Date.now() >= lock.expiresAt;
      }

      broadcastHtmlUpdate(html, version) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'html-update',
            html,
            version,
          }));
        }
      }

      disconnect() {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      }

      on(event, handler) {
        const key = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
        if (this.handlers.hasOwnProperty(key)) {
          this.handlers[key] = handler;
        }
      }
    }

    window.EditorCollab = EditorCollab;
  `;
}
