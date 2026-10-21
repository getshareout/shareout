import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

export const ZIP_MAX_ENTRIES = 5000;
export const ZIP_MAX_INFLATED_BYTES = 64 * 1024 * 1024;
const SLICE_BYTES = 16 * 1024;

export class ZipTooLargeError extends Error {
  constructor() { super('Archive expands beyond the allowed size'); }
}

/** unzipSync with a real bound: inflates in small slices and stops once the entry count or the total inflated bytes pass the cap. Skipped entries are never inflated. */
export function unzipBounded(
  bytes: Uint8Array,
  opts: { filter?: (name: string) => boolean; discard?: boolean } = {},
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let entries = 0;
  let total = 0;
  const unzip = new Unzip((file) => {
    if (++entries > ZIP_MAX_ENTRIES) throw new ZipTooLargeError();
    if (file.name.endsWith('/') || (opts.filter && !opts.filter(file.name))) return;
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      total += chunk.length;
      if (total > ZIP_MAX_INFLATED_BYTES) { file.terminate(); throw new ZipTooLargeError(); }
      if (opts.discard) return;
      chunks.push(chunk);
      if (final) {
        const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of chunks) { joined.set(c, at); at += c.length; }
        out[file.name] = joined;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  for (let i = 0; i < bytes.length; i += SLICE_BYTES) unzip.push(bytes.subarray(i, i + SLICE_BYTES), i + SLICE_BYTES >= bytes.length);
  if (!bytes.length) unzip.push(bytes, true);
  return out;
}

/** For parsers that unzip internally (SheetJS): refuse a zip that inflates past the cap before handing it over. Non-zip and malformed input is left to the parser. */
export function assertZipWithinBounds(bytes: Uint8Array): void {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  try { unzipBounded(bytes, { discard: true }); } catch (e) { if (e instanceof ZipTooLargeError) throw e; }
}
