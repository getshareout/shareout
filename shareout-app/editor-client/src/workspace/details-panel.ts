// Artifact details panel - displays metadata, files, data storage, collaborators
import type { EditorContext } from '../editor/context';

export interface BlobItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface JsonKeyItem {
  key: string;
  value?: unknown;
  updatedAt?: string;
  sizeBytes?: number;
}

export interface FileItem {
  path: string;
  size_bytes: number;
  mime: string;
}

export interface ArtifactDetails {
  artifact: {
    id: string;
    name: string;
    slug: string;
    visibility: 'private' | 'unlisted' | 'workspace' | 'public';
    current_version: number;
    created_at: string;
    updated_at: string | null;
  };
  files: FileItem[];
  json: { keys: JsonKeyItem[]; count: number };
  tables: Array<{ name: string; rowCount: number }>;
  blobs: { items: BlobItem[]; total: number };
  storage: { usedBytes: number; maxBytes: number };
  comments: { count: number };
  collaborators: Array<{ email: string; role: string }>;
  sheetsConnected: boolean;
  skills: Array<{ name: string; slug: string; summary: string | null }>;
}

export async function loadArtifactDetails(ctx: EditorContext): Promise<ArtifactDetails> {
  const { artifactId, baseUrl } = ctx.config;

  const fetchJson = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      const res = await fetch(`${baseUrl}${path}`, { credentials: 'include' });
      if (!res.ok) return fallback;
      const json = await res.json();
      return json.data ?? json;
    } catch {
      return fallback;
    }
  };

  const [
    artifactData,
    filesData,
    jsonData,
    blobsData,
    storageData,
    commentsData,
    collabData,
    sheetsData,
    tablesData,
    skillsData,
  ] = await Promise.all([
    fetchJson(`/v1/artifacts/${artifactId}`, null),
    fetchJson(`/v1/artifacts/${artifactId}/files`, { files: [] }),
    fetchJson(`/v1/data/${artifactId}/json`, { keys: [], count: 0 }),
    fetchJson(`/v1/data/${artifactId}/blobs`, { blobs: [], total: 0 }),
    fetchJson(`/v1/data/${artifactId}/blobs/storage`, { usedBytes: 0, maxBytes: 524288000 }),
    fetchJson(`/v1/data/${artifactId}/comments`, { comments: [], count: 0 }),
    fetchJson(`/v1/artifacts/${artifactId}/collaborators`, { collaborators: [] }),
    fetchJson(`/v1/data/${artifactId}/sheets/token-status`, { connected: false }),
    fetchJson(`/v1/data/${artifactId}/tables`, { tables: [] }),
    fetchJson(`/v1/artifacts/${artifactId}/skills`, { skills: [] }),
  ]);

  const jsonKeys: JsonKeyItem[] = (jsonData.keys ?? []).map((key: string) => ({ key }));
  const blobItems: BlobItem[] = (blobsData.blobs ?? []).map((b: BlobItem) => ({
    id: b.id,
    filename: b.filename,
    mimeType: b.mimeType,
    sizeBytes: b.sizeBytes,
    createdAt: b.createdAt,
  }));

  return {
    artifact: artifactData ?? {
      id: artifactId,
      name: ctx.config.slug,
      slug: ctx.config.slug,
      visibility: 'private',
      current_version: 1,
      created_at: new Date().toISOString(),
      updated_at: null,
    },
    files: filesData.files ?? [],
    json: { keys: jsonKeys, count: jsonData.count ?? jsonKeys.length },
    tables: tablesData.tables ?? [],
    blobs: { items: blobItems, total: blobsData.total ?? blobItems.length },
    storage: {
      usedBytes: storageData.usedBytes ?? 0,
      maxBytes: storageData.maxBytes ?? 524288000,
    },
    comments: { count: commentsData.count ?? commentsData.comments?.length ?? 0 },
    collaborators: collabData.collaborators ?? [],
    sheetsConnected: sheetsData.connected === true,
    skills: (skillsData.skills ?? []).map((s: { name: string; slug: string; summary?: string | null }) => ({
      name: s.name,
      slug: s.slug,
      summary: s.summary ?? null,
    })),
  };
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const getMimeIcon = (mime: string): string => {
  if (mime.startsWith('image/')) return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  if (mime.startsWith('video/')) return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M10 8l6 4-6 4V8z"/></svg>';
  if (mime.startsWith('audio/')) return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  if (mime === 'application/pdf') return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  if (mime === 'text/html') return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  if (mime === 'text/css') return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6"/><path d="M9 15h6"/></svg>';
  if (mime.includes('javascript') || mime === 'application/json') return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>';
  if (mime.startsWith('text/')) return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>';
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
};

