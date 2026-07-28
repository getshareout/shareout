import { baseUrl } from './env';

export interface ApiError {
  error?: string;
  code?: string;
  details?: string[];
}

export interface DataResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export class ShareOutClient {
  constructor(
    private readonly token?: string,
    private readonly origin = baseUrl
  ) {}

  static anonymous(): ShareOutClient {
    return new ShareOutClient();
  }

  static withToken(token: string): ShareOutClient {
    return new ShareOutClient(token);
  }

  async request<T = unknown>(
    path: string,
    init: RequestInit = {}
  ): Promise<{ response: Response; body: T | null; text: string }> {
    const url = `${this.origin}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = new Headers(init.headers);

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, { ...init, headers });
    const text = await response.text();

    let body: T | null = null;
    if (text) {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = null;
      }
    }

    return { response, body, text };
  }

  async createAccount(): Promise<{ token: string; user_id: string }> {
    const { response, body } = await this.request<{ token: string; user_id: string }>(
      '/v1/auth/create-account',
      { method: 'POST' }
    );

    if (!response.ok || !body?.token) {
      throw new Error(`create-account failed: ${response.status} ${JSON.stringify(body)}`);
    }

    return body;
  }

  async getProfile() {
    return this.request<{ id: string; email: string | null; name?: string; metadata?: Record<string, unknown> }>(
      '/v1/auth/profile'
    );
  }

  async updateProfile(patch: { name?: string; metadata?: Record<string, unknown> }) {
    return this.request('/v1/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async getAccountTier() {
    return this.request<{ tier: string }>('/v1/account/tier');
  }

  async listArtifacts() {
    return this.request<{ artifacts: Array<{ id: string; slug: string; name: string }>; has_more: boolean; total?: number }>(
      '/v1/artifacts'
    );
  }

  async getArtifact(artifactId: string) {
    return this.request<{ id: string; name: string; slug: string; visibility: string }>(
      `/v1/artifacts/${artifactId}`
    );
  }

  async updateArtifact(artifactId: string, patch: Record<string, unknown>) {
    return this.request(`/v1/artifacts/${artifactId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async getVersions(artifactId: string) {
    return this.request<{ versions: Array<{ id: string; version_no: number }> }>(
      `/v1/artifacts/${artifactId}/versions`
    );
  }

  async getFiles(artifactId: string, version?: number) {
    const qs = version ? `?version=${version}` : '';
    return this.request<{ artifact_id: string; files: Array<{ path: string; content: string }> }>(
      `/v1/artifacts/${artifactId}/files${qs}`
    );
  }

  async publish(
    payload: {
      name: string;
      slug: string;
      files: Array<{ path: string; content: string; mime: string }>;
      visibility?: 'public' | 'private' | 'unlisted';
      entrypoint?: string;
    },
    options?: { idempotencyKey?: string }
  ) {
    const headers: Record<string, string> = {};
    if (options?.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    return this.request<{
      artifact: { id: string };
      version: { id: string; version_no: number };
      deployment: { slug: string; url: string };
    }>('/v1/publish', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        entrypoint: 'index.html',
        visibility: 'public',
        ...payload,
      }),
    });
  }

  async deleteArtifact(artifactId: string) {
    return this.request<{ success: boolean; deleted: string }>(
      `/v1/artifacts/${artifactId}`,
      { method: 'DELETE' }
    );
  }

  async listCollaborators(artifactId: string) {
    return this.request<{ collaborators: Array<{ email: string; role: string }> }>(
      `/v1/artifacts/${artifactId}/collaborators`
    );
  }

