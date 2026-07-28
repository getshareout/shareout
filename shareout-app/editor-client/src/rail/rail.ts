// Studio rail — unified glass panel hosting Agent · Inspect · Data
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { renderPropertyPanel } from '../properties/property-panel';
import { renderDataBrowser } from './data-browser';
import { buildPageChips, buildSelectionChips, renderChips } from './suggestions';

const log = createLogger('rail');

export type RailMode = 'agent' | 'inspect' | 'data' | 'panel';

export function setupStudioRail(ctx: EditorContext): void {
  const rail = ctx.dom.studioRail;
  if (!rail) {
    log.warn('setupStudioRail: #studio-rail missing');
    return;
  }

  const peek = document.getElementById('rail-peek');

  document.getElementById('rail-collapse')?.addEventListener('click', () => {
    rail.dataset.collapsed = 'true';
    if (peek) peek.hidden = false;
  });

  peek?.addEventListener('click', () => {
    rail.dataset.collapsed = 'false';
    peek.hidden = true;
  });

  document.getElementById('rail-panel-back')?.addEventListener('click', () => {
    setRailMode(ctx, 'agent');
  });

  rail.querySelectorAll<HTMLButtonElement>('.rail-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      setRailMode(ctx, tab.dataset.mode as RailMode);
    });
  });

  // Proactive co-pilot: greet with page-level suggestions
  renderChips(ctx, ctx.dom.railSuggestions, buildPageChips(ctx));
}

export function setRailMode(ctx: EditorContext, mode: RailMode): void {
  const rail = ctx.dom.studioRail;
  if (!rail) return;

  rail.dataset.mode = mode;

  rail.querySelectorAll<HTMLElement>('.rail-tab').forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  rail.querySelectorAll<HTMLElement>('.rail-pane').forEach((pane) => {
    pane.hidden = pane.dataset.pane !== mode;
  });

  if (mode === 'data') void renderDataBrowser(ctx);
}

/** Route a selection change into the rail: open Inspect with live properties. */
export function railOnSelection(ctx: EditorContext, element: Element | null): void {
  const inspectTab = document.getElementById('tab-inspect') as HTMLButtonElement | null;

  if (element) {
    if (inspectTab) inspectTab.disabled = false;
    setRailMode(ctx, 'inspect');
    renderPropertyPanel(ctx, element);
    renderChips(ctx, document.getElementById('inspect-suggestions'), buildSelectionChips(element));
    return;
  }

  renderPropertyPanel(ctx, null);
  if (inspectTab) inspectTab.disabled = true;
  if (ctx.dom.studioRail?.dataset.mode === 'inspect') {
    setRailMode(ctx, 'agent');
  }
}
