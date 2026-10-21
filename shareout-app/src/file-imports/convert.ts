/**
 * Imported documents → live pages, with the same converters the Studio drop-import uses
 * (pages/home/import-office.ts, import-slides.ts) and the same publish pipeline
 * (moderation, storage quota). The page is what people see; the workspace file underneath
 * only tracks the drive item for sync. Re-publishing under the stored slug makes
 * a changed file a new version of the same page instead of a second page.
 */
import type { ArtifactType, Env, FileEntry, ImportedSource, Visibility } from '../types';
import { checkStorageQuota } from '../quota';
import { publishArtifact } from '../publish/publish-artifact';
import { generateSlug } from '../validation';
import { IMPORT_CONVERTED_EXTS, IMPORT_MAX_BYTES, IMPORT_MEDIA_MIME, IMPORT_SLIDES_EXTS, importExt } from '../pages/home/import-rules';
import { ImportError, bytesToBase64, convertOfficeImport } from '../pages/home/import-office';
import { convertSlidesImport } from '../pages/home/import-slides';

/** Plain document types that become a page as-is. HTML is deliberately absent: a page
 *  from someone's drive should not run their scripts on our origin. */
const DIRECT: Record<string, { type: ArtifactType; mime: string; binary: boolean }> = {
  pdf: { type: 'pdf', mime: 'application/pdf', binary: true },
  md: { type: 'markdown', mime: 'text/markdown', binary: false },
  markdown: { type: 'markdown', mime: 'text/markdown', binary: false },
  csv: { type: 'csv', mime: 'text/csv', binary: false },
  txt: { type: 'txt', mime: 'text/plain', binary: false },
  ...Object.fromEntries(Object.entries(IMPORT_MEDIA_MIME).map(([ext, mime]) => [ext, { type: (mime.startsWith('video/') ? 'video' : 'image') as ArtifactType, mime, binary: ext !== 'svg' }])),
};

/** Whether this file would become a page on this instance. */
export function isConvertible(env: Env, filename: string, size: number | null): boolean {
  if (size !== null && size > IMPORT_MAX_BYTES) return false;
  const ext = importExt(filename);
  return !!IMPORT_CONVERTED_EXTS[ext] || !!DIRECT[ext] || (IMPORT_SLIDES_EXTS.includes(ext) && !!env.SLIDES_CONVERTER);
}

export interface PageInput {
  user: { id: string; email: string | null };
  workspaceId: string;
  folderId: string | null;
  visibility: Visibility;
  filename: string;
  displayName: string;
  bytes: Uint8Array;
  /** The page this file became last time, so a change is a new version of it. */
  slug: string | null;
}

export type PageResult = { ok: true; artifactId: string; slug: string } | { ok: false; code: string; message: string };

export async function convertToPage(env: Env, input: PageInput): Promise<PageResult> {
  const ext = importExt(input.filename);
  let files: FileEntry[];
  let entrypoint: string;
  let source: ImportedSource | undefined;
  let type: ArtifactType;
  try {
    const kind = IMPORT_CONVERTED_EXTS[ext];
    if (kind) {
      ({ files, entrypoint, source } = await convertOfficeImport(env, input.filename, ext, kind, input.bytes));
      type = kind === 'sheet' ? 'csv' : 'markdown';
    } else if (IMPORT_SLIDES_EXTS.includes(ext)) {
      ({ files, entrypoint, source } = await convertSlidesImport(env, input.filename, ext, input.bytes));
      type = 'pdf';
    } else if (DIRECT[ext]) {
      const d = DIRECT[ext];
      const path = input.filename.replace(/[^\w.-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^\.+/, '') || `file.${ext}`;
      files = [d.binary
        ? { path, content: bytesToBase64(input.bytes), mime: d.mime, encoding: 'base64' }
        : { path, content: new TextDecoder().decode(input.bytes), mime: d.mime }];
      entrypoint = path;
      type = d.type;
    } else {
      return { ok: false, code: 'NOT_CONVERTIBLE', message: 'Kept as a file.' };
    }
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'CONVERT_FAILED', message: 'This document could not be read.' };
  }

  const quota = await checkStorageQuota(env, input.user.id, files);
  if (!quota.allowed) return { ok: false, code: 'STORAGE_QUOTA_EXCEEDED', message: 'Storage limit reached; kept as a file only.' };

  const name = input.displayName.replace(/\.[^.]+$/, '').trim().slice(0, 120) || input.displayName;
  const slug = input.slug || `${generateSlug(name.normalize('NFD').replace(/[̀-ͯ]/g, ''))}-${crypto.randomUUID().slice(0, 6)}`;
  try {
    const published = await publishArtifact(env, { id: input.user.id, email: input.user.email || '', username: null }, {
      name, slug, entrypoint, files, visibility: input.visibility, authMethod: 'google',
      shareWith: [], credentials: [], workspaceId: input.workspaceId, folderId: input.folderId, artifactType: type, source,
    });
    return { ok: true, artifactId: published.artifact.id, slug };
  } catch (e) {
    return { ok: false, code: 'PUBLISH_FAILED', message: e instanceof Error ? e.message.slice(0, 200) : 'Could not create the page.' };
  }
}