const getFileTypeLabel = (mime: string): string => {
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  if (mime.startsWith('video/')) return mime.replace('video/', '').toUpperCase();
  if (mime.startsWith('audio/')) return mime.replace('audio/', '').toUpperCase();
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'text/html') return 'HTML';
  if (mime === 'text/css') return 'CSS';
  if (mime.includes('javascript')) return 'JS';
  if (mime === 'application/json') return 'JSON';
  if (mime === 'text/plain') return 'TXT';
  if (mime === 'text/csv') return 'CSV';
  if (mime === 'text/markdown') return 'MD';
  return mime.split('/').pop()?.toUpperCase() || 'FILE';
};

function buildFileTree(files: FileItem[]): Map<string, FileItem[]> {
  const tree = new Map<string, FileItem[]>();
  for (const file of files) {
    const parts = file.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
    if (!tree.has(dir)) tree.set(dir, []);
    tree.get(dir)!.push(file);
  }
  return tree;
}

function renderFilesTree(files: FileItem[]): string {
  if (files.length === 0) return '<p class="empty-hint">No files published yet</p>';

  const tree = buildFileTree(files);
  const dirs = Array.from(tree.keys()).sort();

  return `
    <div class="files-tree">
      ${dirs.map(dir => {
        const dirFiles = tree.get(dir)!;
        const isRoot = dir === '/';
        return `
          <div class="tree-folder ${isRoot ? 'tree-folder-root' : ''}" data-folder="${escapeHtml(dir)}">
            ${!isRoot ? `
              <div class="tree-folder-header" data-toggle-folder>
                <svg class="icon tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
                <svg class="icon tree-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span class="tree-folder-name">${escapeHtml(dir)}</span>
                <span class="tree-folder-count">${dirFiles.length}</span>
              </div>
            ` : ''}
            <div class="tree-files ${isRoot ? 'tree-files-expanded' : ''}">
              ${dirFiles.map(f => {
                const filename = f.path.split('/').pop() || f.path;
                return `
                  <div class="tree-file" data-path="${escapeHtml(f.path)}">
                    <span class="tree-file-icon">${getMimeIcon(f.mime)}</span>
                    <span class="tree-file-name">${escapeHtml(filename)}</span>
                    <span class="tree-file-type">${getFileTypeLabel(f.mime)}</span>
                    <span class="tree-file-size">${formatBytes(f.size_bytes)}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderBlobsList(blobs: BlobItem[], artifactId: string): string {
  if (blobs.length === 0) return '<p class="empty-hint">No blobs stored yet</p>';

  return `
    <div class="blobs-list">
      ${blobs.map(b => {
        const isImage = b.mimeType.startsWith('image/');
        const isPdf = b.mimeType === 'application/pdf';
        const isPreviewable = isImage || isPdf;
        return `
          <div class="blob-item ${isPreviewable ? 'blob-previewable' : ''}"
               data-blob-id="${b.id}"
               data-mime="${b.mimeType}"
               data-artifact-id="${artifactId}">
            <div class="blob-preview-area">
              ${isImage ? `
                <img class="blob-thumb"
                     src="/v1/data/${artifactId}/blobs/${b.id}/content"
                     alt="${escapeHtml(b.filename)}"
                     loading="lazy">
              ` : `
                <span class="blob-icon">${getMimeIcon(b.mimeType)}</span>
              `}
            </div>
            <div class="blob-info">
              <div class="blob-filename">${escapeHtml(b.filename)}</div>
              <div class="blob-meta">
                <span class="blob-type">${getFileTypeLabel(b.mimeType)}</span>
                <span class="blob-size">${formatBytes(b.sizeBytes)}</span>
                <span class="blob-date">${formatDate(b.createdAt)}</span>
              </div>
            </div>
            <div class="blob-actions">
              ${isPreviewable ? `
                <button class="btn-icon btn-preview" data-action="preview" title="Preview">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              ` : ''}
              <button class="btn-icon btn-download" data-action="download" title="Download">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
              </button>
              <button class="btn-icon btn-copy" data-action="copy-url" title="Copy URL">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderJsonKeysList(keys: JsonKeyItem[], artifactId: string): string {
  if (keys.length === 0) return '<p class="empty-hint">No JSON keys stored yet</p>';

  return `
    <div class="json-keys-list">
      ${keys.map(k => `
        <div class="json-key-item" data-key="${escapeHtml(k.key)}" data-artifact-id="${artifactId}">
          <div class="json-key-header" data-toggle-json>
            <svg class="icon json-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            <span class="json-key-icon">{ }</span>
            <span class="json-key-name">${escapeHtml(k.key)}</span>
            <span class="json-key-status">Click to load</span>
          </div>
          <div class="json-key-value" hidden>
            <pre class="json-value-content"><code>Loading...</code></pre>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderTablesList(tables: Array<{ name: string; rowCount: number }>, artifactId: string): string {
  if (tables.length === 0) return '<p class="empty-hint">No tables created yet</p>';

  return `
    <div class="tables-list">
      ${tables.map(t => `
        <div class="table-item" data-table-name="${escapeHtml(t.name)}" data-artifact-id="${artifactId}">
          <div class="table-header" data-toggle-table>
            <svg class="icon table-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            <span class="table-icon">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
            </span>
            <span class="table-name">${escapeHtml(t.name)}</span>
            <span class="table-row-count">${t.rowCount} row${t.rowCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="table-preview" hidden>
            <div class="table-preview-loading">Loading preview...</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

const VISIBILITY_LABELS: Record<string, string> = {
  private: 'Private',
  unlisted: 'Link Only',
  workspace: 'Workspace',
  public: 'Public',
};

/** Visibility options for the Details selector. When open visibility is disabled (launch flag),
 *  only the closed visibilities (private/workspace) are offered so we don't show options the
 *  server would just coerce away. */
export function visibilityOptions(openVisDisabled: boolean): Array<{ value: string; label: string }> {
  const values = openVisDisabled ? ['private', 'workspace'] : ['private', 'unlisted', 'workspace', 'public'];
  return values.map((value) => ({ value, label: VISIBILITY_LABELS[value] }));
}

export function renderDetailsPanel(data: ArtifactDetails): string {
  const { artifact, files, json, tables, blobs, storage, comments, collaborators, sheetsConnected, skills } = data;

  const openVisDisabled = !!(typeof window !== 'undefined' && window.EDITOR_CONFIG?.openVisDisabled);
  const visOptions = visibilityOptions(openVisDisabled)
    .concat(
      // keep the current value selectable even if it's outside the allowed set
      VISIBILITY_LABELS[artifact.visibility] && !visibilityOptions(openVisDisabled).some((o) => o.value === artifact.visibility)
        ? [{ value: artifact.visibility, label: VISIBILITY_LABELS[artifact.visibility] }]
        : [],
    );

  return `
    <div class="details-panel" data-artifact-id="${artifact.id}">
      <section class="details-section">
        <h3 class="details-section-title">Artifact Info</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="info-label">Name</span>
            <span class="info-value">${escapeHtml(artifact.name)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Slug</span>
            <span class="info-value info-mono">${escapeHtml(artifact.slug)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Visibility</span>
            <span class="info-value">
              <select class="details-select" data-visibility-select aria-label="Artifact visibility">
                ${visOptions.map((o) => `<option value="${o.value}"${artifact.visibility === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Version</span>
            <span class="info-value">v${artifact.current_version}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Created</span>
            <span class="info-value">${formatDate(artifact.created_at)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Updated</span>
            <span class="info-value">${artifact.updated_at ? formatDate(artifact.updated_at) : '—'}</span>
          </div>
        </div>
        <div class="details-actions">
          <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" data-download-html>Download HTML</button>
          <button class="so-c-btn so-c-btn--danger-outline so-c-btn--sm" data-delete-artifact>Delete artifact</button>
        </div>
      </section>

      <section class="details-section details-section-expandable" data-section="files">
        <div class="details-section-header" data-toggle-section>
          <svg class="icon section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          <h3 class="details-section-title">Files</h3>
          <span class="section-count">${files.length}</span>
        </div>
        <div class="details-section-content">
          ${renderFilesTree(files)}
        </div>
      </section>

      <section class="details-section details-section-expandable details-section-expanded" data-section="blobs">
        <div class="details-section-header" data-toggle-section>
          <svg class="icon section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          <h3 class="details-section-title">Blobs</h3>
          <span class="section-count">${blobs.total}</span>
        </div>
        <div class="details-section-content">
          ${renderBlobsList(blobs.items, artifact.id)}
        </div>
      </section>

      <section class="details-section details-section-expandable details-section-expanded" data-section="json">
        <div class="details-section-header" data-toggle-section>
          <svg class="icon section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          <h3 class="details-section-title">JSON Keys</h3>
          <span class="section-count">${json.count}</span>
        </div>
        <div class="details-section-content">
          ${renderJsonKeysList(json.keys, artifact.id)}
        </div>
      </section>

      <section class="details-section details-section-expandable ${tables.length > 0 ? 'details-section-expanded' : ''}" data-section="tables">
        <div class="details-section-header" data-toggle-section>
          <svg class="icon section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          <h3 class="details-section-title">Tables</h3>
          <span class="section-count">${tables.length}</span>
        </div>
        <div class="details-section-content">
          ${renderTablesList(tables, artifact.id)}
        </div>
      </section>

      <section class="details-section">
        <h3 class="details-section-title">Storage Overview</h3>
        <div class="storage-bar-container">
          <div class="storage-bar">
            <div class="storage-bar-fill" style="width: ${Math.min((storage.usedBytes / storage.maxBytes) * 100, 100)}%"></div>
          </div>
          <div class="storage-bar-labels">
            <span>${formatBytes(storage.usedBytes)} used</span>
            <span>${formatBytes(storage.maxBytes)} total</span>
          </div>
        </div>
        <div class="storage-grid storage-grid-compact">
          <div class="storage-stat">
            <span class="storage-stat-value">${json.count}</span>
            <span class="storage-stat-label">JSON Keys</span>
          </div>
          <div class="storage-stat">
            <span class="storage-stat-value">${tables.length}</span>
            <span class="storage-stat-label">Tables</span>
          </div>
          <div class="storage-stat">
            <span class="storage-stat-value">${blobs.total}</span>
            <span class="storage-stat-label">Blobs</span>
          </div>
          <div class="storage-stat">
            <span class="storage-stat-value">${files.length}</span>
            <span class="storage-stat-label">Files</span>
          </div>
          <div class="storage-stat">
            <span class="storage-stat-value">${comments.count}</span>
            <span class="storage-stat-label">Comments</span>
          </div>
        </div>
      </section>

      <section class="details-section">
        <div class="details-section-header">
          <h3 class="details-section-title">Collaborators</h3>
          <span class="section-count">${collaborators.length}</span>
        </div>
        ${collaborators.length > 0 ? `
          <div class="collab-list">
            ${collaborators.map(c => `
              <div class="collab-item">
                <div class="collab-avatar">${c.email.charAt(0).toUpperCase()}</div>
                <div class="collab-info">
                  <div class="collab-email">${escapeHtml(c.email)}</div>
                  <div class="collab-role">${c.role}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p class="empty-hint">No collaborators</p>'}
      </section>

      ${skills.length > 0 ? `
      <section class="details-section">
        <div class="details-section-header">
          <h3 class="details-section-title">Skills</h3>
          <span class="section-count">${skills.length}</span>
        </div>
        <div class="skill-chips">
          ${skills.map(s => `
            <a class="skill-chip" href="/a/${encodeURIComponent(s.slug)}/" target="_blank" rel="noopener"${s.summary ? ` title="${escapeHtml(s.summary)}"` : ''}>
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              <span>${escapeHtml(s.name)}</span>
            </a>
          `).join('')}
        </div>
        <p class="empty-hint">Authoring agents read these skills as context when working on this artifact.</p>
      </section>
      ` : ''}

      <section class="details-section">
        <h3 class="details-section-title">Integrations</h3>
        <div class="integration-row">
          <span class="integration-icon">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          </span>
          <span class="integration-name">Google Sheets</span>
          <span class="status-pill ${sheetsConnected ? 'status-connected' : 'status-disconnected'}">
            ${sheetsConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
      </section>
    </div>

    <div id="blob-preview-modal" class="preview-modal" hidden>
      <div class="preview-modal-backdrop"></div>
      <div class="preview-modal-content">
        <div class="preview-modal-header">
          <span class="preview-modal-title"></span>
          <button class="btn-icon preview-modal-close">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="preview-modal-body"></div>
      </div>
    </div>
  `;
}

export function renderLoadingSkeleton(): string {
  return `
    <div class="details-loading">
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-row"></div>
      <div class="skeleton-line skeleton-row"></div>
      <div class="skeleton-line skeleton-row"></div>
      <div class="skeleton-line skeleton-row"></div>
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-row"></div>
    </div>
  `;
}

export function renderErrorState(message: string): string {
  return `
    <div class="details-error">
      <div class="error-icon">!</div>
      <p class="error-message">${message}</p>
      <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="location.reload()">Retry</button>
    </div>
  `;
}
