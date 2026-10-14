/**
 * Where an imported file goes — shared by /v1/home/import and the Studio client (drop,
 * paste, New → Upload, embedded there as JSON), so every path agrees.
 *
 * The rule: if people will read it, it's an artifact; if you'll use it to build
 * something, it goes to Recursos (Assets). Documents → artifact; images, logos, video,
 * audio, fonts and other binaries → Assets.
 */
import type { ArtifactType } from '../../types';

/** Document extensions → the artifact type they become (each has a viewer). */
export const IMPORT_ARTIFACT_EXTS: Record<string, ArtifactType> = {
  html: 'html', htm: 'html', csv: 'csv', md: 'markdown', markdown: 'markdown',
  json: 'json', txt: 'txt', pdf: 'pdf',
  // Office files are converted on import; the original is kept for download.
  docx: 'markdown', odt: 'markdown', xlsx: 'csv', xls: 'csv', ods: 'csv',
};
/** Converted on import: Word-like → Markdown, spreadsheets → one CSV per sheet. */
export const IMPORT_CONVERTED_EXTS: Record<string, 'word' | 'sheet'> = {
  docx: 'word', odt: 'word', xlsx: 'sheet', xls: 'sheet', ods: 'sheet',
};
/** Sent as base64 by the client (binary formats). */
export const IMPORT_BINARY_EXTS = ['pdf', 'docx', 'odt', 'xlsx', 'xls', 'ods'];
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
/** Share links we try to fetch once (no per-vendor scraping). Subdomains match too. */
export const IMPORT_SHARE_HOSTS = ['claude.ai', 'claude.site', 'chatgpt.com', 'chat.openai.com', 'gemini.google.com', 'g.co'];

export type ImportDestination = 'artifact' | 'assets';

export function importExt(filename: string): string {
  return /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() || '';
}

export function importArtifactType(filename: string): ArtifactType | null {
  const ext = importExt(filename);
  return Object.prototype.hasOwnProperty.call(IMPORT_ARTIFACT_EXTS, ext) ? IMPORT_ARTIFACT_EXTS[ext] : null;
}

export function importDestination(filename: string): ImportDestination {
  return importArtifactType(filename) ? 'artifact' : 'assets';
}

export function isShareLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && IMPORT_SHARE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}
