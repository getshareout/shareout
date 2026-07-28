/**
 * Format editor — reads/writes `data-shareout-format` for a bound value, powering the
 * Format section of the Inspect panel (number / currency / percent / date). The format
 * string syntax mirrors the runtime parser (`parseFormat`):
 *   number[:decimals] | currency[:CODE] | percent[:decimals] | date[:style]
 */

export interface FormatState {
  type: string;
  detail: string;
}

/** Selectable format types, as [value, label] pairs. Empty value = plain text (no format). */
export const FORMAT_TYPES: Array<[string, string]> = [
  ['', 'Plain text'],
  ['number', 'Number'],
  ['currency', 'Currency'],
  ['percent', 'Percent'],
  ['date', 'Date'],
];

/** The second segment of the format string — its meaning + hint per type. */
export const FORMAT_DETAIL: Record<string, { label: string; placeholder: string }> = {
  number: { label: 'Decimals', placeholder: '0' },
  percent: { label: 'Decimals', placeholder: '1' },
  currency: { label: 'Code', placeholder: 'USD' },
  date: { label: 'Style', placeholder: 'short' },
};

export function readFormat(element: Element): FormatState {
  const parts = (element.getAttribute('data-shareout-format') || '').split(':');
  return { type: parts[0] || '', detail: parts[1] || '' };
}

/** Compose a format string, or null when there is no format (plain text). */
export function composeFormat(type: string, detail: string): string | null {
  if (!type) return null;
  const d = detail.trim();
  return d ? `${type}:${d}` : type;
}

export function applyFormat(element: Element, type: string, detail: string): void {
  const value = composeFormat(type, detail);
  if (value) element.setAttribute('data-shareout-format', value);
  else element.removeAttribute('data-shareout-format');
}
