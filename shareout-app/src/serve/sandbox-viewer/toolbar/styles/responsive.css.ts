/**
 * Viewer header styles — phone layout: icon-only buttons, full-width panels
 * @module serve/sandbox-viewer/toolbar/styles/responsive
 */

/** CSS rules for: the phone layout of the header, its panels and modals */
export const responsiveStyles = `    @media (max-width: 640px) {
      #so-header { gap: var(--space-1); padding: 0 var(--space-1); }
      .so-hd__label, .so-hd__meta, #so-header .so-ds-pill span { display: none; }
      .so-hd__btn, #so-header .so-ds-pill { width: 36px; padding: 0; }
      .so-hd__btn .so-cmt-count { position: absolute; top: 0; right: -2px; min-width: 16px; height: 16px; font-size: 10px; }
      .so-hd__menu { max-width: calc(100vw - 2 * var(--space-2)); }
      .so-side { left: var(--space-2); width: auto; }
      .so-sched-dest-grid, .so-sched-row { grid-template-columns: 1fr; }
    }
`;
