import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import type { EditorState } from '../editor/types';

const log = createLogger('html-sync');

export function updateHtmlFromCanvas(
  state: EditorState,
  canvasFrame: HTMLIFrameElement
): void {
  const doc = canvasFrame.contentDocument;
  if (!doc?.documentElement) {
    log.warn('updateHtmlFromCanvas: document unavailable');
    return;
  }

  doc.querySelectorAll('[data-editor-hover], [data-editor-selected]').forEach((el) => {
    el.removeAttribute('data-editor-hover');
    el.removeAttribute('data-editor-selected');
  });

  state.html = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  log.debug('html synced from canvas', { bytes: state.html.length });
}

/** Sync iframe DOM → state.html. Collab changes ride the Yjs element sync, not
 *  a full-HTML broadcast, so this only refreshes local state for save/publish. */
export function syncHtmlFromCanvas(ctx: EditorContext): void {
  updateHtmlFromCanvas(ctx.state, ctx.dom.canvasFrame);
}