  async addCollaborators(artifactId: string, emails: string[], role: 'viewer' | 'editor' = 'viewer') {
    return this.request(`/v1/artifacts/${artifactId}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ emails, role }),
    });
  }

  async removeCollaborator(artifactId: string, email: string) {
    return this.request(
      `/v1/artifacts/${artifactId}/collaborators/${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  }

  async listWorkspaces() {
    return this.request<{ workspaces: Array<{ id: string; name: string; slug: string }> }>(
      '/v1/workspaces'
    );
  }

  async createJob(payload: {
    artifact_id: string;
    action: 'email' | 'webhook' | 'slack' | 'discord' | 'http_get' | 'materialize';
    schedule: string;
    config: Record<string, unknown>;
  }) {
    return this.request<{ job?: { id: string; artifact_id: string; action: string }; error?: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async listJobs(artifactId?: string) {
    const qs = artifactId ? `?artifact_id=${artifactId}` : '';
    return this.request<{ jobs: Array<{ id: string; artifact_id: string }> }>(`/v1/jobs${qs}`);
  }

  async runJob(jobId: string) {
    return this.request<{ execution: { success: boolean; status: string; error?: string } }>(
      `/v1/jobs/${jobId}/run`,
      { method: 'POST' }
    );
  }

  async deleteJob(jobId: string) {
    return this.request(`/v1/jobs/${jobId}`, { method: 'DELETE' });
  }

  async shareToSlack(artifactId: string, payload: {
    connection: string;
    targetType?: 'channel' | 'dm';
    channelId?: string;
    slackUserId?: string;
    mode?: 'message' | 'snapshot' | 'pdf' | 'both';
    message?: string;
  }) {
    return this.request<{ delivered: boolean; error?: string }>(
      `/v1/artifacts/${artifactId}/share/slack`,
      { method: 'POST', body: JSON.stringify(payload) }
    );
  }

  async getArtifactHtml(slug: string) {
    return fetch(`${this.origin}/a/${slug}/`);
  }

  async getArtifactRaw(slug: string, path = 'index.html') {
    return fetch(`${this.origin}/a/${slug}/${path}?_raw`);
  }

  async dataJsonList(artifactId: string) {
    return this.request<DataResponse<{ keys: string[]; count: number }>>(
      `/v1/data/${artifactId}/json`
    );
  }

  async dataJsonPut(artifactId: string, key: string, value: unknown) {
    return this.request<DataResponse>(`/v1/data/${artifactId}/json/${key}`, {
      method: 'PUT',
      body: JSON.stringify(value),
    });
  }

  async dataJsonGet(artifactId: string, key: string) {
    return this.request<DataResponse<{ value: unknown }>>(
      `/v1/data/${artifactId}/json/${key}`
    );
  }

  async dataJsonDelete(artifactId: string, key: string) {
    return this.request<DataResponse>(`/v1/data/${artifactId}/json/${key}`, { method: 'DELETE' });
  }

  async tableInsert(artifactId: string, table: string, row: Record<string, unknown>) {
    return this.request<DataResponse<{ inserted: Record<string, unknown>[]; count: number }>>(
      `/v1/data/${artifactId}/tables/${table}`,
      { method: 'POST', body: JSON.stringify(row) }
    );
  }

  async tableQuery(artifactId: string, table: string, body: Record<string, unknown> = {}) {
    return this.request<DataResponse<{ rows: Record<string, unknown>[]; total: number }>>(
      `/v1/data/${artifactId}/tables/${table}/query`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  }

  async tableCount(artifactId: string, table: string) {
    return this.request<DataResponse<{ count: number }>>(
      `/v1/data/${artifactId}/tables/${table}/count`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  async tableDeleteRow(artifactId: string, table: string, rowId: string) {
    return this.request<DataResponse>(
      `/v1/data/${artifactId}/tables/${table}/${rowId}`,
      { method: 'DELETE' }
    );
  }

  async blobRequestUpload(artifactId: string, filename: string, mimeType: string, size: number) {
    return this.request<DataResponse<{ uploadUrl: string; tokenId: string; direct?: boolean; confirmUrl?: string }>>(
      `/v1/data/${artifactId}/blobs/upload`,
      {
        method: 'POST',
        body: JSON.stringify({ filename, mimeType, size }),
      }
    );
  }

  async blobUpload(uploadUrl: string, content: string, mimeType: string) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: content,
    });
    const text = await response.text();
    let body: DataResponse | null = null;
    try {
      body = JSON.parse(text) as DataResponse;
    } catch {
      body = null;
    }
    return { response, body, text };
  }

  async blobConfirm(artifactId: string, tokenId: string) {
    return this.request<DataResponse<{ id: string; filename: string; mimeType: string }>>(
      `/v1/data/${artifactId}/blobs/${encodeURIComponent(tokenId)}/confirm`,
      { method: 'POST' }
    );
  }

  async blobList(artifactId: string) {
    return this.request<DataResponse<{ blobs: Array<{ id: string; filename: string }>; total: number }>>(
      `/v1/data/${artifactId}/blobs`
    );
  }

  async blobGet(artifactId: string, blobId: string) {
    return this.request<DataResponse<{ id: string; filename: string; mimeType: string }>>(
      `/v1/data/${artifactId}/blobs/${blobId}`
    );
  }

  async blobDelete(artifactId: string, blobId: string) {
    return this.request<DataResponse>(`/v1/data/${artifactId}/blobs/${blobId}`, { method: 'DELETE' });
  }

  async blobStorage(artifactId: string) {
    return this.request<DataResponse<{ used: number; limit: number; blobCount: number }>>(
      `/v1/data/${artifactId}/blobs/storage`
    );
  }

  async createConnection(
    artifactId: string,
    payload: {
      name: string;
      type: 'rest_api' | 'bigquery' | 'snowflake';
      config: Record<string, unknown>;
      credentials?: { type: string; data: Record<string, unknown> };
      cacheTtl?: number;
      rateLimit?: number;
    },
  ) {
    return this.request<DataResponse<{ name: string; type: string; hasCredentials: boolean }>>(
      `/v1/data/${artifactId}/connections`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  }

  async materializeConnection(
    artifactId: string,
    connectionName: string,
    payload: {
      query?: string | Record<string, unknown>;
      rows?: unknown[];
      target: { type: 'dataset' | 'table' | 'json'; name: string; path?: string };
      mode?: 'replace' | 'append';
      format?: 'json' | 'csv';
    },
  ) {
    return this.request<DataResponse<{
      target: string;
      name: string;
      rowCount: number;
      version?: number;
      sizeBytes?: number;
    }>>(
      `/v1/data/${artifactId}/connections/${encodeURIComponent(connectionName)}/materialize`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  }

  async listDatasets(artifactId: string) {
    return this.request<DataResponse<{
      datasets: Array<{ name: string; format: string; sizeBytes: number; version: number }>;
      count: number;
    }>>(`/v1/data/${artifactId}/datasets`);
  }

  async getDataset(artifactId: string, name: string) {
    return this.request<DataResponse<{
      name: string;
      format: string;
      sizeBytes: number;
      version: number;
      metadata?: { rowCount?: number; columns?: string[] } | null;
    }>>(`/v1/data/${artifactId}/datasets/${encodeURIComponent(name)}`);
  }

  async datasetContent(
    artifactId: string,
    name: string,
    opts: { offset?: number; limit?: number } = {},
  ) {
    const qs = new URLSearchParams();
    if (opts.offset !== undefined) qs.set('offset', String(opts.offset));
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    return this.request<DataResponse<{
      data: unknown[];
      total: number;
      offset: number;
      limit: number;
      hasMore: boolean;
    }>>(
      `/v1/data/${artifactId}/datasets/${encodeURIComponent(name)}/content${q ? `?${q}` : ''}`,
    );
  }

  async deleteDataset(artifactId: string, name: string) {
    return this.request<DataResponse>(
      `/v1/data/${artifactId}/datasets/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  async deleteConnection(artifactId: string, name: string) {
    return this.request<DataResponse>(
      `/v1/data/${artifactId}/connections/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  async proxyFetch(targetUrl: string) {
    return this.request(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);
  }
}
