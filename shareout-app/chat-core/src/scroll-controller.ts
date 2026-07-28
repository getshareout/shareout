/**
 * Reading-first scroll behaviour shared by every ShareOut chat surface.
 *
 * This is the single source of truth for the "never move the reader against their
 * intent" rules: follow the live edge only while the reader is at it, anchor a new
 * turn near the top and let the answer stream into the space below it, keep the
 * reader's place when they have scrolled away, and surface activity that arrives
 * off-screen instead of yanking them to it.
 *
 * Pure DOM — a scroll viewport element and nothing else. No framework, no markup
 * assumptions — so the home dock (bespoke `wsx-*` rows), the editor, the create
 * page and the SDK widget can all attach to it.
 */

/** Reading mode. `follow` sticks to the edge; `hold` is anchored near the top while
 * an answer fills the space below; `away` means the reader scrolled off the edge. */
export type ScrollMode = 'follow' | 'hold' | 'away';

export interface ScrollControllerOptions {
  /** Distance (px) from the bottom still counted as "at the live edge". */
  threshold?: number;
  /** Px of breathing room left above an anchored turn. */
  anchorOffset?: number;
  /** Fired when the reader's at-edge state changes (drive a jump-to-latest button). */
  onEdgeChange?: (atEdge: boolean) => void;
  /** Fired when content is appended while the reader is away from the edge (unread). */
  onAppendWhileAway?: () => void;
}

export interface ScrollController {
  /** Current reading mode. */
  readonly mode: ScrollMode;
  /** True only while the reader sits at the live edge and wants the stream followed. */
  readonly following: boolean;
  /** Is the viewport currently scrolled to (within `threshold` of) the bottom? */
  atEdge(): boolean;
  /**
   * Call after appending content. Sticks to the bottom only when following; in
   * `hold` it begins following once the answer reaches the viewport bottom; when the
   * reader is `away` it fires `onAppendWhileAway` instead of moving them. [1,2,7]
   */
  stickToBottom(): void;
  /** Anchor a freshly added node near the top and enter `hold` (anchor-and-hold). [4,6] */
  anchorTop(el: HTMLElement): void;
  /** Scroll a specific message into view (search hit / reopen point). [11] */
  scrollToAnchor(el: HTMLElement): void;
  /** Return to the live edge and resume following. [9] */
  jumpToLatest(): void;
  /** Run `fn` (which prepends content above the viewport) keeping the reader's place. [12] */
  preserveOnPrepend(fn: () => void): void;
  /** Detach all listeners. */
  destroy(): void;
}

export function createScrollController(
  viewport: HTMLElement,
  options: ScrollControllerOptions = {}
): ScrollController {
  const threshold = options.threshold ?? 60;
  const anchorOffset = options.anchorOffset ?? 12;

  let mode: ScrollMode = 'follow';
  let lastAtEdge = true;
  // Selecting text inside the list must pause follow so a streaming append never
  // rips the selection away; restored when the selection collapses. [3]
  let selecting = false;
  // A scroll we caused ourselves must not be read as reader intent. [3,5]
  let expectProgrammatic = false;

  function distanceFromBottom(): number {
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  }
  function atEdge(): boolean {
    return distanceFromBottom() <= threshold;
  }
  // Where `el` sits within the viewport's scroll range — works whether the viewport
  // is the element's offsetParent (create/widget) or a scrolling ancestor (the
  // editor, where messages live in an inner list inside `.rail-body`).
  function offsetWithin(el: HTMLElement): number {
    return viewport.scrollTop + (el.getBoundingClientRect().top - viewport.getBoundingClientRect().top);
  }
  function setMode(next: ScrollMode): void {
    mode = next;
    emitEdge();
  }
  function emitEdge(): void {
    const now = mode === 'follow';
    if (now !== lastAtEdge) {
      lastAtEdge = now;
      options.onEdgeChange?.(now);
    }
  }
  function scrollToBottom(): void {
    expectProgrammatic = true;
    viewport.scrollTop = viewport.scrollHeight;
  }

  function onScroll(): void {
    if (expectProgrammatic) {
      expectProgrammatic = false;
      return;
    }
    // Real reader movement: at the edge → follow; anywhere else → away. Covers
    // wheel, touch, keyboard and drag, which all surface as a scroll event. [3]
    setMode(atEdge() ? 'follow' : 'away');
  }

  function onSelectionChange(): void {
    const sel = viewport.ownerDocument?.getSelection?.();
    const active =
      !!sel &&
      !sel.isCollapsed &&
      sel.rangeCount > 0 &&
      viewport.contains(sel.getRangeAt(0).commonAncestorContainer);
    selecting = active;
  }

  viewport.addEventListener('scroll', onScroll, { passive: true });
  const doc = viewport.ownerDocument;
  doc?.addEventListener('selectionchange', onSelectionChange);

  return {
    get mode() {
      return mode;
    },
    get following() {
      return mode === 'follow';
    },
    atEdge,
    stickToBottom() {
      if (selecting) return;
      if (mode === 'follow') {
        scrollToBottom();
      } else if (mode === 'hold') {
        // Answer has grown past the viewport bottom — begin following it. [5→7]
        if (distanceFromBottom() > anchorOffset) {
          setMode('follow');
          scrollToBottom();
        }
      } else if (!atEdge()) {
        options.onAppendWhileAway?.();
      }
    },
    anchorTop(el: HTMLElement) {
      expectProgrammatic = true;
      viewport.scrollTop = Math.max(0, offsetWithin(el) - anchorOffset);
      setMode('hold');
    },
    scrollToAnchor(el: HTMLElement) {
      expectProgrammatic = true;
      viewport.scrollTop = Math.max(0, offsetWithin(el) - anchorOffset);
      setMode('away');
    },
    jumpToLatest() {
      scrollToBottom();
      setMode('follow');
    },
    preserveOnPrepend(fn: () => void) {
      const before = viewport.scrollHeight;
      const top = viewport.scrollTop;
      fn();
      expectProgrammatic = true;
      viewport.scrollTop = top + (viewport.scrollHeight - before);
    },
    destroy() {
      viewport.removeEventListener('scroll', onScroll);
      doc?.removeEventListener('selectionchange', onSelectionChange);
    },
  };
}
