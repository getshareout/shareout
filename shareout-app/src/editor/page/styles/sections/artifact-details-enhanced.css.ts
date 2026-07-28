/**
 * ShareOut Visual Editor styles — Enhanced artifact details panel (storage, files, integrations)
 * @module editor/page/styles/sections/artifact-details-enhanced
 */

/** CSS for the artifact details enhanced section of the visual editor. */
export const artifactDetailsEnhancedCss = `

/* ==========================================================================
   16. ENHANCED ARTIFACT DETAILS PANEL
   ========================================================================== */

/* Expandable sections */
.details-section-expandable .details-section-header {
  cursor: pointer;
  padding: 8px 0;
  margin-bottom: 0;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast);
}

.details-section-expandable .details-section-header:hover {
  background: var(--bg-hover);
}

.details-section-expandable .details-section-content {
  max-height: 0;
  overflow: hidden;
  transition: max-height var(--duration-slow) var(--ease-out);
}

.details-section-expandable.details-section-expanded .details-section-content {
  max-height: 500px;
  overflow-y: auto;
}

.section-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  margin-right: 8px;
  transition: transform var(--duration-fast);
}

.details-section-expanded .section-chevron {
  transform: rotate(90deg);
}

/* Icon base */
.icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Storage bar */
.storage-bar-container {
  margin-bottom: 16px;
}

.storage-bar {
  height: 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.storage-bar-fill {
  height: 100%;
  background: var(--primary);
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow);
}

.storage-bar-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.storage-grid-compact {
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.storage-stat {
  text-align: center;
  padding: 10px 6px;
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}

.storage-stat-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.storage-stat-label {
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* Files Tree */
.files-tree {
  font-size: 13px;
}

.tree-folder {
  margin-bottom: 4px;
}

.tree-folder-header {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
}

.tree-folder-header:hover {
  background: var(--bg-hover);
}

.tree-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  margin-right: 4px;
  transition: transform var(--duration-fast);
}

.tree-folder-expanded .tree-chevron {
  transform: rotate(90deg);
}

.tree-folder-icon {
  width: 16px;
  height: 16px;
  color: var(--warning);
  margin-right: 8px;
}

.tree-folder-name {
  flex: 1;
  font-weight: 500;
  color: var(--text-primary);
}

.tree-folder-count {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}

.tree-files {
  display: none;
  padding-left: 24px;
}

.tree-files-expanded,
.tree-folder-expanded .tree-files {
  display: block;
}

.tree-file {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
}

.tree-file:hover {
  background: var(--bg-hover);
}

.tree-file-icon {
  margin-right: 8px;
  color: var(--text-secondary);
}

.tree-file-icon .icon {
  width: 14px;
  height: 14px;
}

.tree-file-name {
  flex: 1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-file-type {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 2px 5px;
  border-radius: 3px;
  margin-left: 8px;
}

.tree-file-size {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 8px;
}

/* Blobs List */
.blobs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.blob-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  transition: all var(--duration-fast);
}

.blob-item:hover {
  background: var(--bg-active);
}

.blob-previewable {
  cursor: pointer;
}

.blob-preview-area {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.blob-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.blob-icon {
  color: var(--text-secondary);
}

.blob-icon .icon {
  width: 24px;
  height: 24px;
}

.blob-info {
  flex: 1;
  min-width: 0;
}

.blob-filename {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.blob-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.blob-type {
  font-size: 9px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-soft);
  padding: 2px 5px;
  border-radius: 3px;
}

.blob-size,
.blob-date {
  font-size: 11px;
  color: var(--text-muted);
}

.blob-actions {
  display: flex;
  gap: 4px;
}

.btn-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.btn-icon:hover {
  background: var(--bg-panel);
  color: var(--text-primary);
}

.btn-icon .icon {
  width: 16px;
  height: 16px;
}

.btn-copied {
  color: var(--success);
}

/* JSON Keys List */
.json-keys-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.json-key-item {
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.json-key-header {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  transition: background var(--duration-fast);
}

.json-key-header:hover {
  background: var(--bg-hover);
}

.json-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  margin-right: 6px;
  transition: transform var(--duration-fast);
}

.json-key-expanded .json-chevron {
  transform: rotate(90deg);
}

.json-key-icon {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  margin-right: 8px;
}

.json-key-name {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.json-key-status {
  font-size: 10px;
  color: var(--text-muted);
}

.json-key-value {
  background: var(--bg-hover);
  border-top: 1px solid var(--border-light);
}

.json-value-content {
  margin: 0;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 200px;
}

.json-value-content code {
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

/* Tables List */
.tables-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.table-item {
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.table-header {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  transition: background var(--duration-fast);
}

.table-header:hover {
  background: var(--bg-hover);
}

.table-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  margin-right: 6px;
  transition: transform var(--duration-fast);
}

.table-expanded .table-chevron {
  transform: rotate(90deg);
}

.table-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
}

.table-icon .icon {
  width: 16px;
  height: 16px;
  color: var(--primary);
}

.table-name {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.table-row-count {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.table-preview {
  background: var(--bg-hover);
  border-top: 1px solid var(--border-light);
  padding: 12px;
}

.table-preview-loading {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 16px 0;
}

.table-preview-wrapper {
  overflow-x: auto;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.preview-table th,
.preview-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-light);
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-table th {
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-muted);
  position: sticky;
  top: 0;
}

.preview-table td {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.preview-table tbody tr:hover {
  background: var(--bg-active);
}

.table-preview-more {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light);
}

.error-hint {
  font-size: 12px;
  color: var(--error);
  padding: 8px 0;
}

/* Preview Modal */
.preview-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-modal[hidden] {
  display: none;
}

.preview-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
}

.preview-modal-content {
  position: relative;
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalIn var(--duration-normal) var(--ease-out);
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.preview-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.preview-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.preview-modal-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.preview-modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.preview-modal-body {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-muted);
}

.preview-image-container {
  padding: 16px;
}

.preview-image {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border-radius: var(--radius-sm);
}

.preview-pdf {
  width: 80vw;
  height: 80vh;
  border: none;
}

.preview-video {
  max-width: 100%;
  max-height: 80vh;
}

.preview-audio-container {
  padding: 48px;
}

.preview-audio {
  width: 400px;
  max-width: 100%;
}

.preview-unsupported {
  padding: 48px;
  text-align: center;
  color: var(--text-secondary);
}

.preview-unsupported p {
  margin-bottom: 16px;
}

body.modal-open {
  overflow: hidden;
}

/* Integration row icon */
.integration-icon .icon {
  width: 18px;
  height: 18px;
}

/* Dark mode for new components */
[data-theme="dark"] .blob-preview-area {
  background: var(--bg-muted);
}

[data-theme="dark"] .json-value-content {
  background: var(--bg-canvas);
}
`;
