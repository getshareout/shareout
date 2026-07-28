/**
 * Viewer toolbar styles — Mobile toolbar layout and overlay sizing
 * @module serve/sandbox-viewer/toolbar/styles/responsive
 */

/** CSS rules for: Mobile toolbar layout and overlay sizing */
export const responsiveStyles = `    @media (max-width: 640px) {
      /* Toolbar overlaps artifact FABs on mobile — hidden unless the artifact opts in. */
      body.so-hide-toolbar-mobile #shareout-admin-toolbar,
      body.so-hide-toolbar-mobile #so-back-zone,
      body.so-hide-toolbar-mobile #so-back-home {
        display: none !important;
      }
      #shareout-admin-toolbar {
        flex-direction: column;
        align-items: flex-end;
        bottom: 16px;
        right: 16px;
      }
      #so-toolbar-items {
        flex-direction: column;
        align-items: flex-end;
        max-height: calc(100vh - 96px);
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      .so-toolbar-btn {
        max-width: calc(100vw - 32px);
        transform: translateY(10px) scale(0.88);
      }
      .so-toolbar-btn span { white-space: nowrap; }
      #so-stats-overlay, #so-admin-overlay { padding: 16px; }
      #so-stats-panel, #so-admin-panel { width: 100%; max-width: calc(100vw - 32px); }
      .so-sched-dest-grid, .so-sched-row { grid-template-columns: 1fr; }
    }
`;
