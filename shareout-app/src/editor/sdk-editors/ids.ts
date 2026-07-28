export function generateEditorId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blobPublicUrl(artifactId: string, blobId: string): string {
  // Matches the blob content route served by src/data/blobs/handler.ts.
  return `/v1/data/${artifactId}/blobs/${blobId}/content`;
}
