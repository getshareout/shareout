/**
 * Home page styles — Access requests banner (owner inbox on /home)
 * @module design-system/pages/home/access-requests-banner-owner-inbox-on-home
 */

/** CSS rules for: Access requests banner (owner inbox on /home) */
export const accessRequestsBannerOwnerInboxOnHomeStyles = `/* ── Access requests banner (owner inbox on /home) ─ */
.access-req-banner {
  margin: 0 0 var(--space-5);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-xl);
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary-light) 55%, var(--color-bg-elevated));
}

.access-req-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.access-req-title {
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--color-text);
}

.access-req-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: 0.75rem;
  font-weight: 600;
}

.access-req-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.access-req-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
}

.access-req-copy {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
  line-height: 1.45;
}

.access-req-copy strong {
  color: var(--color-text);
}

.access-req-actions {
  display: flex;
  gap: var(--space-2);
}

.access-req-btn {
  min-height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font: 500 0.875rem var(--font-body);
  cursor: pointer;
}

.access-req-approve {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.access-req-approve:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.access-req-deny:hover:not(:disabled) {
  background: var(--color-surface);
}

.access-req-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.toast {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%) translateY(140%);
  display: flex; align-items: center; gap: 0.5rem;
  padding: 12px 18px;
  background: var(--color-text); color: var(--color-text-inverse);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font-size: 0.875rem; font-weight: 600;
  opacity: 0;
  transition: transform var(--duration-slow) cubic-bezier(0.32, 0.72, 0, 1), opacity var(--duration-slow);
  z-index: 1400;
}
.toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
.toast::before {
  content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%;
  background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 22%, transparent);
}
.toast-success { background: var(--color-success-light); color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 45%, transparent); }
.toast-error { background: var(--color-error-light); color: var(--color-error); border-color: color-mix(in srgb, var(--color-error) 45%, transparent); }

`;
