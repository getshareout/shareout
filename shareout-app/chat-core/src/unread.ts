/**
 * Tracks messages that arrive while the reader is away from the live edge, so a
 * surface can show "N new below" on its jump-to-latest control and, optionally,
 * drop a "new messages" divider at the first unread turn. Composes over a
 * {@link ScrollController}; the surface wires `reset()` to the controller's
 * `onEdgeChange` (clear once the reader is back at the edge). [8,10]
 */
import type { ScrollController } from './scroll-controller';

export interface UnreadTrackerOptions {
  /** Fired whenever the unread count changes (0 included, on reset). */
  onCount?: (n: number) => void;
  /** Build the divider node inserted before the first unread message. Omit to skip. */
  makeDivider?: () => HTMLElement;
}

export interface UnreadTracker {
  readonly count: number;
  /** Call after appending a message. Counts it only when the reader is away. */
  onAppend(messageEl?: HTMLElement): void;
  /** Clear the count and remove the divider. */
  reset(): void;
}

export function createUnreadTracker(
  controller: ScrollController,
  options: UnreadTrackerOptions = {}
): UnreadTracker {
  let count = 0;
  let divider: HTMLElement | null = null;

  return {
    get count() {
      return count;
    },
    onAppend(messageEl?: HTMLElement) {
      // Only count when the reader has scrolled away. In `hold` (anchor-and-hold)
      // the new turn IS what they are reading, so it is not "unread". [7,8]
      if (controller.mode !== 'away') return;
      if (count === 0 && options.makeDivider && messageEl?.parentNode) {
        divider = options.makeDivider();
        messageEl.parentNode.insertBefore(divider, messageEl);
      }
      count += 1;
      options.onCount?.(count);
    },
    reset() {
      if (count === 0 && !divider) return;
      divider?.remove();
      divider = null;
      count = 0;
      options.onCount?.(0);
    },
  };
}
