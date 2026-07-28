/**
 * Shared Badge component. Classes consume --color-* custom properties.
 */

export const badgeClasses = `
.so-c-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--soc-badge-pad, 2px 10px);
  border-radius: var(--soc-badge-radius, var(--radius-full));
  font-family: var(--soc-badge-font-family, inherit);
  font-size: var(--soc-badge-font, 0.8rem);
  font-weight: var(--soc-badge-weight, 500);
  line-height: 1.4;
}
.so-c-badge--primary { background: var(--color-primary-light); color: var(--color-primary); }
.so-c-badge--primary-solid { background: var(--color-primary); color: var(--color-text-inverse); }
.so-c-badge--success { background: var(--color-success-light); color: var(--color-success); }
.so-c-badge--warning { background: var(--color-warning-light); color: var(--color-warning); }
.so-c-badge--error { background: var(--color-error-light); color: var(--color-error); }
.so-c-badge--neutral { background: var(--color-surface); color: var(--color-text-secondary); }
`;

export type BadgeVariant = 'primary' | 'primary-solid' | 'success' | 'warning' | 'error' | 'neutral';

export function badge(opts: { label: string; variant?: BadgeVariant }): string {
  return `<span class="so-c-badge so-c-badge--${opts.variant ?? 'neutral'}">${opts.label}</span>`;
}
