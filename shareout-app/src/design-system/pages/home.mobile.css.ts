/**
 * ShareOut Home — mobile & touch layer.
 *
 * Single source of truth for the home page's phone/tablet layout and touch
 * ergonomics. Styles the artifact cards (home.css.ts) rendered by render-cards
 * and injected into the workspace shell; this file adapts them at narrow widths.
 *
 * Breakpoints follow Design/system/layout.md:
 *   mobile  < 640px   single column, stacked, one action per surface
 *   tablet  640–1024  flexible, rail collapses to a drawer
 *   desktop > 1024px  full layout (untouched here)
 *
 * Principles applied: generous spacing, one thing at a time, 44px touch
 * targets, instant feedback (no layout jumps). Appended last to
 * homePageStyles so these rules win ties against the base cascade.
 */
export const homeMobileStyles = `
/* ── Rail → off-canvas drawer (≤1024px) ─────────────── */
@media (max-width: 1024px) {
  .shell { grid-template-columns: 1fr; }
  .rail-burger { display: flex; }

  .rail {
    position: fixed; z-index: 330;
    top: 0; left: 0; bottom: 0;
    width: min(82vw, 320px); height: 100%;
    margin: 0;
    border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
    transform: translateX(-104%);
    transition: transform var(--duration-normal);
    overscroll-behavior: contain;
  }
  html.rail-open .rail { transform: translateX(0); }
  html.rail-open .rail-scrim { display: block; opacity: 1; }

  .main { padding: var(--space-4) var(--space-5) var(--space-12); gap: var(--space-6); }
  /* Static (not sticky) so the in-flow header starts at the very top. */
  .topbar { position: static; margin: 0; padding: 0; background: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
}

/* ── Mobile: compact header (<640px) ────────────────────
   Row 1: [burger] … [avatar]            — navigation + account
   Row 2: search (≈60%) · folder · sort · view  — one tidy control row
   Folders move from a chip strip into the folder dropdown here.       */
@media (max-width: 640px) {
  .main { padding: 12px var(--space-4) var(--space-12); gap: var(--space-5); }

  /* Pin the burger to the header's first row so it lines up with the avatar
     (no more burger floating above everything). */
  .rail-burger { top: 12px; left: 12px; }

  .topbar { flex-wrap: wrap; gap: var(--space-3); padding-left: 52px; min-height: 44px; align-items: center; }
  .account { order: 0; margin-left: auto; }
  .topbar-controls { order: 1; flex: 1 1 100%; }

  /* Everything on one row: search takes ~60%, controls share the rest. */
  .toolbar { flex-wrap: nowrap; gap: var(--space-2); align-items: center; }
  .toolbar-left { flex: 1 1 60%; min-width: 0; }
  .toolbar-right { flex: 0 1 auto; min-width: 0; justify-content: flex-end; gap: 6px; }
  .search-box { flex: 1 1 100%; max-width: none; min-width: 0; }
  .result-count { display: none; }

  /* Folder picker replaces the chip strip on mobile. */
  .folder-dropdown { display: block; flex: 0 0 auto; }
  .fnav-menu { left: auto; right: 0; max-width: calc(100vw - 32px); }
  .folders-panel { display: none; }

  /* Controls go icon-only so search keeps the lion's share of the row. */
  .sort-label, .sort-caret { display: none; }
  .sort-icon { display: block; }
  .toolbar-right .sort-trigger { padding: 12px 9px; gap: 0; }
  .toolbar-right .view-toggle { padding: 2px; }
  .toolbar-right .view-btn { width: 32px; height: 32px; }
  .toolbar-right .view-btn svg { width: 17px; height: 17px; }

  /* Single column — one story per row. */
  .artifacts-grid { grid-template-columns: 1fr; }
  .connectors-grid { grid-template-columns: 1fr 1fr; }
  .conn-picker-grid { grid-template-columns: 1fr; }
  .ws-conn-table .wsc-created, .ws-conn-table th:nth-child(5) { display: none; }
  .view-users > .connectors-panel:first-child .connectors-head,
  .view-connectors > .connectors-panel:first-child .connectors-head { padding-right: 0; }

  /* Bulk-action bar docks to the bottom edge. */
  .cmdbar { left: 12px; right: 12px; bottom: 12px; transform: translateY(140%); padding-left: 12px; gap: 0.4rem; }
  .cmdbar.show { transform: translateY(0); }
  .cmdbar-btn span { display: none; }
  .cmdbar-btn { padding: 9px; }

  /* Account pill: avatar only (name folds away, sign-out stays reachable). */
  .account { padding: 4px; gap: 0.4rem; }
  .account .user-name { display: none; }
}

/* ── Artifact detail: full-screen sheet, opens in one move (<640px) ──
   Fixed full height from the start so the seed→hydrate content swap never
   grows the panel — it slides up once and stays put (no two-step jump).    */
@media (max-width: 640px) {
  .drawer-backdrop { display: none; }
  .detail-drawer {
    top: 0; left: 0; right: 0; bottom: 0;
    width: 100%; max-width: none;
    height: 100vh; height: 100dvh; max-height: none;
    border: none; border-radius: 0;
    padding-top: env(safe-area-inset-top, 0px);
    box-shadow: none;
    transform: translateY(100%);
    transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .drawer-overlay.open .detail-drawer { transform: translateY(0); }
  .drawer-grip { display: block; }
}

/* ── Touch ergonomics: ≥44px targets; no hover-only clutter ──
   On a card, the one action is "tap to open its details" — the hover action
   cluster and select checkbox would overflow and compete, so they're hidden
   here and live inside the detail sheet instead (Design: one thing at a time). */
@media (pointer: coarse) {
  /* iOS zooms when an input's font-size < 16px on focus — pin to 16px. */
  .search-box input, .so-c-input, .confirm-input, .detail-title-input, .detail-desc, .detail-tag-input { font-size: 16px; }

  .rail-burger { width: 44px; height: 44px; }
  .rail-burger svg { width: 22px; height: 22px; }
  .account-signout { display: flex; width: 40px; height: 40px; }
  .user-avatar { width: 40px; height: 40px; }

  .search-box input { padding-top: 12px; padding-bottom: 12px; }
  .search-clear { width: 32px; height: 32px; }
  .sort-trigger { padding: 12px 14px; }
  .folder-nav-trigger { padding: 12px; }
  .view-btn { width: 44px; height: 44px; }
  .view-btn svg { width: 20px; height: 20px; }

  /* Declutter the grid card: the drawer holds the actions. */
  .browser[data-view="grid"] .card-actions,
  .browser[data-view="grid"] .card-select { display: none; }

  /* Bigger nav rows + folder chips for thumbs. */
  .nav-item { padding-top: 11px; padding-bottom: 11px; }
  .folder-chip { padding: 10px 12px; }
  .folder-chip-menu { width: 32px; height: 32px; opacity: 1; margin-left: 0; }
  .ws-expand { width: 36px; height: 36px; }

  .detail-icon { width: 44px; height: 44px; }
  .detail-icon svg { width: 20px; height: 20px; }
}
`;
