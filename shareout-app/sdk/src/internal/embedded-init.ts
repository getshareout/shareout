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
// Origin of the page that delivered init: the only host the frame answers (source-highlight).
let initOrigin: string | null = null;

export function getPostMessageData(): EmbeddedInitialData | null {
  return postMessageData;
}

export function getInitOrigin(): string | null {
  return initOrigin;
}

function acceptInit(e: MessageEvent): void {
  postMessageData = e.data.data as EmbeddedInitialData;
  if (typeof e.origin === 'string' && e.origin) initOrigin = e.origin;
}

export function setPostMessageData(data: EmbeddedInitialData): void {
  postMessageData = data;
}

// CDN cutover streams the iframe before the parent's prefetch finishes, so the
// sandboxed artifact may need several seconds for shareout:init (ADR 30).
export const POST_MESSAGE_INIT_TIMEOUT_MS = 10_000;

// Only the framing page may seed init data: a nested frame or a popup the artifact
// opened can also post into this window, and the payload carries the data token.
function isParentInit(e: MessageEvent): boolean {
  return e.source === window.parent && e.data?.type === 'shareout:init' && !!e.data.data;
}

export async function waitForPostMessageInit(timeoutMs: number = POST_MESSAGE_INIT_TIMEOUT_MS): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return;
  if (postMessageData) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    const handler = (e: MessageEvent) => {
      if (isParentInit(e)) {
        acceptInit(e);
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
    if (isParentInit(e)) acceptInit(e);
  });
  // Signal parent we're ready
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'shareout:ready' }, '*');
  }
}

