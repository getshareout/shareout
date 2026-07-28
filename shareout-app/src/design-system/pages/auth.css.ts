/**
 * ShareOut Design System - Auth Page Styles
 * Shared styles for authentication and simple status pages.
 * Use with baseStyles from shell.ts via renderHtmlPage().
 */

const authComponents = `
/* Centered Page Layout */
body {
  font-family: var(--font-body);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
}

/* Card Container */
.card {
  background: var(--color-bg-elevated);
  padding: 3rem;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border);
  text-align: center;
  max-width: 400px;
  width: 90%;
}

/* Icon Containers */
.icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
  font-size: 1.75rem;
}

.icon-primary {
  background: var(--color-primary-light);
}

.icon-success {
  background: var(--color-success-light);
  color: var(--color-success);
}

.icon-error {
  background: var(--color-error-light);
  color: var(--color-error);
}

/* Typography */
h1 {
  font-family: var(--font-display);
  color: var(--color-text);
  margin-bottom: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
}

h1.error { color: var(--color-error); }

p {
  color: var(--color-text-secondary);
  margin-bottom: 1.5rem;
  font-size: 0.95rem;
  line-height: 1.5;
}

p strong { color: var(--color-text); }

/* Error Alert */
.error-box {
  color: var(--color-error);
  background: var(--color-error-light);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-lg);
  margin-bottom: 1rem;
  font-size: 0.9rem;
  border: 1px solid #fecaca;
}

/* Google OAuth — auth-specific, not a shared primitive */
.btn-google {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: var(--touch-target);
  padding: 0 24px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 1rem;
  font-weight: 500;
  text-decoration: none;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out);
}

.btn-google:hover {
  border-color: var(--color-primary);
  box-shadow: 0 2px 8px rgba(37,99,235,0.15);
}

.btn-google svg {
  width: 20px;
  height: 20px;
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-6) 0;
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.auth-divider::before,
.auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.auth-help {
  margin: 0;
  font-size: 0.9rem;
}

.auth-help--warning {
  color: var(--color-warning);
}

.status {
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.45;
}

.status-success {
  background: var(--color-success-light);
  border-color: var(--color-success);
  color: var(--color-success);
}

.status-error {
  background: var(--color-error-light);
  border-color: var(--color-error);
  color: var(--color-error);
}

[hidden] {
  display: none !important;
}

/* Actions Container */
.actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

/* Form Styles */
form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  text-align: left;
}

.field-label {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 600;
}

input[type="text"],
input[type="email"],
input[type="password"] {
  min-height: var(--touch-target);
  padding: 0 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  font-size: 1rem;
  font-family: inherit;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  transition: border-color var(--duration-normal), box-shadow var(--duration-normal);
}

input[type="text"]:focus,
input[type="email"]:focus,
input[type="password"]:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
}

button[type="submit"].so-c-btn:disabled,
button.so-c-btn:disabled {
  cursor: wait;
  opacity: 0.72;
}

/* Footer */
.footer {
  margin-top: 2rem;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}

.footer a {
  color: var(--color-primary);
  text-decoration: none;
}

.footer a:hover {
  text-decoration: underline;
}

.footer .footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  vertical-align: middle;
  font-weight: 600;
}

.footer .footer-mark {
  width: 16px;
  height: 16px;
  display: block;
}

/* Shared-page sign-in: preview is the hero */
.auth-thumb {
  display: block;
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  object-position: top;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-md);
  margin-bottom: 1.5rem;
}

.share-title {
  font-size: 1.65rem;
  line-height: 1.2;
}

.share-subtitle {
  font-size: 1rem;
}

.share-subtitle strong {
  color: var(--color-text);
  font-weight: 600;
}

.auth-methods {
  max-width: 400px;
  margin: 0 auto;
}

@media (min-width: 720px) {
  .card-share {
    max-width: 640px;
    padding: 3rem 3.5rem;
  }

  .card-share .auth-thumb {
    max-height: 300px;
    margin-bottom: 2rem;
  }

  .card-share .share-title {
    font-size: 2rem;
  }
}

/* Contact Note */
.contact-note {
  font-size: 0.85rem;
  color: var(--color-text-tertiary);
}

/* Private access gate (Google Drive style) */
.card-access {
  max-width: 420px;
}

.access-lock {
  width: 56px;
  height: 56px;
  margin: 0 auto 1.25rem;
  border-radius: 50%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.access-lock svg {
  width: 28px;
  height: 28px;
}

.access-signed-in {
  font-size: 0.9rem;
  margin-bottom: 1.25rem;
}

.actions-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
}

.actions-stack .so-c-btn {
  width: 100%;
}

/* Email Highlight */
.email {
  font-weight: 600;
  color: var(--color-text);
}

/* Large error code (404, etc.) */
.error-code {
  font-family: var(--font-display);
  font-size: 3rem;
  font-weight: 700;
  color: var(--color-text-tertiary);
  margin-bottom: var(--space-4);
  line-height: 1;
}

/* Monospace code block (admin unauthorized instructions) */
code,
.code-block {
  display: block;
  background: var(--color-surface);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  font: 400 14px/1.6 var(--font-mono);
  color: var(--color-text);
  text-align: left;
  word-break: break-all;
  border: 1px solid var(--color-border);
}
`;

export const authPageStyles = authComponents;
