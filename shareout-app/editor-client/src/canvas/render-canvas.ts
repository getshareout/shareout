import { stampEditorIdsOnBlocks } from '../dom/editor-ids';
import { createLogger } from '../editor/logger';
import type { EditorDom, EditorState } from '../editor/types';
import { injectCanvasEditorStyles } from './editor-styles';

const log = createLogger('canvas');

const SDK_SCRIPT = '<script src="/sdk/shareout.js"><\/script>';
const EMPTY_HTML = '<html><head></head><body></body></html>';
const READY_TIMEOUT_MS = 3000;

let readyCleanup: (() => void) | null = null;

interface PreviewInitData {
  artifactId: string;
  baseUrl: string;
  json: Record<string, unknown>;
  tables: Record<string, { rows: unknown[]; total: number; hasMore: boolean }>;
  connections: Record<string, unknown[]>;
  editorMode: true;
}

function editorPreviewArtifactId(): string {
  if (typeof window === 'undefined') return 'editor-preview';
  const parts = window.location.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('a');
  if (i >= 0 && parts[i + 1]) return parts[i + 1];
  return parts[0] && parts[0] !== 'editor' ? parts[0] : 'editor-preview';
}

/**
 * Build the SDK init payload for the preview iframe from the artifact's manifest
 * defaults, in editor mode. This lets the previewed artifact's SDK resolve every
 * data read from seed/empty with NO network call, so artifacts that gate their UI
 * behind `await sdk.table(...).exec()` / `sdk.connection(...).query()` render (and
 * become editable) instead of hanging on a loading spinner. Sources with no `default`
 * preview empty.
 */
function buildPreviewInitData(state: EditorState): PreviewInitData {
  const json: Record<string, unknown> = {};
  const tables: Record<string, { rows: unknown[]; total: number; hasMore: boolean }> = {};
  const connections: Record<string, unknown[]> = {};
  const sources = state.manifest?.manifest.sources;
  if (sources?.json) {
    for (const [key, src] of Object.entries(sources.json)) {
      if (src?.default !== undefined) json[key] = src.default;
    }
  }
  if (sources?.tables) {
    for (const [name, src] of Object.entries(sources.tables)) {
      const rows = Array.isArray(src?.default) ? src.default : [];
      tables[name] = { rows, total: rows.length, hasMore: false };
    }
  }
  if (sources?.connections) {
    for (const [name, src] of Object.entries(sources.connections)) {
      connections[name] = Array.isArray(src?.default) ? src.default : [];
    }
  }
  return { artifactId: editorPreviewArtifactId(), baseUrl: window.location.origin, json, tables, connections, editorMode: true };
}

