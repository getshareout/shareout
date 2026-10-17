/**
 * Google-native files have no bytes of their own; they are exported. Docs, Sheets and
 * Slides go to their Office equivalents so people keep an editable file (and the Office
 * import can turn them into live pages); Drawings and Jamboards have no Office form, so
 * they become PDF. Everything else Google-native (Forms, Sites, My Maps, Apps Script,
 * shortcuts) cannot be exported as a document and is skipped with a reason.
 *   https://developers.google.com/workspace/drive/api/guides/ref-export-formats
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export
 */

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PDF = 'application/pdf';

export interface ExportTarget {
  mime: string;
  ext: string;
}

export const GOOGLE_EXPORTS: Record<string, ExportTarget> = {
  'application/vnd.google-apps.document': { mime: DOCX, ext: 'docx' },
  'application/vnd.google-apps.spreadsheet': { mime: XLSX, ext: 'xlsx' },
  'application/vnd.google-apps.presentation': { mime: PPTX, ext: 'pptx' },
  'application/vnd.google-apps.drawing': { mime: PDF, ext: 'pdf' },
  'application/vnd.google-apps.jam': { mime: PDF, ext: 'pdf' },
};

export type GoogleFilePlan =
  | { kind: 'download' }
  | { kind: 'export'; target: ExportTarget; filename: string }
  | { kind: 'skip'; code: 'NOT_EXPORTABLE'; message: string };

export function isGoogleNative(mime: string | undefined): boolean {
  return !!mime && mime.startsWith(GOOGLE_NATIVE_PREFIX);
}

/** How to fetch a Drive file: plain download, export to an Office/PDF format, or skip. */
export function planGoogleFile(name: string, mime: string | undefined): GoogleFilePlan {
  if (!isGoogleNative(mime)) return { kind: 'download' };
  const target = GOOGLE_EXPORTS[mime!];
  if (!target) {
    const what = mime!.slice(GOOGLE_NATIVE_PREFIX.length);
    return { kind: 'skip', code: 'NOT_EXPORTABLE', message: `Google ${what} files can't be exported as a document.` };
  }
  const filename = name.toLowerCase().endsWith(`.${target.ext}`) ? name : `${name}.${target.ext}`;
  return { kind: 'export', target, filename };
}
