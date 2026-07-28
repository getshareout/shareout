/**
 * A polite screen-reader announcer for chat. Owns one visually-hidden
 * `aria-live="polite"` region and coalesces messages so a stream of tokens does not
 * flood assistive tech — announce turn boundaries ("Response complete", "New
 * message"), not every delta. The region is non-focusable, so it never disturbs the
 * reader's keyboard focus. [15]
 */
export interface LiveAnnouncerOptions {
  /** Where to mount the live region. Defaults to `document.body`. */
  mount?: HTMLElement;
  /** Minimum gap (ms) between spoken updates; extras coalesce to the latest. */
  throttleMs?: number;
}

export interface LiveAnnouncer {
  /** Queue an announcement. Coalesced to the throttle window unless `now` is set. */
  announce(text: string, opts?: { now?: boolean }): void;
  destroy(): void;
}

const SR_ONLY =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
  'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';

export function createLiveAnnouncer(options: LiveAnnouncerOptions = {}): LiveAnnouncer {
  const throttle = options.throttleMs ?? 1000;
  const mount = options.mount ?? document.body;

  const region = document.createElement('div');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-atomic', 'true');
  region.style.cssText = SR_ONLY;
  mount.appendChild(region);

  let last = 0;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(text: string): void {
    // Re-assign even if identical so repeated boundaries re-announce.
    region.textContent = '';
    region.textContent = text;
    last = Date.now();
  }

  return {
    announce(text: string, opts?: { now?: boolean }) {
      if (opts?.now) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        pending = null;
        flush(text);
        return;
      }
      const elapsed = Date.now() - last;
      if (elapsed >= throttle) {
        flush(text);
        return;
      }
      pending = text; // latest wins
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (pending != null) {
            flush(pending);
            pending = null;
          }
        }, throttle - elapsed);
      }
    },
    destroy() {
      if (timer) clearTimeout(timer);
      region.remove();
    },
  };
}