function injectPreviewInitData(html: string, state: EditorState): string {
  if (/id=["']shareout-initial-data["']/.test(html)) return html;
  const json = JSON.stringify(buildPreviewInitData(state)).replace(/</g, '\\u003c');
  const tag = `<script id="shareout-initial-data" type="application/json">${json}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => tag + m);
  return tag + html;
}

export function injectSdkScript(html: string): string {
  if (html.includes('/sdk/shareout.js')) return html;
  if (html.includes('</head>')) {
    return html.replace('</head>', SDK_SCRIPT + '</head>');
  }
  if (html.includes('<body')) {
    return html.replace('<body', SDK_SCRIPT + '<body');
  }
  return html;
}

function normalizeHtmlDocument(rawHtml: string): { headHtml: string; bodyHtml: string; fullHtml: string } {
  const html = rawHtml || EMPTY_HTML;
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const hasBodyTag = /<body[\s>]/i.test(html);
  const hasHeadClose = /<\/head>/i.test(html);

  // If it doesn't look like a full HTML document, wrap it.
  if (!hasHtmlTag || !hasBodyTag) {
    const wrapped = `<!doctype html><html><head>${SDK_SCRIPT}</head><body>${html}</body></html>`;
    return { headHtml: SDK_SCRIPT, bodyHtml: html, fullHtml: wrapped };
  }

  // Otherwise keep full HTML, but still provide best-effort head/body extraction for fallback.
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const headHtml = headMatch?.[1] ?? (hasHeadClose ? '' : SDK_SCRIPT);
  const bodyHtml = bodyMatch?.[1] ?? '';
  return { headHtml, bodyHtml, fullHtml: injectSdkScript(html) };
}

function writeDocSafely(doc: Document, rawHtml: string): void {
  const normalized = normalizeHtmlDocument(rawHtml);

  // Try fast path: write full HTML.
  doc.open();
  doc.write(normalized.fullHtml);
  doc.close();

  if (doc.body) return;

  // Fallback: force-create a valid skeleton, then inject head/body.
  doc.open();
  doc.write('<!doctype html><html><head></head><body></body></html>');
  doc.close();

  // Re-acquire after the write: TS can't see that doc.write() recreated head/body,
  // so it still treats the earlier `if (doc.body) return` narrowing as in effect.
  // Fresh queries: doc.body was narrowed to null by the earlier `if (doc.body) return`,
  // and CFA can't see that doc.write() recreated it.
  const head = doc.querySelector('head');
  const body = doc.querySelector('body');
  if (!head || !body) return;

  // Ensure SDK script is present in head in fallback mode.
  if (!doc.documentElement.innerHTML.includes('/sdk/shareout.js')) {
    head.insertAdjacentHTML('beforeend', SDK_SCRIPT);
  }
  if (normalized.headHtml) {
    head.insertAdjacentHTML('beforeend', normalized.headHtml);
  }
  if (normalized.bodyHtml) {
    body.insertAdjacentHTML('beforeend', normalized.bodyHtml);
  }
}

export interface RenderCanvasOptions {
  skipLoadingState?: boolean;
}

export function renderCanvas(state: EditorState, dom: EditorDom, options?: RenderCanvasOptions): Document | null {
  log.debug('renderCanvas: starting', {
    hasCanvasFrame: !!dom.canvasFrame,
    canvasFrameTagName: dom.canvasFrame?.tagName,
  });

  if (!dom.canvasFrame) {
    log.error('renderCanvas: #canvas-frame not found');
    return null;
  }

  const doc = dom.canvasFrame.contentDocument;
  log.debug('renderCanvas: contentDocument', {
    hasDoc: !!doc,
    docReadyState: doc?.readyState,
  });

  if (!doc) {
    log.error('renderCanvas: iframe contentDocument unavailable');
    return null;
  }

  const rawHtml = state.html || EMPTY_HTML;
  // Seed the preview SDK (manifest defaults + editor mode) so data-gated artifacts
  // resolve their reads offline instead of hanging on a loading spinner. Injected only
  // into the iframe copy — never into state.html, so it's never saved to the artifact.
  const previewHtml = injectPreviewInitData(rawHtml, state);
  const html = injectSdkScript(previewHtml);
  log.info('renderCanvas', { bytes: html.length });

  writeDocSafely(doc, previewHtml);

  // DEBUG: Log document structure after write
  log.debug('renderCanvas: after doc.write', {
    hasBody: !!doc.body,
    bodyTagName: doc.body?.tagName,
    bodyChildCount: doc.body?.childElementCount,
    firstChildTag: doc.body?.firstElementChild?.tagName,
    firstChildId: doc.body?.firstElementChild?.id,
    docReadyState: doc.readyState,
    htmlSubstring: html.substring(0, 200),
  });

  injectCanvasEditorStyles(doc);
  stampEditorIdsOnBlocks(doc);
  syncCanvasFrameSize(dom);

  // DEBUG: Verify body is interactive
  log.debug('renderCanvas: final state', {
    bodyPointerEvents: doc.body ? window.getComputedStyle(doc.body).pointerEvents : 'N/A',
    bodyDisplay: doc.body ? window.getComputedStyle(doc.body).display : 'N/A',
    bodyVisibility: doc.body ? window.getComputedStyle(doc.body).visibility : 'N/A',
  });

  // Setup ready signal handling (skip for undo/redo to avoid jarring loading state)
  if (!options?.skipLoadingState) {
    setupReadySignal(dom);
  }

  return doc;
}

function showCanvasLoading(dom: EditorDom): void {
  const loading = document.getElementById('canvas-loading');
  const frame = dom.canvasFrame;
  if (loading) loading.classList.remove('hidden');
  if (frame) frame.style.opacity = '0';
}

function hideCanvasLoading(dom: EditorDom): void {
  const loading = document.getElementById('canvas-loading');
  const frame = dom.canvasFrame;
  if (loading) loading.classList.add('hidden');
  if (frame) frame.style.opacity = '1';
}

function setupReadySignal(dom: EditorDom): void {
  // Cleanup previous listener if any
  if (readyCleanup) {
    readyCleanup();
    readyCleanup = null;
  }

  showCanvasLoading(dom);

  const onReady = (e: MessageEvent) => {
    if (e.data?.type === 'shareout:content-ready') {
      log.info('Canvas content ready signal received');
      hideCanvasLoading(dom);
      cleanup();
    }
  };

  // Timeout fallback - hide loading after READY_TIMEOUT_MS even if no signal
  const timeout = setTimeout(() => {
    log.warn('Canvas ready timeout - hiding loading state');
    hideCanvasLoading(dom);
    cleanup();
  }, READY_TIMEOUT_MS);

  const cleanup = () => {
    window.removeEventListener('message', onReady);
    clearTimeout(timeout);
    readyCleanup = null;
  };

  window.addEventListener('message', onReady);
  readyCleanup = cleanup;
}

/** Ensure iframe fills available space - scrolling happens inside the iframe. */
export function syncCanvasFrameSize(dom: EditorDom): void {
  // No-op: Canvas and iframe now use CSS height: 100% to fill available space.
  // Content scrolls inside the iframe, not the outer container.
  log.debug('syncCanvasFrameSize: using CSS-based sizing');
}
