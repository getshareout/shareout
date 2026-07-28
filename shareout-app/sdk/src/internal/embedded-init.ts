export interface EmbeddedInitialData {
  artifactId: string;
  baseUrl: string;
  json?: Record<string, unknown>;
  tables?: Record<string, { rows: unknown[]; total: number; hasMore: boolean }>;
  /** Sample rows per live connector, used to preview connection().query() in editor mode. */
  connections?: Record<string, unknown[]>;
  admin?: { isOwner: boolean; role: string; canEdit: boolean };
  viewer?: { email: string; name?: string; picture?: string };
  sessionToken?: string;
  /**
   * Editor/preview mode: resolve all data reads from the seeded json/tables (or empty)
   * with NO network calls, so artifacts that gate their UI behind a data fetch don't
   * hang in the visual editor. Set only by the editor preview — never in production.
   */
  editorMode?: boolean;
}

let postMessageData: EmbeddedInitialData | null = null;

export function getPostMessageData(): EmbeddedInitialData | null {
  return postMessageData;
}

export function setPostMessageData(data: EmbeddedInitialData): void {
  postMessageData = data;
}

// CDN cutover streams the iframe before the parent's prefetch finishes, so the
// sandboxed artifact may need several seconds for shareout:init (ADR 30).
export const POST_MESSAGE_INIT_TIMEOUT_MS = 10_000;

export async function waitForPostMessageInit(timeoutMs: number = POST_MESSAGE_INIT_TIMEOUT_MS): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return;
  if (postMessageData) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'shareout:init' && e.data.data) {
        postMessageData = e.data.data as EmbeddedInitialData;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve();
      }
    };
    window.addEventListener('message', handler);
    // Re-signal ready in case parent missed first one
    window.parent.postMessage({ type: 'shareout:ready' }, '*');
  });
}

// Set up listener early to catch init message from parent frame
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'shareout:init' && e.data.data) {
      postMessageData = e.data.data as EmbeddedInitialData;
    }
  });
  // Signal parent we're ready
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'shareout:ready' }, '*');
  }
}

