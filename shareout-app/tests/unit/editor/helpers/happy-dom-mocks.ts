/**
 * happy-dom-style DOM shims for editor tests.
 * The Cloudflare vitest pool cannot import happy-dom directly; these mocks
 * mirror happy-dom's File/Blob behavior for FormData upload paths.
 */

export function createMockFile(
  content: BlobPart[],
  filename: string,
  options: { type?: string } = {},
): File {
  const type = options.type ?? 'application/octet-stream';
  if (typeof File !== 'undefined') {
    return new File(content, filename, { type });
  }
  const blob = new Blob(content, { type });
  return Object.assign(blob, {
    name: filename,
    type,
    size: blob.size,
    lastModified: Date.now(),
    arrayBuffer: () => blob.arrayBuffer(),
  }) as File;
}

export function createMockFormData(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}
