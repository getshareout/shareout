import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

export interface BlobMetadata {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  contentUrl?: string;
}

export interface BlobUploadResult {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BlobListResult {
  blobs: BlobMetadata[];
  total: number;
  limit: number;
  offset: number;
}

export interface BlobStorageUsage {
  usedBytes: number;
  blobCount: number;
  maxBytes: number;
  maxBlobs: number;
  availableBytes: number;
}

export class BlobsStore {
  constructor(private sdk: SdkClient) {}

  async upload(file: File | Blob, opts?: { filename?: string; mimeType?: string }): Promise<BlobUploadResult> {
    const filename = opts?.filename || (file instanceof File ? file.name : `blob-${Date.now()}`);
    const mimeType = opts?.mimeType || (file instanceof File ? file.type : 'application/octet-stream') || 'application/octet-stream';

    const tokenResponse = await this.sdk._internalFetch<{
      uploadUrl: string;
      tokenId: string;
      direct?: boolean;
      expiresAt: string;
      maxSize: number;
    }>('/blobs/upload', {
      method: 'POST',
      body: JSON.stringify({ filename, mimeType, size: file.size }),
    });

    // Direct path: PUT bytes straight to R2 (no cookies — the presigned URL carries
    // auth), then confirm so the Worker persists metadata.
    if (tokenResponse.direct) {
      const put = await fetch(tokenResponse.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': mimeType },
      });
      if (!put.ok) {
        throw new ShareOutError('Direct upload to storage failed', 'UPLOAD_FAILED', put.status);
      }
      return this.sdk._internalFetch<BlobUploadResult>(
        `/blobs/${encodeURIComponent(tokenResponse.tokenId)}/confirm`,
        { method: 'POST' }
      );
    }

    // Fallback: PUT through the Worker, which writes metadata in the same request.
    // Sandboxed artifacts are cross-origin and can't send the session cookie, so
    // carry the artifact's Bearer token like every other data call.
    const uploadHeaders: Record<string, string> = { 'Content-Type': mimeType };
    if (this.sdk._sessionToken) {
      uploadHeaders['Authorization'] = `Bearer ${this.sdk._sessionToken}`;
    }
    const uploadResponse = await fetch(tokenResponse.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: uploadHeaders,
      credentials: 'include',
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json().catch(() => ({ error: 'Upload failed' })) as { error?: string; code?: string };
      throw new ShareOutError(error.error || 'Upload failed', error.code || 'UPLOAD_FAILED', uploadResponse.status);
    }

    const result = await uploadResponse.json() as { success: boolean; data: BlobUploadResult; error?: string; code?: string };
    if (!result.success) {
      throw new ShareOutError(result.error || 'Upload failed', result.code || 'UPLOAD_FAILED', 500);
    }
    return result.data;
  }

  /**
   * Worker-proxied content URL (synchronous). Streams through the Worker. For large
   * media prefer getDownloadUrl(), which returns a short-lived direct-from-R2 URL.
   */
  getUrl(id: string): string {
    return `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/blobs/${encodeURIComponent(id)}/content`;
  }

  /**
   * Short-lived URL that downloads the blob directly from R2 (bytes bypass the
   * Worker). Falls back to the Worker content URL when direct serving is unconfigured.
   */
  async getDownloadUrl(id: string): Promise<string> {
    const res = await this.sdk._internalFetch<{ url: string; direct: boolean; expiresIn: number | null }>(
      `/blobs/${encodeURIComponent(id)}/download-url`
    );
    return res.url.startsWith('http') ? res.url : `${this.sdk._baseUrl}${res.url}`;
  }

  async get(id: string): Promise<BlobMetadata | null> {
    try {
      return await this.sdk._internalFetch<BlobMetadata>(`/blobs/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'BLOB_NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  async list(opts?: { limit?: number; offset?: number }): Promise<BlobListResult> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const query = params.toString();
    return this.sdk._internalFetch<BlobListResult>(`/blobs${query ? '?' + query : ''}`);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(`/blobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'BLOB_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  async getStorageUsage(): Promise<BlobStorageUsage> {
    return this.sdk._internalFetch<BlobStorageUsage>('/blobs/storage');
  }
}
