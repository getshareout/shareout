/**
 * ShareOut Visual Editor styles — Responsive breakpoints for editor layout
 * @module editor/page/styles/sections/responsive
 */

/** CSS for the responsive section of the visual editor. */
export const responsiveCss = `

/* ==========================================================================
   13. RESPONSIVE
   ========================================================================== */
@media (max-width: 768px) {
  .editor-topbar {
    top: 12px;
    width: calc(100vw - 24px);
    max-width: none;
    padding: 0 6px;
    gap: 8px;
  }

  .topbar-center {
    gap: 6px;
  }

  .artifact-name {
    max-width: 100px;
    font-size: 13px;
  }

  /* EDIT-09 F5: keep save feedback on mobile as a compact colored dot (text hidden) rather
     than hiding it entirely — autosave is silent otherwise. */
  .save-status {
    font-size: 0;
    width: 10px;
    height: 10px;
    padding: 0;
    border-radius: 50%;
  }

  .toolbar-btn {
    width: 32px;
    height: 32px;
  }

  .canvas-scroll {
    padding: 0;
  }

  /* Rail becomes a bottom sheet on narrow screens */
  .studio-rail {
    top: auto;
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
    max-height: 60vh;
  }

  .rail-peek {
    top: auto;
    bottom: 16px;
    right: 16px;
    transform: none;
  }

  .drawer-panel {
    width: 100%;
    max-width: none;
  }

  #chat-input {
    font-size: 16px;
  }
}

@media (max-width: 480px) {
  .editor-topbar {
    gap: 4px;
    height: 48px;
  }

  .topbar-left {
    gap: 1px;
  }

  .topbar-center {
    gap: 4px;
  }

  .topbar-right .so-c-btn span {
    display: none;
  }

  .topbar-right .so-c-btn--primary {
    padding: 8px 12px;
  }

  .toolbar-btn {
    width: 28px;
    height: 28px;
  }

  .toolbar-divider {
    display: none;
  }

  .artifact-name {
    max-width: 60px;
    font-size: 12px;
  }
}
`;
