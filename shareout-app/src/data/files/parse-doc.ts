// Legacy binary Word (.doc, Word 97–2003) → plain text, in-Worker. The file is a CFB
// (OLE2) container, opened with SheetJS's CFB reader (already bundled for .xls). The
// text is read through the document's piece table ([MS-DOC] Clx/PlcPcd): each piece is
// either 8-bit (Windows-1252) or UTF-16LE. Every story is read in CP order (main body,
// footnotes, headers/footers, annotations, endnotes, text boxes) — no styles or images —
// and field codes are dropped, keeping what they display.
import * as XLSX from 'xlsx';

export const DOC_MAX_INPUT_BYTES = 8_000_000;
const MAX_CHARS = 2_000_000;
const MAX_PIECES = 100_000;

export class DocReadError extends Error {}

// Windows-1252 0x80–0x9F; everything else in an 8-bit piece maps to the same code point.
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

type CfbEntry = { content?: ArrayLike<number> };

function stream(cfb: unknown, name: string): Uint8Array | null {
  const e = XLSX.CFB.find(cfb, name) as CfbEntry | null;
  if (!e?.content || !e.content.length) return null;
  return e.content instanceof Uint8Array ? e.content : Uint8Array.from(e.content);
}

function pieceText(word: Uint8Array, fc: number, compressed: boolean, chars: number): string {
  const out: string[] = [];
  if (compressed) {
    const start = fc / 2;
    if (start + chars > word.length) throw new DocReadError('This .doc file is damaged.');
    for (let i = 0; i < chars; i += 8192) {
      const codes: number[] = [];
      for (let j = i; j < Math.min(chars, i + 8192); j++) {
        const b = word[start + j];
        codes.push(b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : b);
      }
      out.push(String.fromCharCode(...codes));
    }
  } else {
    if (fc + chars * 2 > word.length) throw new DocReadError('This .doc file is damaged.');
    for (let i = 0; i < chars; i += 8192) {
      const codes: number[] = [];
      for (let j = i; j < Math.min(chars, i + 8192); j++) codes.push(word[fc + j * 2] | (word[fc + j * 2 + 1] << 8));
      out.push(String.fromCharCode(...codes));
    }
  }
  return out.join('');
}

/** Field codes (0x13 begin, 0x14 separator, 0x15 end) → only the displayed result. */
function dropFieldCodes(s: string): string {
  if (!s.includes('\x13')) return s;
  let out = '';
  const stack: boolean[] = [];
  for (const ch of s) {
    if (ch === '\x13') stack.push(false);
    else if (ch === '\x14') { if (stack.length) stack[stack.length - 1] = true; }
    else if (ch === '\x15') stack.pop();
    else if (stack.every((shown) => shown)) out += ch;
  }
  return out;
}

