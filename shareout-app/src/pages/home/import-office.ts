/**
 * Office files → artifacts on import (POST /v1/home/import).
 *
 * Word (.docx) → Markdown, converted in-Worker (headings, paragraphs, bold/italic/strike,
 * links, bullet + numbered lists, tables, images kept as artifact assets). .odt goes
 * through Workers AI toMarkdown (text only, no images) when the instance has AI. Legacy
 * Word (.doc) → plain paragraphs, read in-Worker (data/files/parse-doc.ts; text only).
 * Spreadsheets (.xlsx/.xls/.ods) → one CSV per sheet via SheetJS. The original file is
 * always stored next to the result so the viewer can offer it for download.
 */
import { ZipTooLargeError, assertZipWithinBounds, unzipBounded } from '../../data/files/unzip-bounded';
import * as XLSX from 'xlsx';
import type { ArtifactType, Env, FileEntry, ImportedSource } from '../../types';
import { XLSX_MAX_INPUT_BYTES } from '../../data/files/parse-xlsx';
import { DocReadError, docToMarkdown } from '../../data/files/parse-doc';
import { transcribePdf } from '../../data/files/transcribe-pdf';

export class ImportError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); }
}

export interface ConvertedImport {
  entrypoint: string;
  files: FileEntry[];
  source?: ImportedSource;
  /** Set when the result type depends on the file (a PDF with no readable text stays a PDF). */
  type?: ArtifactType;
}

/** Each sheet becomes a CSV: past this many rows a workbook is too big to view here. */
export const MAX_SHEET_ROWS = 100_000;

const OFFICE_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation',
};
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** A path segment that stays readable but never escapes its folder. */
export function safeSegment(name: string, fallback: string): string {
  const s = name.normalize('NFC').replace(/[^\p{L}\p{N}_. -]+/gu, '-').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 80);
  return s || fallback;
}

export function originalFile(filename: string, ext: string, bytes: Uint8Array): FileEntry {
  return { path: `original/${safeSegment(filename, `original.${ext}`)}`, content: bytesToBase64(bytes), mime: OFFICE_MIME[ext], encoding: 'base64' };
}

// ---------------------------------------------------------------- Word (.docx)

function xmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlText(m[1]) : null;
}

