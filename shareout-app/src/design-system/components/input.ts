/**
 * Shared form Field component (label + control + optional hint).
 * Classes consume --color-* custom properties; `field()` renders server markup.
 */

export const inputClasses = `
.so-c-field { margin: 0 0 2px; }
.so-c-label {
  display: block;
  font-size: var(--soc-label-font, 0.72rem);
  font-weight: var(--soc-label-weight, 600);
  text-transform: uppercase;
  letter-spacing: var(--soc-label-spacing, 0.03em);
  color: var(--soc-label-color, var(--color-text-secondary));
  margin: 0.6rem 0 0.2rem;
}
.so-c-input,
.so-c-select,
.so-c-textarea {
  width: 100%;
  padding: var(--soc-input-pad, 8px 10px);
  border: 1px solid var(--soc-input-border, var(--color-border));
  border-radius: var(--soc-input-radius, var(--radius-sm));
  background: var(--soc-input-bg, var(--color-bg-elevated));
  color: var(--color-text);
  font: inherit;
  font-size: var(--soc-input-font, 0.85rem);
  box-sizing: border-box;
  transition: border-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}
.so-c-textarea { resize: vertical; min-height: 60px; }
.so-c-input:focus,
.so-c-select:focus,
.so-c-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--soc-focus-ring, var(--color-primary-light));
  background: var(--soc-input-bg-focus, var(--soc-input-bg, var(--color-bg-elevated)));
}
.so-c-input--error { border-color: var(--color-error); }
.so-c-hint {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}
.so-c-error {
  min-height: 1.1rem;
  margin-top: 0.4rem;
  font-size: 0.78rem;
  color: var(--color-error);
}
`;

export interface FieldOptions {
  id: string;
  label: string;
  control: string;
  hint?: string;
}

export function field(opts: FieldOptions): string {
  return `<div class="so-c-field"><label class="so-c-label" for="${opts.id}">${opts.label}</label>${opts.control}${opts.hint ? `<span class="so-c-hint">${opts.hint}</span>` : ''}</div>`;
}