/* eslint-disable no-control-regex -- .doc text uses control characters as structure marks */
function clean(raw: string): string {
  return dropFieldCodes(raw)
    .replace(/\x07\x07/g, '\n') // end of a table row (cell mark + row mark)
    .replace(/\x07/g, '\t') // end of a table cell
    .replace(/[\r\x0b\x0c\x0e]/g, '\n') // paragraph, line, page/section, column breaks
    .replace(/\x1e/g, '-')
    .replace(/\xa0/g, ' ')
    .replace(/[\x00-\x08\x1f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/* eslint-enable no-control-regex */

export const DOC_IMAGES_ONLY = 'Document has no extractable text (images/drawings only)';

// fibRgLw slots of each story's CP count, in the order the stories follow each other in
// CP space: ccpText, ccpFtn, ccpHdd, ccpMcr, ccpAtn, ccpEdn, ccpTxbx, ccpHdrTxbx.
const STORIES = [
  { slot: 3, header: false }, { slot: 4, header: false }, { slot: 5, header: true }, { slot: 6, header: false },
  { slot: 7, header: false }, { slot: 8, header: false }, { slot: 9, header: false }, { slot: 10, header: true },
];

/** The text of a Word 97–2003 .doc, all stories, blank-line separated. Throws DocReadError with a reader-facing message. */
export function docToText(bytes: Uint8Array): string {
  try { return readDoc(bytes); } catch (e) {
    // Out-of-range reads on a truncated / crafted file surface as RangeError.
    throw e instanceof DocReadError ? e : new DocReadError('This .doc file is damaged.');
  }
}

function readDoc(bytes: Uint8Array): string {
  if (bytes.byteLength > DOC_MAX_INPUT_BYTES) {
    throw new DocReadError(`.doc files up to ${DOC_MAX_INPUT_BYTES / 1_000_000} MB can be read. Save it as .docx and try again.`);
  }
  let cfb: unknown;
  try { cfb = XLSX.CFB.read(bytes, { type: 'array' }); } catch {
    throw new DocReadError('This .doc file could not be opened.');
  }
  const word = stream(cfb, 'WordDocument');
  if (!word || word.length < 0x200) throw new DocReadError('This file is not a Word .doc document.');
  const dv = new DataView(word.buffer, word.byteOffset, word.byteLength);
  if (dv.getUint16(0, true) !== 0xa5ec) throw new DocReadError('This file is not a Word .doc document.');
  if (dv.getUint16(2, true) < 0xc0) throw new DocReadError('Word 6/95 .doc files can’t be read. Save it as .docx and try again.');
  const flags = dv.getUint16(0x0a, true);
  if (flags & 0x0100) throw new DocReadError('This .doc file is password-protected.');

  // FIB: FibBase (32 B) · csw + fibRgW · cslw + fibRgLw · cbRgFcLcb + fibRgFcLcb pairs.
  const csw = dv.getUint16(32, true);
  const lwAt = 34 + csw * 2;
  const cslw = dv.getUint16(lwAt, true);
  const ccps = STORIES.map((st) => (st.slot < cslw ? Math.max(dv.getInt32(lwAt + 2 + st.slot * 4, true), 0) : 0));
  const fcLcbAt = lwAt + 2 + cslw * 4;
  const cbRgFcLcb = dv.getUint16(fcLcbAt, true);
  const clxAt = fcLcbAt + 2 + 33 * 8; // fcClx / lcbClx
  if (cbRgFcLcb <= 33 || clxAt + 8 > word.length) throw new DocReadError('This .doc file is damaged.');
  const fcClx = dv.getUint32(clxAt, true);
  const lcbClx = dv.getUint32(clxAt + 4, true);

  const table = stream(cfb, flags & 0x0200 ? '1Table' : '0Table');
  if (!table || !lcbClx || fcClx + lcbClx > table.length) throw new DocReadError('This .doc file is damaged.');
  const tv = new DataView(table.buffer, table.byteOffset + fcClx, lcbClx);

  // Clx: any number of Prc (0x01, cbGrpprl, grpprl) then one Pcdt (0x02, lcb, PlcPcd).
  let p = 0;
  while (p < lcbClx && tv.getUint8(p) === 0x01) {
    const cb = tv.getInt16(p + 1, true);
    if (cb < 0) throw new DocReadError('This .doc file is damaged.');
    p += 3 + cb;
  }
  if (p + 5 > lcbClx || tv.getUint8(p) !== 0x02) throw new DocReadError('This .doc file is damaged.');
  const lcb = tv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = (lcb - 4) / 12;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PIECES || plc + lcb > lcbClx) throw new DocReadError('This .doc file is damaged.');

  const limit = Math.min(ccps.reduce((a, b) => a + b, 0), MAX_CHARS);
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; i < n && total < limit; i++) {
    const cpStart = tv.getUint32(plc + i * 4, true);
    const cpEnd = tv.getUint32(plc + (i + 1) * 4, true);
    if (cpEnd <= cpStart) continue;
    const chars = Math.min(cpEnd - cpStart, limit - total);
    const pcd = plc + (n + 1) * 4 + i * 8;
    const raw = tv.getUint32(pcd + 2, true);
    const compressed = (raw & 0x40000000) !== 0;
    parts.push(pieceText(word, raw & 0x3fffffff, compressed, chars));
    total += chars;
  }
  const all = parts.join('');
  const stories: string[] = [];
  let body = false;
  for (let i = 0, cp = 0; i < STORIES.length && cp < all.length; cp += ccps[i++]) {
    const text = clean(all.slice(cp, cp + ccps[i]));
    if (!text) continue;
    stories.push(text);
    if (!STORIES[i].header) body = true;
  }
  // Body empty but anchors for pictures (0x01) or drawn objects (0x08): say why.
  // eslint-disable-next-line no-control-regex
  if (!body && /[\x01\x08]/.test(all)) throw new DocReadError(DOC_IMAGES_ONLY);
  return stories.join('\n\n');
}

/** Paragraphs as Markdown (blank-line separated); table cells joined with " | ". */
export function docToMarkdown(bytes: Uint8Array): string {
  return docToText(bytes)
    .split('\n')
    .map((l) => l.replace(/\t+$/, '').replace(/\t/g, ' | ').trim())
    .filter(Boolean)
    .join('\n\n');
}
