/**
 * Viewer toolbar styles — Back-to-home hover zone and pill link
 * @module serve/sandbox-viewer/toolbar/styles/back-home
 */

/** CSS rules for: Back-to-home hover zone and pill link */
export const backHomeStyles = `    #so-back-zone {
      position: fixed;
      top: 0;
      left: 0;
      width: 72px;
      height: 96px;
      z-index: 9999;
    }
    #so-back-home {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 10000;
      display: inline-flex;
      align-items: center;
      height: 40px;
      padding: 0 12px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(231, 229, 228, 0.6);
      box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);
      color: var(--color-text);
      text-decoration: none;
      font: 500 14px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
      opacity: 0;
      transform: translateX(calc(-100% - 24px));
      pointer-events: none;
      transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    #so-back-home svg { flex-shrink: 0; display: block; }
    #so-back-home .so-back-label {
      max-width: 0;
      margin-left: 0;
      overflow: hidden;
      white-space: nowrap;
      transition: max-width 0.24s cubic-bezier(0.34, 1.56, 0.64, 1), margin-left 0.24s ease;
    }
    #so-back-zone:hover ~ #so-back-home,
    #so-back-home:hover, #so-back-home:focus-visible {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    #so-back-zone:hover ~ #so-back-home .so-back-label,
    #so-back-home:hover .so-back-label, #so-back-home:focus-visible .so-back-label {
      max-width: 160px;
      margin-left: 6px;
    }

`;
