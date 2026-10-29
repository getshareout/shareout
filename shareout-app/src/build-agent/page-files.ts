/**
 * The page the build agent is writing: an in-memory set of text files. Edits go through
 * the same op engine as POST /v1/artifacts/{id}/edits (artifacts/apply-ops), so a bad
 * `old` fails with the same EDIT_NO_MATCH / EDIT_AMBIGUOUS the model can act on.
 */
import { applyOps, type BaseFile, type EditError, type EditOp } from '../artifacts/apply-ops';
import { mimeForPath, isSafeAssetPath, SAFE_PATH_RULE } from '../validation';
import type { FileEntry } from '../types';

export const ENTRYPOINT = 'index.html';
export const MAX_FILES = 40;
/** Source bytes across the page. Generous for hand-written HTML/CSS/JS; the storage quota still applies at publish. */
export const MAX_PAGE_BYTES = 1_500_000;

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

export type FileResult = { ok: true; note: string } | { ok: false; error: EditError };

function bad(code: string, message: string, path?: string): FileResult {
  return { ok: false, error: { code, message, ...(path ? { path } : {}) } };
}

export class PageFiles {
  private files = new Map<string, { mime: string; text: string }>();

  static from(entries: Array<{ path: string; content: string; mime?: string }>): PageFiles {
    const pf = new PageFiles();
    for (const e of entries) pf.files.set(e.path, { mime: e.mime || mimeForPath(e.path), text: e.content });
    return pf;
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  text(path: string): string | undefined {
    return this.files.get(path)?.text;
  }

  entries(): Array<{ path: string; mime: string; text: string }> {
    return [...this.files].map(([path, f]) => ({ path, mime: f.mime, text: f.text }));
  }

  totalBytes(): number {
    let n = 0;
    for (const f of this.files.values()) n += bytes(f.text);
    return n;
  }

  toFileEntries(): FileEntry[] {
    return this.entries().map((f) => ({ path: f.path, content: f.text, mime: f.mime }));
  }

  /** Create or replace a file. */
  write(path: string, content: string): FileResult {
    const refused = this.vet(path, content.length);
    if (refused) return refused;
    const mime = this.files.get(path)?.mime ?? mimeForPath(path);
    if (mime === 'application/octet-stream' || /^(image|audio|video)\//.test(mime) && mime !== 'image/svg+xml') {
      return bad('NOT_TEXT', `"${path}" is a binary file type; the builder writes text files only (HTML, CSS, JS, JSON, SVG).`, path);
    }
    const existed = this.files.has(path);
    this.files.set(path, { mime, text: content });
    return { ok: true, note: `${existed ? 'replaced' : 'created'} ${path} (${bytes(content)} bytes)` };
  }

  /** Add to the end of a file (created when missing): the way to write a file bigger than one turn. */
  append(path: string, content: string): FileResult {
    const prev = this.files.get(path)?.text ?? '';
    const r = this.write(path, prev + content);
    return r.ok ? { ok: true, note: `appended to ${path} (now ${bytes(prev + content)} bytes)` } : r;
  }

  /** Replace/delete/rename through the shared op engine. */
  edit(ops: EditOp[]): FileResult {
    const base: BaseFile[] = [...this.files].map(([path, f]) => ({ path, mime: f.mime, size: bytes(f.text), sha256: '', r2Key: '', text: f.text }));
    // Mid-build there may be no index.html yet; any existing file stands in as the main file then.
    const main = this.files.has(ENTRYPOINT) ? ENTRYPOINT : (base[0]?.path ?? ENTRYPOINT);
    const r = applyOps(base, main, ops);
    if (!r.ok) return { ok: false, error: r.error };
    const next = new Map<string, { mime: string; text: string }>();
    for (const [path, st] of r.files) next.set(path, { mime: st.mime, text: st.content ?? st.base?.text ?? '' });
    this.files = next;
    return { ok: true, note: 'ok' };
  }

  private vet(path: string, chars: number): FileResult | null {
    if (!isSafeAssetPath(path)) return bad('INVALID_PATH', `"${path}" is not a usable path. ${SAFE_PATH_RULE}`, path);
    if (!this.files.has(path) && this.files.size >= MAX_FILES) return bad('TOO_MANY_FILES', `A page may have at most ${MAX_FILES} files.`, path);
    if (this.totalBytes() + chars > MAX_PAGE_BYTES) return bad('PAGE_TOO_LARGE', `The page would pass ${Math.round(MAX_PAGE_BYTES / 1000)} KB of source. Trim or simplify it.`, path);
    return null;
  }
}
