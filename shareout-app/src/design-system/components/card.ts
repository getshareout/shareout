/**
 * Shared Card component. Classes consume --color-* custom properties.
 */

export const cardClasses = `
.so-c-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}
.so-c-card__title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.125rem;
  color: var(--color-text);
  margin-bottom: var(--space-3);
}
.so-c-card--interactive {
  cursor: pointer;
  transition: border-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out),
              transform var(--duration-normal) var(--ease-out);
}
.so-c-card--interactive:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
`;

export interface CardOptions {
  body: string;
  title?: string;
  interactive?: boolean;
}

export function card(opts: CardOptions): string {
  const cls = `so-c-card${opts.interactive ? ' so-c-card--interactive' : ''}`;
  const title = opts.title ? `<div class="so-c-card__title">${opts.title}</div>` : '';
  return `<div class="${cls}">${title}${opts.body}</div>`;
}
