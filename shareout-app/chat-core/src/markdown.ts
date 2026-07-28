import { escapeHtml } from './util';

/**
 * Minimal, safe inline markdown → HTML for chat replies. Escapes first, then
 * applies a small whitelist: `code`, **bold**, *italic*, [text](http…) links,
 * and newlines. No raw HTML survives (everything is escaped up front), and only
 * http(s) links are produced. Deliberately tiny — not a full markdown engine.
 */
export function renderMarkdown(src: string): string {
  let s = escapeHtml(src);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // [text](https://url) — url chars are already escaped; allow the safe set.
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  s = s.replace(/\n/g, '<br>');
  return s;
}
