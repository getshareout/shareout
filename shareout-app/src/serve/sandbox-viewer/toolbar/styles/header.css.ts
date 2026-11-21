/**
 * Viewer header styles — the slim bar above the artifact, its buttons and title menu
 * @module serve/sandbox-viewer/toolbar/styles/header
 */

/** CSS rules for: the viewer header, its buttons, the title menu and live presence */
export const headerStyles = `
    :root { --so-hd-h: 48px; }
    /* The artifact frame sits below the header instead of under it. */
    body > iframe { display: block; margin-top: var(--so-hd-h); height: calc(100% - var(--so-hd-h)); }
    #so-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10000;
      height: var(--so-hd-h);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: 0 var(--space-2) 0 var(--space-2);
      background: var(--color-bg-elevated);
      border-bottom: 1px solid var(--color-border);
      color: var(--color-text);
      font: 500 14px/1.2 var(--font-body);
    }
    .so-hd__left, .so-hd__right { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
    .so-hd__left { flex: 1 1 auto; }
    .so-hd__right { flex: 0 0 auto; }
    .so-hd__mark { display: block; width: 20px; height: 20px; margin: 0 var(--space-2); flex-shrink: 0; }
    .so-hd__titlewrap { position: relative; display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
    .so-hd__title {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      min-width: 0;
      height: 32px;
      padding: 0 var(--space-2);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text);
      font: 600 14px/1.2 var(--font-body);
    }
    button.so-hd__title { cursor: pointer; }
    button.so-hd__title:hover, button.so-hd__title[aria-expanded="true"] { background: var(--color-surface); }
    .so-hd__title svg { flex-shrink: 0; color: var(--color-text-tertiary); }
    .so-hd__name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .so-hd__meta { display: inline-flex; align-items: center; gap: var(--space-1); flex-shrink: 0; color: var(--color-text-tertiary); font-size: 13px; font-weight: 400; white-space: nowrap; }
    .so-hd__dot { color: var(--color-border-strong); }
    .so-hd__btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      height: 32px;
      padding: 0 var(--space-3);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-secondary);
      font: 500 14px/1 var(--font-body);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
    }
    .so-hd__btn:hover { background: var(--color-surface); color: var(--color-text); }
    .so-hd__btn--icon { width: 32px; padding: 0; }
    .so-hd__btn--primary { margin-left: var(--space-1); background: var(--color-primary); color: var(--color-text-inverse); }
    .so-hd__btn--primary:hover { background: var(--color-primary-hover); color: var(--color-text-inverse); }
    .so-hd__btn[aria-expanded="true"] { background: var(--color-primary-light); color: var(--color-primary); }
    .so-hd__btn:focus-visible, .so-hd__title:focus-visible, .so-hd__item:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .so-hd__sr {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip: rect(0 0 0 0); white-space: nowrap;
    }
    .so-fav-btn.active { color: var(--color-warning); }
    .so-cmt-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--radius-full);
      background: var(--color-primary);
      color: var(--color-text-inverse);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }
    @keyframes soCmtFlash {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.12); }
    }
    .so-hd__btn.so-cmt-flash { animation: soCmtFlash 0.6s ease; }
    @media (prefers-reduced-motion: reduce) { .so-hd__btn.so-cmt-flash { animation: none; } }

    /* Title menu: the few actions that do not need a button of their own. */
    .so-hd__menu {
      position: absolute;
      top: calc(100% + var(--space-2));
      left: 0;
      z-index: 10003;
      min-width: 220px;
      padding: var(--space-1);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg-elevated);
      box-shadow: var(--shadow-lg);
    }
    .so-hd__menu[hidden] { display: none; }
    .so-hd__item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      min-height: 36px;
      padding: 0 var(--space-3);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text);
      font: 400 14px/1.2 var(--font-body);
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    .so-hd__item:hover { background: var(--color-surface); }
    .so-hd__item svg { flex-shrink: 0; color: var(--color-text-secondary); }
    .so-hd__item .so-skills-count { margin-left: auto; }
    .so-hd__sep { height: 1px; margin: var(--space-1) var(--space-2); background: var(--color-border); }

    /* Who else is here: only shown when someone besides you has the page open. */
    .so-live-presence-btn { display: inline-flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-2); color: var(--color-text-secondary); font-size: 13px; }
    .so-live-presence-btn[hidden] { display: none; }
    .so-live-presence-dot { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-success); flex-shrink: 0; }
    .so-live-presence-avatars { display: inline-flex; align-items: center; flex-direction: row-reverse; }
    .so-live-presence-avatar {
      width: 22px;
      height: 22px;
      margin-left: -6px;
      border-radius: var(--radius-full);
      border: 2px solid var(--color-bg-elevated);
      background: var(--color-surface);
      color: var(--color-text-secondary);
      font-size: 11px;
      font-weight: 600;
      line-height: 18px;
      text-align: center;
    }
    .so-live-presence-avatar.is-you { background: var(--color-primary-light); color: var(--color-primary); }
    .so-live-presence-more { width: auto; min-width: 22px; padding: 0 4px; }

    /* Panels the header opens float under it; the page stays visible and usable. */
    @media (min-width: 641px) {
      body #so-ds-panel { top: calc(var(--so-hd-h) + var(--space-2)); right: var(--space-2); bottom: var(--space-2); }
    }
    #so-header .so-ds-pill {
      height: 32px;
      min-height: 0;
      padding: 0 var(--space-3);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      box-shadow: none;
      color: var(--color-text-secondary);
      font: 500 14px/1 var(--font-body);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    #so-header .so-ds-pill:hover { background: var(--color-surface); color: var(--color-text); transform: none; }
    #so-header .so-ds-pill[aria-expanded="true"] { background: var(--color-primary-light); color: var(--color-primary); }
    body #so-err { top: calc(var(--so-hd-h) + var(--space-3)); }
`;
