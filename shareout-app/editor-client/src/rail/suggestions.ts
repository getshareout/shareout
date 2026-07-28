// Proactive co-pilot — suggestion chips computed client-side from the page + manifest
import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { sendChatMessage } from '../chat/chat';

const SPARK = `<svg class="rail-suggestion-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/></svg>`;

/** Suggestions for the whole page, shown in the Agent pane on load. */
export function buildPageChips(ctx: EditorContext): string[] {
  const doc = ctx.dom.canvasFrame?.contentDocument;
  const chips: string[] = [];
  const manifest = ctx.state.manifest;
  const hasData = !!(manifest && (manifest.jsonKeys.length || manifest.tableNames.length));

  if (!hasData) chips.push('Connect this page to a dataset');
  if (doc && !doc.querySelector('button, a.so-c-btn, [data-shareout-action]')) {
    chips.push('Add a call-to-action button');
  }
  if (doc && doc.querySelector('h1, h2')) chips.push('Polish the hero section');
  chips.push('Tighten the spacing and make it feel premium');

  return chips.slice(0, 4);
}

/** Suggestions for a selected element, shown atop the Inspect pane. */
export function buildSelectionChips(element: Element): string[] {
  const tag = element.tagName.toLowerCase();
  const chips: string[] = [];

  if (/^(table|ul|ol|dl)$/.test(tag) || element.querySelector('tr, li')) {
    chips.push('Connect this to a dataset');
  }
  if (/^h[1-6]$/.test(tag) || tag === 'p') chips.push('Rewrite this copy');
  if (/^(button|a)$/.test(tag)) chips.push('Make this stand out more');
  chips.push(`Restyle this ${tag}`);

  return chips.slice(0, 3);
}

/** Render chips into a host and wire each to prefill + send the agent. */
export function renderChips(ctx: EditorContext, host: HTMLElement | null, chips: string[]): void {
  if (!host) return;
  if (!chips.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = chips
    .map((c) => `<button class="rail-suggestion" data-prompt="${escapeHtml(c)}">${SPARK}<span>${escapeHtml(c)}</span></button>`)
    .join('');

  host.querySelectorAll<HTMLButtonElement>('.rail-suggestion').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!ctx.dom.chatInput) return;
      ctx.dom.chatInput.value = btn.dataset.prompt || '';
      sendChatMessage(ctx);
    });
  });
}
