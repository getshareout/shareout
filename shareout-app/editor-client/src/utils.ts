/** Convert `rgb(r, g, b)` to `#rrggbb` for color inputs. */
export function rgbToHex(rgb: string | null | undefined): string {
  if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') {
    return '#ffffff';
  }
  const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!match) return '#000000';
  return (
    '#' +
    [match[1], match[2], match[3]]
      .map((x) => {
        const hex = parseInt(x, 10).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
}

/** Escape text for safe HTML insertion. Escapes quotes too, so it is also safe inside single-
 *  or double-quoted attributes (the DOM-based version this replaced left quotes raw — EDIT-10
 *  F4 / EDIT-09 F22). Null-safe. */
export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
