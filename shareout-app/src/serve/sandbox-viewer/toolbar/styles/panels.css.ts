/**
 * Viewer side panels — comments and skills float on the right, under the header
 * @module serve/sandbox-viewer/toolbar/styles/panels
 */

/** CSS rules for: the floating side panels (shell, head, close) and the skills panel body */
export const panelsStyles = `
    #so-comments-overlay, #so-skills-overlay { display: none; font-family: var(--font-body); }
    #so-comments-overlay.open, #so-skills-overlay.so-open { display: block; }
    .so-side {
      position: fixed;
      top: calc(var(--so-hd-h) + var(--space-2));
      right: var(--space-2);
      bottom: var(--space-2);
      z-index: 10001;
      width: min(400px, calc(100vw - 2 * var(--space-2)));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-bg-elevated);
      box-shadow: var(--shadow-xl);
      color: var(--color-text);
      animation: soSideIn var(--duration-slow) var(--ease-out);
    }
    @keyframes soSideIn {
      from { opacity: 0; transform: translateX(12px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) { .so-side { animation: none; } }
    .so-side__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5);
    }
    .so-side__title { margin: 0; font: 600 16px/1.25 var(--font-display); color: var(--color-text); }
    .so-side__close {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .so-side__close:hover { background: var(--color-surface); color: var(--color-text); }
    .so-side__close:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .so-skills-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--radius-full);
      background: var(--color-surface);
      color: var(--color-text-secondary);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }
    .so-skills-body { padding: 0 var(--space-5) var(--space-5); overflow-y: auto; }
    .so-skills-intro { margin: 0 0 var(--space-4); font-size: 13px; line-height: 1.45; color: var(--color-text-secondary); }
    .so-skills-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .so-skill-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: 7px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      background: var(--color-bg);
      color: var(--color-text);
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
    }
    .so-skill-chip:hover { border-color: var(--color-text); }
    .so-skill-chip svg { color: var(--color-text-secondary); flex-shrink: 0; }
`;
