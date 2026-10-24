// Structure-aware chunking for the knowledge corpus. A chunk is the unit we search and
// cite, so it carries a locator (the nearest heading / slide / sheet) a reader can find.

export interface Chunk {
  ord: number;
  locator: string;
  text: string;
  /** Sub-page path of a multi-page artifact (null/absent = its home page or a file). */
  page?: string | null;
  /** Heading id to deep-link to (`?section=`), when the source has one. */
  anchor?: string | null;
}

import { headingAnchors } from '../../serve/heading-anchors';

const MAX_CHARS = 1500;
// ponytail: ~3MB of text per source; a bigger file is truncated, not rejected.
export const MAX_CHUNKS = 2000;

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;

// A spreadsheet's markdown pads every row to the widest cell and keeps every empty
// column: most of its text is blanks. Keep only the cells that say something.
function compactTableRow(line: string): string | null {
  if (!line.startsWith('|')) return line;
  const cells = line.split('|').map((c) => c.trim()).filter((c) => c && !/^:?-+:?$/.test(c));
  return cells.length ? `| ${cells.join(' | ')} |` : null;
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let locator = '';
  // Each heading's `h-` section anchor: the SAME function (and numbering across every heading) the markdown
  // viewer uses for its ids, so a citation's ?section= scrolls to it.
  const lines = markdown.replace(/\r\n/g, '\n');
  const anchors = headingAnchors([...lines.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((m) => m[1]));
  let headingsSeen = 0;
  let anchor: string | null = null;
  let buf: string[] = [];
  let size = 0;

  const flush = () => {
    const text = buf.join('\n\n').trim();
    if (text && chunks.length < MAX_CHUNKS) chunks.push({ ord: chunks.length, locator, text, ...(anchor ? { anchor } : {}) });
    buf = [];
    size = 0;
  };

  for (const block of markdown.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const para = block.split('\n').map((l) => compactTableRow(l.trim())).filter((l) => l !== null).join('\n').trim();
    if (!para) continue;
    const paraLines = para.split('\n');
    const heading = HEADING.exec(paraLines[0]);
    if (heading) {
      flush();
      locator = heading[1].slice(0, 120);
      anchor = anchors[headingsSeen] || null;
    }
    headingsSeen += paraLines.filter((l) => HEADING.test(l)).length;
    for (let i = 0; i < para.length; i += MAX_CHARS) {
      const piece = para.slice(i, i + MAX_CHARS);
      if (size + piece.length > MAX_CHARS) flush();
      buf.push(piece);
      size += piece.length;
    }
  }
  flush();
  return chunks;
}
