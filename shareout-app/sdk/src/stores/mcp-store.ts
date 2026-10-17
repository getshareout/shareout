import type { SdkClient } from '../core/sdk-client';
import { ShareOutError } from '../shareout-error';

/**
 * Call the viewer's own workspace MCP connections declared by this page.
 * The broker token comes from the ShareOut page around the frame (which holds the
 * viewer's session); it lives five minutes and is refreshed transparently.
 */

export interface McpToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
}

export interface McpConnectionState {
  name: string;
  available: boolean;
  connected?: boolean;
  allowed?: boolean;
  tools: McpToolInfo[];
}

export interface McpToolResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  /** structuredContent, else the first text block parsed as JSON, else that text. */
  payload?: unknown;
}

export class McpError extends ShareOutError {
  constructor(
    message: string,
    code: string,
    status: number,
    public connection?: string,
    public retryable = false,
  ) {
    super(message, code, status);
    this.name = 'McpError';
  }
}

const TOKEN_TIMEOUT_MS = 10_000;
const TOKEN_SKEW_MS = 30_000;
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;
let nextRequestId = 1;

function requestToken(): Promise<string> {
  if (typeof window === 'undefined' || window.parent === window) {
    return Promise.reject(new McpError('MCP connections only work inside a ShareOut page', 'mcp_not_available', 0));
  }
  const requestId = `mcp-${nextRequestId++}`;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new McpError('The ShareOut page did not answer', 'mcp_not_available', 0));
    }, TOKEN_TIMEOUT_MS);
    function onMessage(e: MessageEvent) {
      const d = e.data as { type?: string; requestId?: string; token?: string | null; expiresAt?: number; code?: string; error?: string } | null;
      if (e.source !== window.parent || d?.type !== 'shareout:mcp-token' || d.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (!d.token) {
        reject(new McpError(d.error || 'MCP is not available here', (d.code || 'mcp_not_available').toLowerCase(), 403));
        return;
      }
      cached = { token: d.token, expiresAt: d.expiresAt ?? Date.now() + 60_000 };
      resolve(d.token);
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'shareout:mcp-token-request', requestId }, '*');
  });
}

function getToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > TOKEN_SKEW_MS) return Promise.resolve(cached.token);
  inflight ??= requestToken().finally(() => { inflight = null; });
  return inflight;
}

/** Test hook. */
export function _resetMcpTokenCache(): void {
  cached = null;
  inflight = null;
}

function withPayload(result: McpToolResult): McpToolResult {
  if (result.structuredContent !== undefined) return { ...result, payload: result.structuredContent };
  const first = result.content?.find((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text');
  if (!first) return result;
  try {
    return { ...result, payload: JSON.parse(first.text) };
  } catch {
    return { ...result, payload: first.text };
  }
}

export interface McpAccessResult {
  allowed: boolean;
  connected: boolean;
  /** Why not: 'declined' (final for this page load), 'busy', 'not_in_manifest', … */
  code?: string | null;
}

export type McpWatchEvent =
  | { type: 'data'; result: McpToolResult; fetchedAt: number }
  | { type: 'error'; error: McpError };

const ACCESS_TIMEOUT_MS = 10 * 60_000;
const WATCH_FLOOR_MS = 30_000;
// Errors only the viewer can fix: polling stops until the page asks again.
const STOP_POLLING = new Set(['approval_required', 'credentials_required', 'needs_reauth', 'not_allowed', 'not_in_manifest', 'not_read_only', 'mcp_not_available']);

export class McpStore {
  constructor(private sdk: SdkClient) {}

  /** The page's declared connections and, for this viewer, whether each is connected and allowed. */
  async listConnections(): Promise<McpConnectionState[]> {
    const data = await this.request<{ connections: McpConnectionState[] }>('/list', { method: 'GET' });
    return data.connections;
  }

  /** Call one declared, read-only tool as the viewer. Rejects with McpError (branch on `code`). */
  async callTool(connection: string, tool: string, input: Record<string, unknown> = {}): Promise<McpToolResult> {
    const result = await this.request<McpToolResult>('/call', {
      method: 'POST',
      body: JSON.stringify({ connection, tool, input }),
    });
    return withPayload(result);
  }

  /**
   * Ask the viewer to allow this page to use a connection (and connect their account
   * if needed). The ShareOut page shows its own dialog; call this from a button the
   * viewer clicked, after a call failed with approval_required or credentials_required.
   */
  requestAccess(connection: string): Promise<McpAccessResult> {
    if (typeof window === 'undefined' || window.parent === window) {
      return Promise.resolve({ allowed: false, connected: false, code: 'mcp_not_available' });
    }
    const requestId = `mcp-access-${nextRequestId++}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ allowed: false, connected: false, code: 'timeout' });
      }, ACCESS_TIMEOUT_MS);
      function onMessage(e: MessageEvent) {
        const d = e.data as ({ type?: string; requestId?: string } & McpAccessResult) | null;
        if (e.source !== window.parent || d?.type !== 'shareout:mcp-access' || d.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({ allowed: !!d.allowed, connected: !!d.connected, code: d.code ?? null });
      }
      window.addEventListener('message', onMessage);
      window.parent.postMessage({ type: 'shareout:mcp-access-request', requestId, connection }, '*');
    });
  }

  /**
   * Keep a read current: calls now, then every `refetchInterval` ms (at least 30 s),
   * paused while the page is hidden. Stops polling on errors only the viewer can fix
   * (call watchTool again after requestAccess). Returns an unsubscribe function.
   */
  watchTool(
    connection: string,
    tool: string,
    input: Record<string, unknown>,
    handler: (event: McpWatchEvent) => void,
    options: { refetchInterval?: number } = {},
  ): () => void {
    const interval = options.refetchInterval ? Math.max(WATCH_FLOOR_MS, options.refetchInterval) : 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const doc = typeof document !== 'undefined' ? document : undefined;
    const onVisible = () => {
      if (doc?.visibilityState === 'visible') {
        doc.removeEventListener('visibilitychange', onVisible);
        void run();
      }
    };
    const schedule = () => {
      if (!interval || stopped) return;
      timer = setTimeout(() => {
        if (doc?.visibilityState === 'hidden') doc.addEventListener('visibilitychange', onVisible);
        else void run();
      }, interval);
    };
    const run = async () => {
      if (stopped) return;
      try {
        const result = await this.callTool(connection, tool, input);
        if (!stopped) handler({ type: 'data', result, fetchedAt: Date.now() });
        schedule();
      } catch (err) {
        if (stopped) return;
        const error = err instanceof McpError ? err : new McpError(String(err), 'upstream_error', 0);
        handler({ type: 'error', error });
        if (!STOP_POLLING.has(error.code)) schedule();
      }
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      doc?.removeEventListener('visibilitychange', onVisible);
    };
  }

  private async request<T>(path: string, init: RequestInit, retried = false): Promise<T> {
    const token = await getToken();
    let res: Response;
    try {
      res = await fetch(`${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/mcp${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch {
      throw new McpError('Network error reaching ShareOut', 'server_unavailable', 0, undefined, true);
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: T; error?: string; code?: string; connection?: string; retryable?: boolean; result?: McpToolResult;
    };
    if (res.ok) return body.data as T;
    if ((body.code === 'token_invalid' || body.code === 'token_stale') && !retried) {
      cached = null;
      return this.request<T>(path, init, true);
    }
    const err = new McpError(body.error || `MCP call failed (${res.status})`, body.code || 'upstream_error', res.status, body.connection, body.retryable === true);
    if (body.result) (err as McpError & { result?: McpToolResult }).result = withPayload(body.result);
    throw err;
  }
}
