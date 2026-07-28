/**
 * ShareOut Visual Editor styles — Artifact details panel inside the workspace drawer
 * @module editor/page/styles/sections/artifact-details-drawer
 */

/** CSS for the artifact details drawer section of the visual editor. */
export const artifactDetailsDrawerCss = `

/* ==========================================================================
   10b. ARTIFACT DETAILS PANEL
   ========================================================================== */
.details-panel {
  display: flex;
  flex-direction: column;
}

.details-section {
  padding: 16px 0;
  border-bottom: 1px solid var(--border-light);
}

.details-section:first-child {
  padding-top: 0;
}

.details-section:last-child {
  border-bottom: none;
}

.details-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.details-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 12px 0;
}

.details-section-header .details-section-title {
  margin-bottom: 0;
}

.section-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

/* Info grid */
.info-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 28px;
}

.info-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.info-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  text-align: right;
}

.info-mono {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-hover);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
}

/* Status pills */
.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 600;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.status-private {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.status-unlisted {
  background: var(--warning-soft);
  color: var(--warning);
}

.status-public {
  background: var(--success-soft);
  color: var(--success);
}

.status-connected {
  background: var(--success-soft);
  color: var(--success);
}

.status-disconnected {
  background: var(--bg-hover);
  color: var(--text-muted);
}

/* Storage grid */
.storage-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.storage-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 10px;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  text-align: center;
}

.storage-icon {
  font-size: 18px;
  margin-bottom: 6px;
}

.storage-label {
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.storage-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

/* Files list */
.files-list {
  max-height: 180px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}

.file-item:last-child {
  border-bottom: none;
}

.file-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  font-size: 10px;
  color: var(--text-muted);
}

/* Collaborators list */
.collab-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.collab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.collab-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.collab-info {
  flex: 1;
  min-width: 0;
}

.collab-email {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collab-role {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: capitalize;
}

/* Integration row */
.integration-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
}

.integration-icon {
  font-size: 18px;
}

.integration-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

/* Attached skills */
.skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  text-decoration: none;
}

.skill-chip:hover {
  border-color: var(--accent, #2563eb);
}

.skill-chip .icon {
  width: 13px;
  height: 13px;
  color: var(--text-secondary);
}

/* Loading skeleton */
.details-loading {
  padding: 8px 0;
}

.skeleton-line {
  background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border-light) 50%, var(--bg-hover) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}

.skeleton-title {
  height: 20px;
  width: 50%;
  margin-bottom: 16px;
}

.skeleton-row {
  height: 36px;
  width: 100%;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Error state */
.details-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.details-error .error-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--error-soft);
  color: var(--error);
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.details-error .error-message {
  color: var(--text-secondary);
  margin-bottom: 16px;
  font-size: 14px;
}

/* EDIT-08 Stage A: editable visibility + management actions in the Details panel */
.details-select {
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  cursor: pointer;
}

.details-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
`;
