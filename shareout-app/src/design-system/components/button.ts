/**
 * Shared Button component.
 * `buttonClasses` is the CSS (consumes --color-* custom properties, so it works
 * in any context that ships base CSS variables — see componentStylesheet()).
 * `button()` renders server-side markup; client scripts emit the same classes.
 */

export const buttonClasses = `
.so-c-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--soc-btn-pad, 8px 14px);
  border-radius: var(--soc-btn-radius, var(--radius-sm));
  border: 1px solid transparent;
  background: transparent;
  font: inherit;
  font-size: var(--soc-btn-font, inherit);
  font-weight: 600;
  line-height: 1.2;
  box-shadow: var(--soc-btn-shadow, none);
  cursor: pointer;
  text-decoration: none;
  transition: background var(--duration-normal) var(--ease-out),
              border-color var(--duration-normal) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}
.so-c-btn:disabled { opacity: 0.55; cursor: default; }
.so-c-btn--primary {
  background: var(--soc-primary-bg, var(--color-primary));
  color: var(--color-text-inverse);
  border-color: var(--soc-primary-bg, var(--color-primary));
}
.so-c-btn--primary:not(:disabled):hover {
  background: var(--soc-primary-hover, var(--color-primary-hover));
  border-color: var(--soc-primary-hover, var(--color-primary-hover));
}
.so-c-btn--secondary {
  background: var(--soc-secondary-bg, var(--color-surface));
  color: var(--color-text);
  border-color: var(--soc-secondary-border, var(--color-border));
}
.so-c-btn--secondary:not(:disabled):hover { border-color: var(--color-border-strong); }
.so-c-btn--ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
.so-c-btn--ghost:not(:disabled):hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.so-c-btn--danger {
  background: var(--color-error);
  color: var(--color-text-inverse);
  border-color: var(--color-error);
}
.so-c-btn--danger-outline {
  background: var(--soc-secondary-bg, var(--color-surface));
  color: var(--color-error);
  border-color: var(--color-error);
}
.so-c-btn--danger-outline:not(:disabled):hover { background: var(--color-error-light); }
.so-c-btn--sm { padding: 4px 9px; font-size: 12px; }
.so-c-btn--icon {
  width: var(--touch-target-min);
  height: var(--touch-target-min);
  padding: 0;
  color: var(--color-text-secondary);
}
.so-c-btn--icon:not(:disabled):hover { background: var(--color-surface); color: var(--color-text); }
.so-c-btn--block { width: 100%; }
`;

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  type?: 'button' | 'submit';
  onclick?: string;
  id?: string;
  icon?: string;
  block?: boolean;
  disabled?: boolean;
}

export function button(opts: ButtonOptions): string {
  const variant = opts.variant ?? 'primary';
  const cls = ['so-c-btn', `so-c-btn--${variant}`];
  if (opts.block) cls.push('so-c-btn--block');
  const attrs = [
    `type="${opts.type ?? 'button'}"`,
    `class="${cls.join(' ')}"`,
    opts.id ? `id="${opts.id}"` : '',
    opts.onclick ? `onclick="${opts.onclick}"` : '',
    opts.disabled ? 'disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<button ${attrs}>${opts.icon ?? ''}${opts.label}</button>`;
}
