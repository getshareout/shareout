/**
 * Incremental in-thread find. Highlights case-insensitive matches across message
 * text, steps through them with next/prev, and navigates via the controller's
 * `scrollToAnchor` so jumping to a hit obeys the same reading rules as everything
 * else. Surface owns the input box and the count label; this owns match/scroll/
 * highlight. Only surfaces with persistent history (the dock) use it. [10]
 */
import type { ScrollController } from './scroll-controller';

export interface ChatSearchOptions {
  /** CSS selector for the message containers to search within the viewport. */
  messageSelector: string;
  /** Class for each match wrapper. Default `cc-hit`. */
  hitClass?: string;
  /** Class for the currently-active match. Default `cc-hit-active`. */
  activeClass?: string;
  /** Reports the active index (1-based) and total matches; 0,0 when cleared. */
  onCount?: (current: number, total: number) => void;
}

export interface ChatSearch {
  /** Highlight all matches for `query`, activate the first, return the total. */
  search(query: string): number;
  next(): void;
  prev(): void;
  /** Remove all highlights and restore the original text. */
  clear(): void;
}

export function createChatSearch(
  viewport: HTMLElement,
  controller: ScrollController,
  options: ChatSearchOptions
): ChatSearch {
  const hitClass = options.hitClass ?? 'cc-hit';
  const activeClass = options.activeClass ?? 'cc-hit-active';
  let hits: HTMLElement[] = [];
  let current = -1;

  function clear(): void {
    for (const mark of hits) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(viewport.ownerDocument.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
    hits = [];
    current = -1;
  }

  function highlightIn(root: Element, q: string): void {
    const doc = viewport.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    for (const tn of textNodes) {
      const text = tn.nodeValue || '';
      const lower = text.toLowerCase();
      let idx = lower.indexOf(q);
      if (idx < 0) continue;
      const frag = doc.createDocumentFragment();
      let pos = 0;
      while (idx >= 0) {
        if (idx > pos) frag.appendChild(doc.createTextNode(text.slice(pos, idx)));
        const mark = doc.createElement('mark');
        mark.className = hitClass;
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        hits.push(mark);
        pos = idx + q.length;
        idx = lower.indexOf(q, pos);
      }
      if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
      tn.parentNode?.replaceChild(frag, tn);
    }
  }

  function activate(): void {
    hits.forEach((h, i) => h.classList.toggle(activeClass, i === current));
    const el = hits[current];
    if (el) controller.scrollToAnchor(el);
    options.onCount?.(hits.length ? current + 1 : 0, hits.length);
  }

  return {
    search(query: string): number {
      clear();
      const q = query.trim().toLowerCase();
      if (!q) {
        options.onCount?.(0, 0);
        return 0;
      }
      viewport.querySelectorAll(options.messageSelector).forEach((m) => highlightIn(m, q));
      if (hits.length) {
        current = 0;
        activate();
      } else {
        options.onCount?.(0, 0);
      }
      return hits.length;
    },
    next() {
      if (!hits.length) return;
      current = (current + 1) % hits.length;
      activate();
    },
    prev() {
      if (!hits.length) return;
      current = (current - 1 + hits.length) % hits.length;
      activate();
    },
    clear,
  };
}
