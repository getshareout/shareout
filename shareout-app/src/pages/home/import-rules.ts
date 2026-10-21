/**
 * Where an imported file goes — shared by /v1/home/import and the Studio client (drop,
 * paste, New → Upload, embedded there as JSON), so every path agrees.
 *
 * The rule: everything you upload is an artifact (documents, images, video), with the
 * original kept inside it. Types with no viewer (audio, fonts, archives) are refused.
 */
import type { ArtifactType } from '../../types';

/** Document extensions → the artifact type they become (each has a viewer). */
export const IMPORT_ARTIFACT_EXTS: Record<string, ArtifactType> = {
  html: 'html', htm: 'html', csv: 'csv', md: 'markdown', markdown: 'markdown',
  json: 'json', txt: 'txt', pdf: 'pdf',
  // Office files are converted on import; the original is kept for download.
  docx: 'markdown', doc: 'markdown', odt: 'markdown', xlsx: 'csv', xls: 'csv', ods: 'csv',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video',
};
/** Served as-is: the browser renders them, so the mime must be right. */
export const IMPORT_MEDIA_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
/** Converted on import: Word-like → Markdown, spreadsheets → one CSV per sheet. */
export const IMPORT_CONVERTED_EXTS: Record<string, 'word' | 'sheet'> = {
  docx: 'word', doc: 'word', odt: 'word', xlsx: 'sheet', xls: 'sheet', ods: 'sheet',
};
/**
 * Slide decks become a PDF artifact (LibreOffice in a Container, import-slides.ts). Only
 * where the instance binds SLIDES_CONVERTER: the client routes them here when
 * window.WSX_SLIDES is set; elsewhere they are refused.
 */
export const IMPORT_SLIDES_EXTS = ['pptx', 'ppt', 'odp'];
/** Sent as base64 by the client (binary formats). */
export const IMPORT_BINARY_EXTS = ['pdf', 'docx', 'doc', 'odt', 'xlsx', 'xls', 'ods', ...IMPORT_SLIDES_EXTS,
  ...Object.keys(IMPORT_MEDIA_MIME).filter((e) => e !== 'svg')];
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
/** Share links we try to fetch once (no per-vendor scraping). Subdomains match too. */
export const IMPORT_SHARE_HOSTS = ['claude.ai', 'claude.site', 'chatgpt.com', 'chat.openai.com', 'gemini.google.com', 'g.co'];

export type ImportDestination = 'artifact' | 'unsupported';

export function importExt(filename: string): string {
  return /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() || '';
}

export function importArtifactType(filename: string): ArtifactType | null {
  const ext = importExt(filename);
  return Object.prototype.hasOwnProperty.call(IMPORT_ARTIFACT_EXTS, ext) ? IMPORT_ARTIFACT_EXTS[ext] : null;
}

export function importDestination(filename: string): ImportDestination {
  return importArtifactType(filename) ? 'artifact' : 'unsupported';
}

export function isShareLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && IMPORT_SHARE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}
