import { parseMarkdown } from '../../viewers/markdown-viewer';

/** Neutralize the XSS vectors that matter when trusted-but-not-trusted markdown is
 *  rendered directly into the app shell (not a sandboxed artifact iframe): raw script/
 *  style/embed tags, inline event handlers, and javascript:/vbscript:/non-image data:
 *  URLs. Folder READMEs are authored by folder managers, but on a Team Space that still
 *  means one admin could target members — so we sanitize rather than trust. */
export function sanitizeShellHtml(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|form|link|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/((?:href|src)\s*=\s*)(["'])\s*(?:javascript|vbscript|data)\s*:(?!image\/)[^"']*\2/gi, '$1$2#$2');
}

/** Render a folder README to sanitized HTML for the app shell. Empty/whitespace → ''. */
export function renderFolderReadme(readme: string | null | undefined): string {
  const md = (readme || '').trim();
  if (!md) return '';
  return sanitizeShellHtml(parseMarkdown(md));
}
