// Auto-hide the floating topbar while working: it slides away when you scroll the
// page and reveals when the pointer nears the top edge (or hovers the bar itself).
import type { EditorContext } from '../editor/context';

let topbar: HTMLElement | null = null;
let nearTop = false;

const REVEAL_ZONE_PX = 76;
const SCROLL_HIDE_PX = 48;

function reveal(): void {
  topbar?.classList.remove('editor-topbar--hidden');
}

function conceal(): void {
  if (!nearTop) topbar?.classList.add('editor-topbar--hidden');
}

export function setupTopbarAutohide(_ctx: EditorContext): void {
  topbar = document.querySelector('.editor-topbar');
  if (!topbar) return;

  document.addEventListener('mousemove', (e) => {
    nearTop = e.clientY < REVEAL_ZONE_PX;
    if (nearTop) reveal();
  });

  topbar.addEventListener('mouseenter', () => { nearTop = true; reveal(); });
  topbar.addEventListener('mouseleave', () => { nearTop = false; });
}

/** (Re)bind scroll tracking to the current canvas document. */
export function bindTopbarAutohide(_ctx: EditorContext, doc: Document): void {
  if ((doc as any).__topbarBound) return;
  (doc as any).__topbarBound = true;
  doc.addEventListener(
    'scroll',
    () => {
      const y = doc.scrollingElement?.scrollTop ?? 0;
      if (y > SCROLL_HIDE_PX) conceal();
      else reveal();
    },
    { passive: true, capture: true }
  );
}
