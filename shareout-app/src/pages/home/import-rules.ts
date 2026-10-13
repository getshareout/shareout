/**
 * What one-step Home import does with a file — shared by the /v1/home/import handler
 * and the Studio drop/paste client script (embedded there as JSON), so both agree.
 */
import type { ArtifactType } from '../../types';

/** Extensions published as artifacts (each has a viewer). Everything else → Assets. */
export const IMPORT_ARTIFACT_EXTS: Record<string, ArtifactType> = {
  html: 'html', htm: 'html', csv: 'csv', md: 'markdown', markdown: 'markdown',
  json: 'json', txt: 'txt', pdf: 'pdf',
};
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
/** Share links we try to fetch once (no per-vendor scraping). Subdomains match too. */
export const IMPORT_SHARE_HOSTS = ['claude.ai', 'claude.site', 'chatgpt.com', 'chat.openai.com', 'gemini.google.com', 'g.co'];

export function importArtifactType(filename: string): ArtifactType | null {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  return (ext && IMPORT_ARTIFACT_EXTS[ext]) || null;
}

export function isShareLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && IMPORT_SHARE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}
