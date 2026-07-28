/**
 * Viewer toolbar styles — Artifact admin properties overlay
 * @module serve/sandbox-viewer/toolbar/styles/admin-overlay
 */

/** CSS rules for: Artifact admin properties overlay */
export const adminOverlayStyles = `    #so-admin-overlay {
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: none;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 20px;
      font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
    }
    #so-admin-overlay.open { display: flex; }
    #so-admin-overlay .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(28, 25, 23, 0.2);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #so-admin-panel {
      position: relative;
      width: 380px;
      max-height: calc(100vh - 40px);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08);
      border: 1px solid rgba(231, 229, 228, 0.5);
      overflow: hidden;
      animation: slideUp 0.25s ease-out;
    }
    .so-prop-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid var(--color-surface);
    }
    .so-prop-row:last-child { border-bottom: none; }
    .so-prop-label {
      font-size: 14px;
      color: var(--color-text-secondary);
    }
    .so-prop-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text);
      text-align: right;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .so-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
    }
    .so-badge-public { background: var(--color-success-light); color: color-mix(in srgb, var(--color-success) 75%, var(--color-text)); }
    .so-badge-private { background: var(--color-warning-light); color: color-mix(in srgb, var(--color-warning) 80%, var(--color-text)); }
    .so-badge-unlisted { background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-elevated)); color: var(--color-primary-hover); }
    .so-badge-active { background: var(--color-success-light); color: color-mix(in srgb, var(--color-success) 75%, var(--color-text)); }
    .so-badge-paused { background: var(--color-error-light); color: var(--color-error); }
    .so-conn-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .so-conn-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 11px;
      background: var(--color-bg);
      border: 1px solid var(--color-surface);
      border-radius: 10px;
    }
    .so-conn-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .so-conn-meta {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 500;
      color: var(--color-text-secondary);
      text-align: right;
      max-width: 55%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .so-collab-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
    }
    .so-collab-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      background: var(--color-bg);
      border-radius: 8px;
      border: 1px solid var(--color-border);
    }
    .so-collab-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--color-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: var(--color-text-secondary);
    }
    .so-collab-email {
      flex: 1;
      font-size: 13px;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .so-collab-role {
      font-size: 11px;
      color: var(--color-text-tertiary);
      text-transform: uppercase;
    }
    .so-url-box {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      padding: 10px 12px;
      background: var(--color-bg);
      border-radius: 8px;
      border: 1px solid var(--color-border);
    }
    .so-url-text {
      flex: 1;
      font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .so-url-copy {
      padding: 4px 8px;
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      font-size: 12px;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }
    .so-url-copy:hover {
      background: var(--color-surface);
      color: var(--color-text);
    }
    .so-cmt-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }
`;
