/**
 * Viewer Data sources panel: the "Data" pill and the side panel. Design tokens only
 * (--color-*, --space-*, --radius-*, --shadow-*, motion); the page around the artifact
 * stays visible, so the elements a source feeds can be seen while it is highlighted.
 */
export const dataSourcesStyles = `
    .so-ds-pill {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--touch-target-min);
      padding: 0 var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--color-bg-elevated) 92%, transparent);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      box-shadow: var(--shadow-md);
      color: var(--color-text);
      font: 500 14px/1 var(--font-body);
      cursor: pointer;
      transition: background var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out), transform var(--duration-fast) var(--ease-out);
    }
    .so-ds-pill[hidden] { display: none; }
    .so-ds-pill svg { flex-shrink: 0; color: var(--color-text-secondary); }
    .so-ds-pill:hover { background: var(--color-bg-elevated); box-shadow: var(--shadow-lg); transform: translateY(-1px); }
    .so-ds-pill:hover svg { color: var(--color-text); }
    .so-ds-pill:active { transform: scale(0.98); }
    .so-ds-pill[aria-expanded="true"] { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
    .so-ds-pill[aria-expanded="true"] svg { color: var(--color-primary); }
    .so-ds-pill:focus-visible, .so-ds-close:focus-visible, .so-ds-src:focus-visible, .so-ds-retry:focus-visible,
    .so-ds-more summary:focus-visible, .so-ds-links a:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    #so-ds-dock { position: fixed; right: var(--space-5); bottom: var(--space-5); z-index: 10000; }
    #shareout-admin-toolbar.so-dragging .so-ds-pill { display: none; }

    #so-ds-panel {
      position: fixed;
      top: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
      z-index: 10001;
      display: flex;
      flex-direction: column;
      width: min(380px, calc(100vw - 2 * var(--space-4)));
      overflow: hidden;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-bg-elevated);
      box-shadow: var(--shadow-xl);
      color: var(--color-text);
      font: 400 14px/1.45 var(--font-body);
      animation: so-ds-in var(--duration-slow) var(--ease-out);
    }
    #so-ds-panel[hidden] { display: none; }
    @keyframes so-ds-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
    .so-ds-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-5) var(--space-4) 0 var(--space-5); }
    .so-ds-title { margin: 0; font: 600 18px/1.25 var(--font-display); color: var(--color-text); }
    .so-ds-title:focus { outline: none; }
    .so-ds-close {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
    }
    .so-ds-close:hover { background: var(--color-surface); color: var(--color-text); }
    .so-ds-lead { margin: var(--space-1) var(--space-5) var(--space-4); color: var(--color-text-secondary); font-size: 13px; }
    .so-ds-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--space-3) var(--space-4); }
    .so-ds-list { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
    .so-ds-src {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      width: 100%;
      min-height: var(--touch-target-min);
      padding: var(--space-3);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
    }
    .so-ds-src:hover, .so-ds-src:focus-visible { background: var(--color-surface); }
    .so-ds-src[aria-pressed="true"] { border-color: color-mix(in srgb, var(--color-primary) 35%, transparent); background: var(--color-primary-light); }
    .so-ds-ico {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-secondary);
    }
    .so-ds-src:hover .so-ds-ico { background: var(--color-bg-elevated); }
    .so-ds-src[aria-pressed="true"] .so-ds-ico { background: var(--color-bg-elevated); color: var(--color-primary); }
    .so-ds-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .so-ds-name { color: var(--color-text); font-weight: 600; overflow-wrap: anywhere; }
    .so-ds-tag {
      display: inline-block;
      margin-left: var(--space-2);
      padding: 1px var(--space-2);
      border-radius: var(--radius-full);
      background: var(--color-surface);
      color: var(--color-text-secondary);
      font-size: 12px;
      font-weight: 500;
      vertical-align: 1px;
    }
    .so-ds-src[aria-pressed="true"] .so-ds-tag { background: var(--color-bg-elevated); }
    .so-ds-meta, .so-ds-feeds { color: var(--color-text-secondary); font-size: 13px; overflow-wrap: anywhere; }
    .so-ds-stale {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      width: fit-content;
      margin-top: 2px;
      padding: 2px var(--space-2);
      border-radius: var(--radius-full);
      background: var(--color-warning-light);
      color: var(--color-text);
      font-size: 12px;
      font-weight: 500;
    }
    .so-ds-stale svg { flex-shrink: 0; color: var(--color-warning); }
    .so-ds-more { margin: 0 var(--space-3) var(--space-2) calc(32px + 2 * var(--space-3)); color: var(--color-text-secondary); font-size: 13px; }
    .so-ds-more summary { display: inline-flex; align-items: center; min-height: 32px; color: var(--color-primary); font-weight: 500; cursor: pointer; }
    .so-ds-more pre {
      max-height: 180px;
      margin: var(--space-2) 0;
      padding: var(--space-3);
      overflow: auto;
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      font: 12px/1.5 var(--font-mono);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .so-ds-more dl { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); margin: var(--space-2) 0 0; }
    .so-ds-more dt { color: var(--color-text-secondary); font-weight: 600; }
    .so-ds-more dd { margin: 0; color: var(--color-text); overflow-wrap: anywhere; }
    .so-ds-links { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-2); }
    .so-ds-links a { color: var(--color-primary); font-weight: 500; text-decoration: none; }
    .so-ds-links a:hover { text-decoration: underline; }
    .so-ds-foot { margin: 0; padding: var(--space-3) var(--space-5) var(--space-4); border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: 12px; }
    .so-ds-state { padding: var(--space-8) var(--space-4); color: var(--color-text-secondary); text-align: center; }
    .so-ds-retry {
      margin-top: var(--space-3);
      min-height: var(--touch-target-min);
      padding: 0 var(--space-4);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text);
      font: 500 14px var(--font-body);
      cursor: pointer;
    }
    .so-ds-retry:hover { background: var(--color-surface); }
    .so-ds-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .so-ds-skel { height: 64px; margin-bottom: var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface); }
    @media (max-width: 640px) {
      #so-ds-panel { top: auto; left: var(--space-4); width: auto; max-height: 72vh; }
      #so-ds-dock { right: var(--space-4); bottom: var(--space-4); }
      body.so-hide-toolbar-mobile #so-ds-dock { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      #so-ds-panel { animation: none; }
      .so-ds-pill, .so-ds-src { transition: none; }
      .so-ds-pill:hover { transform: none; }
    }
`;
