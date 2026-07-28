/**
 * Theme scopes for the shared component library.
 *
 * The so-c-* components read their look from --soc-* custom properties with
 * design-token fallbacks, so the default (unscoped) look is the standard system.
 * Wrapping a surface in one of these classes re-skins every shared component
 * inside it WITHOUT forking the component — this is how one implementation
 * serves three visual identities.
 *
 *   .so-theme-glass  → home's translucent "glass" aesthetic
 *   .so-theme-admin  → superadmin's compact, neutral density
 *   .so-theme-viewer → artifact viewer toolbar modals (glass + warm type)
 */

export const themeClasses = `
/* Home: glass — translucent surfaces, blurred scrim, larger radii. Depends on
   --glass-border defined in design-system/pages/home.css.ts. */
.so-theme-glass {
  --soc-overlay-bg: rgba(15, 23, 42, 0.45);
  --soc-overlay-blur: blur(4px);
  --soc-modal-bg: var(--color-surface);
  --soc-modal-border: var(--glass-border);
  --soc-input-bg: rgba(255, 255, 255, 0.55);
  --soc-input-bg-focus: rgba(255, 255, 255, 0.85);
  --soc-input-border: var(--glass-border);
  --soc-input-radius: var(--radius-md);
  --soc-input-pad: 9px 12px;
  --soc-input-font: 0.9rem;
  --soc-label-font: 0.7rem;
  --soc-label-weight: 700;
  --soc-label-spacing: 0.05em;
  --soc-label-color: var(--color-text-tertiary);
  --soc-secondary-bg: rgba(255, 255, 255, 0.45);
  --soc-secondary-border: var(--glass-border);
  --soc-btn-radius: var(--radius-md);
  --soc-btn-pad: 8px 12px;
  --soc-btn-font: 0.8rem;
}
.so-theme-glass .so-c-btn--secondary:not(:disabled):hover { background: rgba(255, 255, 255, 0.7); color: var(--color-text); }
.so-theme-glass .so-c-btn--primary { --soc-btn-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent); }
.so-theme-glass .so-c-btn--primary:not(:disabled):hover { --soc-primary-hover: var(--color-primary); filter: brightness(1.05); transform: translateY(-1px); }

/* Superadmin: compact, neutral, opaque. */
.so-theme-admin {
  --soc-overlay-bg: rgba(0, 0, 0, 0.45);
  --soc-modal-width: min(560px, calc(100vw - 32px));
  --soc-input-border: var(--color-border-strong);
  --soc-input-radius: 10px;
  --soc-input-pad: 10px 12px;
  --soc-input-font: 14px;
  --soc-focus-ring: var(--color-primary-glow);
  --soc-secondary-bg: var(--color-bg-elevated);
  --soc-secondary-border: var(--color-border-strong);
  --soc-btn-radius: var(--radius-lg);
  --soc-btn-pad: 7px 12px;
  --soc-btn-font: 13px;
  --soc-badge-font-family: var(--font-mono);
  --soc-badge-font: 11px;
  --soc-badge-weight: 600;
  --soc-badge-pad: 2px 7px;
  --soc-badge-radius: var(--radius-sm);
}

/* Artifact viewer: warm glass modals over the sandbox iframe. Self-contained —
   does not depend on home.css --glass-border. */
.so-theme-viewer {
  font-family: var(--font-body);
  --glass-border: rgba(231, 229, 228, 0.65);
  --soc-overlay-bg: rgba(28, 25, 23, 0.42);
  --soc-overlay-blur: blur(6px);
  --soc-modal-width: min(480px, calc(100vw - 32px));
  --soc-modal-bg: rgba(255, 255, 255, 0.94);
  --soc-modal-border: rgba(255, 255, 255, 0.72);
  --soc-modal-radius: 20px;
  --soc-modal-shadow: 0 20px 60px rgba(0, 0, 0, 0.14), 0 8px 24px rgba(0, 0, 0, 0.08);
  --soc-input-bg: rgba(255, 255, 255, 0.72);
  --soc-input-bg-focus: rgba(255, 255, 255, 0.95);
  --soc-input-border: var(--glass-border);
  --soc-input-radius: 12px;
  --soc-input-pad: 11px 14px;
  --soc-input-font: 0.9rem;
  --soc-label-font: 0.8125rem;
  --soc-label-weight: 600;
  --soc-label-spacing: 0;
  --soc-label-color: var(--color-text);
  --soc-secondary-bg: rgba(255, 255, 255, 0.55);
  --soc-secondary-border: var(--glass-border);
  --soc-btn-radius: 12px;
  --soc-btn-pad: 11px 16px;
  --soc-btn-font: 0.875rem;
}
.so-theme-viewer .so-c-label {
  text-transform: none;
  letter-spacing: normal;
  margin: 0 0 6px;
}
.so-theme-viewer .so-c-modal__head {
  align-items: flex-start;
  padding: 18px 20px 14px;
  border-bottom-color: rgba(231, 229, 228, 0.7);
}
.so-theme-viewer .so-c-modal__body { padding: 16px 20px 18px; }
.so-theme-viewer .so-c-modal__foot {
  padding: 14px 20px 18px;
  border-top-color: rgba(231, 229, 228, 0.7);
  gap: 10px;
}
.so-theme-viewer .so-c-btn--primary {
  --soc-btn-shadow: 0 2px 10px color-mix(in srgb, var(--color-primary) 28%, transparent);
}
.so-theme-viewer .so-c-btn--primary:not(:disabled):hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
}
.so-theme-viewer .so-c-btn--secondary:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.85);
}
.so-c-modal-overlay.so-theme-viewer {
  -webkit-backdrop-filter: var(--soc-overlay-blur);
}
`;
