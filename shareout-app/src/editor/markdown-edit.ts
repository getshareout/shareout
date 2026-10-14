// Studio inline editing for Markdown artifacts (server half).
//
// The source is cut into blocks (runs of lines between blank lines; a fenced code block
// stays whole). Each block is rendered with the viewer's own parser, so the edit surface
// looks like the published page. The client keeps every block it did not change
// byte-for-byte and re-serializes only edited blocks (client-script/md-edit.ts).

import { parseMarkdown, MARKDOWN_VIEWER_STYLES } from '../viewers/markdown-viewer';
import { viewerBaseStyles } from '../viewers/viewer-shell';
import { googleFontsPreconnect } from '../../packages/design-tokens/src/index';

export interface MarkdownBlock {
  src: string;
  /** Exact text between this block and the next (or the end of the file). */
  sep: string;
  /** Rendered HTML; empty for front matter, which the viewer hides. */
  html: string;
  hidden?: boolean;
}

export interface MarkdownEditPayload {
  lead: string;
  blocks: MarkdownBlock[];
  /** Nested-list indent the document already uses, so edited lists keep its style. */
  indent: string;
}

const BLANK = /^[ \t]*\r?$/;
const FENCE = /^[ \t]*```/;
const LIST_INDENT = /^([ \t]+)(?:[-*+]|\d+\.)[ \t]/;

export function splitMarkdownBlocks(md: string): { lead: string; blocks: Array<{ src: string; sep: string; hidden?: boolean }> } {
  const lines = md.split('\n');
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  const startOf = (k: number) => (k < lines.length ? starts[k] : md.length);
  const endOf = (k: number) => starts[k] + lines[k].length;

  const spans: Array<{ a: number; b: number; hidden?: boolean }> = [];
  let i = 0;
  while (i < lines.length && BLANK.test(lines[i])) i++;
  if (i === 0 && lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) { spans.push({ a: 0, b: close, hidden: true }); i = close + 1; }
  }
  while (i < lines.length) {
    if (BLANK.test(lines[i])) { i++; continue; }
    const a = i;
    let fence = false;
    for (; i < lines.length; i++) {
      if (FENCE.test(lines[i])) fence = !fence;
      else if (!fence && BLANK.test(lines[i])) break;
    }
    spans.push({ a, b: i - 1 });
  }

  const blocks = spans.map((s, n) => ({
    src: md.slice(startOf(s.a), endOf(s.b)),
    sep: md.slice(endOf(s.b), n + 1 < spans.length ? startOf(spans[n + 1].a) : md.length),
    ...(s.hidden ? { hidden: true } : {}),
  }));
  return { lead: spans.length ? md.slice(0, startOf(spans[0].a)) : md, blocks };
}

function detectIndent(md: string): string {
  let best = '';
  for (const line of md.split('\n')) {
    const m = LIST_INDENT.exec(line);
    if (m && (!best || m[1].length < best.length)) best = m[1];
  }
  return best || '  ';
}

export function markdownEditPayload(md: string): MarkdownEditPayload {
  const { lead, blocks } = splitMarkdownBlocks(md);
  return {
    lead,
    indent: detectIndent(md),
    // Leading newline: a mid-document block that opens with --- is never front matter.
    blocks: blocks.map((b) => ({ ...b, html: b.hidden ? '' : parseMarkdown('\n' + b.src + '\n').trim() })),
  };
}

/** The edit iframe's document: the viewer's look with an empty article the client fills. */
export function markdownEditShell(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${googleFontsPreconnect}<style>${viewerBaseStyles()}
    body { padding: 20px; height: auto; min-height: 100%; }
    ${MARKDOWN_VIEWER_STYLES}</style></head><body><div class="markdown-viewer"><div class="layout"><article class="content" data-md-root></article></div></div></body></html>`;
}

/** A draft saved by the old HTML-only Edit-Lite (or the AI) is not Markdown: ignore it. */
export function isHtmlDocument(text: string): boolean {
  return /^\s*<!DOCTYPE html|^\s*<html[\s>]/i.test(text);
}
