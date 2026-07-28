import * as Y from 'yjs';
import { EDITOR_ID_ATTR, ensureEditorId, resolveElementBySelector } from '../dom/editor-ids';

export interface TextCrdtConfig {
  userId: string;
  doc: Y.Doc;
  getCanvasDocument: () => Document | null;
  onTextCursorUpdate?: (elementId: string, offset: number) => void;
}

interface ActiveBinding {
  elementId: string;
  ytext: Y.Text;
  observer: () => void;
  element: Element;
}

export class TextCrdtManager {
  private config: TextCrdtConfig;
  private textMap: Y.Map<Y.Text>;
  private activeBinding: ActiveBinding | null = null;
  private applying = false;

  constructor(config: TextCrdtConfig) {
    this.config = config;
    this.textMap = config.doc.getMap('text-content');
    this.setupRemoteObserver();
  }

  private setupRemoteObserver(): void {
    this.textMap.observeDeep((events) => {
      if (this.applying) return;

      for (const event of events) {
        if (event.transaction.origin === this.config.userId) continue;
        if (!(event instanceof Y.YTextEvent)) continue;

        const path = event.path;
        if (path.length === 0) continue;

        const elementId = path[0] as string;
        this.applyRemoteTextChange(elementId);
      }
    });
  }

  private applyRemoteTextChange(elementId: string): void {
    const doc = this.config.getCanvasDocument();
    if (!doc) return;

    const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${elementId}"]`);
    if (!el) return;

    const ytext = this.textMap.get(elementId);
    if (!ytext) return;

    if (this.activeBinding?.elementId === elementId) {
      this.applyToActiveElement(el, ytext.toString());
    } else {
      el.textContent = ytext.toString();
    }
  }

  private applyToActiveElement(el: Element, text: string): void {
    const selection = window.getSelection();
    const hasSelection = selection && selection.rangeCount > 0;
    let savedOffset = 0;

    if (hasSelection) {
      const range = selection.getRangeAt(0);
      if (el.contains(range.startContainer)) {
        savedOffset = this.getTextOffset(el, range.startContainer, range.startOffset);
      }
    }

    el.textContent = text;

    if (hasSelection && el.firstChild) {
      try {
        const newOffset = Math.min(savedOffset, text.length);
        const range = document.createRange();
        range.setStart(el.firstChild, newOffset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // Selection restoration may fail, ignore
      }
    }
  }

  private getTextOffset(root: Element, node: Node, offset: number): number {
    let totalOffset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();

    while (current) {
      if (current === node) {
        return totalOffset + offset;
      }
      totalOffset += current.textContent?.length || 0;
      current = walker.nextNode();
    }

    return totalOffset + offset;
  }

  bindElement(element: Element): void {
    if (this.activeBinding) {
      this.unbindElement();
    }

    const elementId = ensureEditorId(element);
    let ytext = this.textMap.get(elementId);

    if (!ytext) {
      ytext = new Y.Text();
      ytext.insert(0, element.textContent || '');
      this.config.doc.transact(() => {
        this.textMap.set(elementId, ytext!);
      }, this.config.userId);
    }

    const handleInput = () => {
      if (this.applying) return;

      const newText = element.textContent || '';
      const oldText = ytext!.toString();

      if (newText !== oldText) {
        this.applying = true;
        this.config.doc.transact(() => {
          const diff = this.computeDiff(oldText, newText);
          for (const op of diff) {
            if (op.type === 'delete') {
              ytext!.delete(op.index, op.length);
            } else if (op.type === 'insert') {
              ytext!.insert(op.index, op.text);
            }
          }
        }, this.config.userId);
        this.applying = false;
      }

      this.updateCursorPosition(element, elementId);
    };

    element.addEventListener('input', handleInput);

    const handleSelectionChange = () => {
      this.updateCursorPosition(element, elementId);
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    this.activeBinding = {
      elementId,
      ytext,
      element,
      observer: () => {
        element.removeEventListener('input', handleInput);
        document.removeEventListener('selectionchange', handleSelectionChange);
      },
    };
  }

  unbindElement(): void {
    if (this.activeBinding) {
      this.activeBinding.observer();
      this.activeBinding = null;
    }
  }

  private updateCursorPosition(element: Element, elementId: string): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return;

    const offset = this.getTextOffset(element, range.startContainer, range.startOffset);

    if (this.config.onTextCursorUpdate) {
      this.config.onTextCursorUpdate(elementId, offset);
    }
  }

  private computeDiff(oldText: string, newText: string): Array<
    | { type: 'delete'; index: number; length: number }
    | { type: 'insert'; index: number; text: string }
  > {
    const ops: Array<
      | { type: 'delete'; index: number; length: number }
      | { type: 'insert'; index: number; text: string }
    > = [];

    let commonPrefixLen = 0;
    while (
      commonPrefixLen < oldText.length &&
      commonPrefixLen < newText.length &&
      oldText[commonPrefixLen] === newText[commonPrefixLen]
    ) {
      commonPrefixLen++;
    }

    let commonSuffixLen = 0;
    while (
      commonSuffixLen < oldText.length - commonPrefixLen &&
      commonSuffixLen < newText.length - commonPrefixLen &&
      oldText[oldText.length - 1 - commonSuffixLen] ===
        newText[newText.length - 1 - commonSuffixLen]
    ) {
      commonSuffixLen++;
    }

    const deleteLen = oldText.length - commonPrefixLen - commonSuffixLen;
    const insertText = newText.slice(commonPrefixLen, newText.length - commonSuffixLen || undefined);

    if (deleteLen > 0) {
      ops.push({ type: 'delete', index: commonPrefixLen, length: deleteLen });
    }

    if (insertText.length > 0) {
      ops.push({ type: 'insert', index: commonPrefixLen, text: insertText });
    }

    return ops;
  }

  getActiveElementId(): string | null {
    return this.activeBinding?.elementId ?? null;
  }

  destroy(): void {
    this.unbindElement();
  }
}
