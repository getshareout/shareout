import { EDITOR_ID_ATTR, ensureEditorId } from './editor-ids';

export { ensureEditorId, resolveElementBySelector } from './editor-ids';

/** Build a stable CSS selector for an element inside the canvas document. */
export function getElementSelector(element: Element): string {
  const editorId = element.getAttribute(EDITOR_ID_ATTR) || ensureEditorId(element);
  return `[${EDITOR_ID_ATTR}="${editorId}"]`;
}