/** Top-level children <w:p>/<w:tbl> of an XML fragment, with nesting respected. */
function topElements(xml: string, tags: string[]): Array<{ tag: string; xml: string }> {
  const out: Array<{ tag: string; xml: string }> = [];
  const open = new RegExp(`<(${tags.join('|')})(?=[\\s>/])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const tag = m[1];
    const start = m.index;
    const headEnd = xml.indexOf('>', start);
    if (xml[headEnd - 1] === '/') { out.push({ tag, xml: xml.slice(start, headEnd + 1) }); open.lastIndex = headEnd + 1; continue; }
    const scan = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'g');
    scan.lastIndex = start;
    let depth = 0, end = xml.length;
    let s: RegExpExecArray | null;
    while ((s = scan.exec(xml))) {
      if (s[2] === '/') continue;
      depth += s[1] ? -1 : 1;
      if (!depth) { end = scan.lastIndex; break; }
    }
    out.push({ tag, xml: xml.slice(start, end) });
    open.lastIndex = end;
  }
  return out;
}

interface DocxContext {
  rels: Record<string, string>;
  headingByStyle: Record<string, number>;
  orderedByNum: Record<string, Record<string, boolean>>;
  media: Map<string, FileEntry>;
  files: Record<string, Uint8Array>;
  counters: Record<string, number>;
}

function parseRels(xml: string): Record<string, string> {
  const rels: Record<string, string> = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
    if (id && target) rels[id] = target;
  }
  return rels;
}

function parseHeadingStyles(xml: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of xml.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const id = attr(m[0].slice(0, m[0].indexOf('>') + 1), 'w:styleId');
    const name = (/<w:name w:val="([^"]*)"/.exec(m[0])?.[1] || '').toLowerCase();
    const level = /^heading ([1-6])$/.exec(name)?.[1] ?? (name === 'title' ? '1' : null);
    if (id && level) out[id] = Number(level);
  }
  return out;
}

function parseNumbering(xml: string): Record<string, Record<string, boolean>> {
  const abstract: Record<string, Record<string, boolean>> = {};
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const lvls: Record<string, boolean> = {};
    for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const fmt = /<w:numFmt w:val="([^"]*)"/.exec(l[2])?.[1] || 'bullet';
      lvls[l[1]] = fmt !== 'bullet' && fmt !== 'none';
    }
    abstract[m[1]] = lvls;
  }
  const out: Record<string, Record<string, boolean>> = {};
  for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const a = /<w:abstractNumId w:val="(\d+)"/.exec(m[2])?.[1];
    if (a && abstract[a]) out[m[1]] = abstract[a];
  }
  return out;
}

function on(rPr: string, tag: string): boolean {
  const m = new RegExp(`<w:${tag}(?=[\\s/>])([^>]*)/?>`).exec(rPr);
  return !!m && !/w:val="(0|false|none)"/.test(m[1]);
}

interface Seg { text: string; b: boolean; i: boolean; s: boolean; href: string | null }

function wrap(seg: Seg): string {
  const core = seg.text.trim();
  if (!core) return seg.text;
  const lead = seg.text.slice(0, seg.text.indexOf(core[0]));
  const trail = seg.text.slice(seg.text.lastIndexOf(core[core.length - 1]) + 1);
  let t = core;
  if (seg.s) t = `~~${t}~~`;
  if (seg.i) t = `*${t}*`;
  if (seg.b) t = `**${t}**`;
  if (seg.href) t = `[${t}](${seg.href})`;
  return lead + t + trail;
}

function imageFor(ctx: DocxContext, runXml: string): string {
  const id = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(runXml)?.[1];
  const target = id && ctx.rels[id];
  if (!target) return '';
  const zipPath = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
  const ext = zipPath.split('.').pop()!.toLowerCase();
  const bytes = ctx.files[zipPath];
  if (!bytes || !IMAGE_MIME[ext]) return ''; // EMF/WMF etc. don't render on the web
  const path = `media/${safeSegment(zipPath.split('/').pop()!, `image.${ext}`)}`;
  if (!ctx.media.has(path)) ctx.media.set(path, { path, content: bytesToBase64(bytes), mime: IMAGE_MIME[ext], encoding: 'base64' });
  const alt = (/<wp:docPr\b[^>]*\bdescr="([^"]*)"/.exec(runXml)?.[1] ?? '').replace(/[[\]\n]/g, ' ');
  return `![${xmlText(alt)}](${path})`;
}

function paragraphInline(ctx: DocxContext, pXml: string, breaks: string): string {
  const segs: Seg[] = [];
  let out = '';
  const flush = () => {
    const merged: Seg[] = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && last.b === s.b && last.i === s.i && last.s === s.s && last.href === s.href) last.text += s.text;
      else merged.push({ ...s });
    }
    out += merged.map(wrap).join('');
    segs.length = 0;
  };
  const items = pXml.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g);
  for (const m of items) {
    const runs = m[2] !== undefined ? [...m[2].matchAll(/<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => r[1]) : [m[3]];
    const rid = m[1] !== undefined ? /r:id="([^"]+)"/.exec(m[1])?.[1] : undefined;
    const href = rid && /^(https?:|mailto:)/i.test(ctx.rels[rid] || '') ? ctx.rels[rid] : null;
    for (const run of runs) {
      if (/<w:drawing\b|<w:pict\b/.test(run)) { flush(); out += imageFor(ctx, run); continue; }
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] || '';
      let text = '';
      for (const t of run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
        text += t[1] !== undefined ? xmlText(t[1]) : t[2] === 'tab' ? ' ' : breaks;
      }
      if (text) segs.push({ text, b: on(rPr, 'b'), i: on(rPr, 'i'), s: on(rPr, 'strike') || on(rPr, 'dstrike'), href });
    }
  }
  flush();
  return out.replace(/[ \t]+$/gm, '');
}

function tableMarkdown(ctx: DocxContext, tblXml: string): string {
  const rows = topElements(tblXml.slice(tblXml.indexOf('>') + 1), ['w:tr']).map((tr) =>
    topElements(tr.xml.slice(tr.xml.indexOf('>') + 1), ['w:tc']).map((tc) =>
      topElements(tc.xml, ['w:p']).map((p) => paragraphInline(ctx, p.xml, ' ').trim()).filter(Boolean).join(' ').replace(/\|/g, '/') || ' '));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? ' ').join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

export function docxToMarkdown(bytes: Uint8Array): { markdown: string; media: FileEntry[] } {
  let files: Record<string, Uint8Array>;
  try { files = unzipBounded(bytes); } catch (e) {
    if (e instanceof ZipTooLargeError) throw new ImportError('FILE_TOO_LARGE', 'This Word file expands to more than 64 MB and cannot be opened here.', 413);
    throw new ImportError('CONVERT_FAILED', 'This Word file could not be read.');
  }
  const dec = new TextDecoder();
  const doc = files['word/document.xml'];
  if (!doc) throw new ImportError('CONVERT_FAILED', 'This Word file could not be read.');
  const read = (p: string) => (files[p] ? dec.decode(files[p]) : '');
  const ctx: DocxContext = {
    rels: parseRels(read('word/_rels/document.xml.rels')),
    headingByStyle: parseHeadingStyles(read('word/styles.xml')),
    orderedByNum: parseNumbering(read('word/numbering.xml')),
    media: new Map(),
    files,
    counters: {},
  };
  const xml = dec.decode(doc);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? '';
  const blocks: Array<{ text: string; list: boolean }> = [];
  for (const el of topElements(body, ['w:p', 'w:tbl'])) {
    if (el.tag === 'w:tbl') { const t = tableMarkdown(ctx, el.xml); if (t) blocks.push({ text: t, list: false }); continue; }
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(el.xml)?.[1] || '';
    const style = /<w:pStyle w:val="([^"]*)"/.exec(pPr)?.[1] || '';
    const numId = /<w:numId w:val="(\d+)"/.exec(pPr)?.[1];
    const ilvl = /<w:ilvl w:val="(\d+)"/.exec(pPr)?.[1] || '0';
    const heading = ctx.headingByStyle[style] ?? (/^heading([1-6])$/i.exec(style) ? Number(style.slice(-1)) : 0);
    const inline = paragraphInline(ctx, el.xml, heading || numId ? ' ' : '\n').trim();
    if (!inline) continue;
    if (heading) { blocks.push({ text: `${'#'.repeat(heading)} ${inline}`, list: false }); continue; }
    if (numId && numId !== '0') {
      const ordered = !!ctx.orderedByNum[numId]?.[ilvl];
      const key = `${numId}:${ilvl}`;
      // A shallower item restarts the numbering of deeper levels under it.
      for (const k of Object.keys(ctx.counters)) if (k.startsWith(`${numId}:`) && Number(k.split(':')[1]) > Number(ilvl)) delete ctx.counters[k];
      ctx.counters[key] = (ctx.counters[key] || 0) + 1;
      blocks.push({ text: `${'  '.repeat(Number(ilvl))}${ordered ? `${ctx.counters[key]}.` : '-'} ${inline}`, list: true });
      continue;
    }
    blocks.push({ text: inline, list: false });
  }
  const markdown = blocks.map((b, i) => (i && !(b.list && blocks[i - 1].list) ? '\n\n' : i ? '\n' : '') + b.text).join('') + '\n';
  return { markdown, media: [...ctx.media.values()] };
}

// ---------------------------------------------------------------- Spreadsheets

export function workbookToCsvSheets(bytes: Uint8Array): Array<{ name: string; csv: string }> {
  // Same isolate-memory guard as data/files/parse-xlsx.ts and assets/enrich.ts.
  if (bytes.byteLength > XLSX_MAX_INPUT_BYTES) {
    throw new ImportError('SPREADSHEET_TOO_LARGE', `Spreadsheets up to ${XLSX_MAX_INPUT_BYTES / 1_000_000} MB can be opened here. Keep it in Recursos instead.`, 413);
  }
  try { assertZipWithinBounds(bytes); } catch {
    throw new ImportError('SPREADSHEET_TOO_LARGE', 'This spreadsheet expands to more than 64 MB and cannot be opened here.', 413);
  }
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(bytes, { type: 'array', dense: true, sheetRows: MAX_SHEET_ROWS + 1 }); } catch {
    throw new ImportError('CONVERT_FAILED', 'This spreadsheet could not be read.');
  }
  const sheets = wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const ref = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    if (ref && ref.e.r >= MAX_SHEET_ROWS) {
      throw new ImportError('SPREADSHEET_TOO_LARGE', `"${name}" has more than ${MAX_SHEET_ROWS.toLocaleString('en')} rows. Keep it in Recursos instead.`, 413);
    }
    return { name, csv: XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) };
  });
  const filled = sheets.filter((s) => s.csv.trim());
  if (!filled.length) throw new ImportError('CONVERT_FAILED', 'This spreadsheet is empty.');
  return filled;
}

// ---------------------------------------------------------------- Entry point

export async function convertOfficeImport(
  env: Env,
  filename: string,
  ext: string,
  kind: 'word' | 'sheet',
  bytes: Uint8Array,
): Promise<ConvertedImport> {
  const original = originalFile(filename, ext, bytes);
  const base = safeSegment(filename.replace(/\.[^.]+$/, ''), 'document');
  if (kind === 'sheet') {
    const sheets = workbookToCsvSheets(bytes);
    const files = sheets.map((s, i) => ({
      path: `sheets/${String(i + 1).padStart(2, '0')}-${safeSegment(s.name, `sheet-${i + 1}`)}.csv`,
      content: s.csv,
      mime: 'text/csv',
    }));
    return {
      entrypoint: files[0].path,
      files: [...files, original],
      source: { original: original.path, sheets: sheets.map((s, i) => ({ name: s.name, path: files[i].path })) },
    };
  }
  let markdown: string;
  let media: FileEntry[] = [];
  if (ext === 'docx') ({ markdown, media } = docxToMarkdown(bytes));
  else if (ext === 'doc') {
    try { markdown = docToMarkdown(bytes); } catch (e) {
      if (e instanceof DocReadError) throw new ImportError('CONVERT_FAILED', e.message);
      throw e;
    }
  }
  else {
    if (!env.AI) throw new ImportError('CONVERT_UNAVAILABLE', 'This server can’t convert .odt files. Save it as .docx and try again.');
    const res = await env.AI.toMarkdown({ name: filename, blob: new Blob([bytes], { type: OFFICE_MIME[ext] }) });
    if (res.format !== 'markdown' || !res.data.trim()) throw new ImportError('CONVERT_FAILED', 'This document could not be read.');
    markdown = res.data;
  }
  if (!markdown.trim()) throw new ImportError('CONVERT_FAILED', 'This document has no text.');
  const entrypoint = `${base}.md`;
  return { entrypoint, files: [{ path: entrypoint, content: markdown, mime: 'text/markdown' }, ...media, original], source: { original: original.path } };
}

// toMarkdown on a scan returns little more than page markers and stray bullets: below
// this many letters, transcribe.
const PDF_MIN_LETTERS = 200;

/** toMarkdown's PDF output minus its `# file` / `## Metadata` header and `### Page N` markers. */
export function pdfMarkdownBody(md: string): string {
  const i = md.indexOf('## Contents');
  const body = i >= 0 ? md.slice(i + '## Contents'.length) : md;
  return body.replace(/^#{1,3} Page \d+\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * PDF → an editable Markdown page with the original kept for download: Workers AI
 * toMarkdown for a PDF with a text layer, a vision-model transcription for a scan. When
 * neither yields text (no AI configured, too big, model failed) it stays a PDF artifact,
 * so an upload is never lost.
 */
export async function convertPdfImport(env: Env, filename: string, bytes: Uint8Array): Promise<ConvertedImport> {
  const base64 = bytesToBase64(bytes);
  let markdown = '';
  if (env.AI) {
    const res = await env.AI.toMarkdown({ name: filename, blob: new Blob([bytes], { type: 'application/pdf' }) }).catch(() => null);
    if (res?.format === 'markdown') markdown = pdfMarkdownBody(res.data);
  }
  if ((markdown.match(/\p{L}/gu) || []).length < PDF_MIN_LETTERS) markdown = (await transcribePdf(env, base64)) || markdown;
  const original: FileEntry = { path: `original/${safeSegment(filename, 'original.pdf')}`, content: base64, mime: 'application/pdf', encoding: 'base64' };
  if (!markdown.trim()) {
    const path = safeSegment(filename, 'document.pdf');
    return { entrypoint: path, files: [{ ...original, path }], type: 'pdf' };
  }
  const entrypoint = `${safeSegment(filename.replace(/\.[^.]+$/, ''), 'document')}.md`;
  return { entrypoint, files: [{ path: entrypoint, content: markdown, mime: 'text/markdown' }, original], source: { original: original.path }, type: 'markdown' };
}
