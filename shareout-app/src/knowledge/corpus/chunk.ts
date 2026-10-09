// Structure-aware chunking for the knowledge corpus. A chunk is the unit we search and
// cite, so it carries a locator (the nearest heading / slide / sheet) a reader can find.

export interface Chunk {
  ord: number;
  locator: string;
  text: string;
}

const MAX_CHARS = 1500;
// ponytail: ~3MB of text per source; a bigger file is truncated, not rejected.
export const MAX_CHUNKS = 2000;

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;

export function chunkMarkdown(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let locator = '';
  let buf: string[] = [];
  let size = 0;

  const flush = () => {
    const text = buf.join('\n\n').trim();
    if (text && chunks.length < MAX_CHUNKS) chunks.push({ ord: chunks.length, locator, text });
    buf = [];
    size = 0;
  };

  for (const block of markdown.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const para = block.trim();
    if (!para) continue;
    const heading = HEADING.exec(para.split('\n')[0]);
    if (heading) {
      flush();
      locator = heading[1].slice(0, 120);
    }
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
