/**
 * Viewer toolbar styles — Floating toolbar shell, buttons, trigger, and avatar
 * @module serve/sandbox-viewer/toolbar/styles/toolbar-shell
 */

/** CSS rules for: Floating toolbar shell, buttons, trigger, and avatar */
export const toolbarShellStyles = `
    #shareout-admin-toolbar {
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 10000;
      font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
    }
    #shareout-admin-toolbar.so-pos-br { top: auto; left: auto; bottom: 20px; right: 20px; flex-direction: row; }
    #shareout-admin-toolbar.so-pos-bl { top: auto; right: auto; bottom: 20px; left: 20px; flex-direction: row-reverse; }
    #shareout-admin-toolbar.so-pos-tr { bottom: auto; left: auto; top: 20px; right: 20px; flex-direction: row; }
    #shareout-admin-toolbar.so-pos-tl { bottom: auto; right: auto; top: 20px; left: 20px; flex-direction: row-reverse; }
    #shareout-admin-toolbar.so-dragging { transition: none; user-select: none; }
    #shareout-admin-toolbar.so-dragging #so-toolbar-trigger { cursor: grabbing; box-shadow: 0 12px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1); }
    #so-toolbar-items {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .so-toolbar-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 18px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: var(--color-text);
      text-decoration: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
      border: 1px solid rgba(231, 229, 228, 0.6);
      cursor: pointer;
      opacity: 0;
      transform: translateX(10px) scale(0.88);
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.15s ease, box-shadow 0.15s ease;
    }
    #shareout-admin-toolbar.so-open .so-toolbar-btn {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
    /* When closed, items take no layout space so the toolbar box equals the
       44px trigger — keeps disabled buttons hidden and drag clamping correct. */
    #shareout-admin-toolbar:not(.so-open) #so-toolbar-items {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
    }
    #shareout-admin-toolbar.so-open .so-toolbar-btn.is-disabled { opacity: 0.45; }
    .so-toolbar-btn:hover {
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);
      transform: translateY(-1px) !important;
    }
    .so-toolbar-btn svg { color: var(--color-text-secondary); }
    .so-toolbar-btn:hover svg { color: var(--color-text); }
    .so-toolbar-btn.is-disabled {
      opacity: 0;
      color: var(--color-text-tertiary);
      cursor: not-allowed;
      pointer-events: none;
      transform: none !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .so-toolbar-btn.is-disabled svg { color: var(--color-text-tertiary); }
    .so-toolbar-btn.is-disabled:hover {
      background: rgba(255, 255, 255, 0.85);
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      transform: none !important;
    }
    .so-fav-btn.active { color: var(--color-text); }
    .so-fav-btn.active svg { color: var(--color-warning); fill: var(--color-warning); }
    .so-avatar-btn { padding-left: 6px !important; }
    .so-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      overflow: hidden;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-border);
      color: var(--color-text-secondary);
      font-size: 10px;
      font-weight: 600;
    }
    .so-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .so-avatar-fallback { line-height: 1; }
    .so-avatar-lg { width: 40px; height: 40px; font-size: 15px; }
    .so-admin-user {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--color-surface);
    }
    .so-admin-user-meta { display: flex; flex-direction: column; min-width: 0; }
    .so-admin-user-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .so-admin-user-email { font-size: 12px; color: var(--color-text-tertiary); }
    #so-toolbar-trigger {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid rgba(231, 229, 228, 0.6);
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      position: relative;
      transition: box-shadow 0.15s ease, background 0.15s ease;
    }
    #so-toolbar-trigger:hover {
      background: rgba(255, 255, 255, 1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08);
    }
    #so-toolbar-trigger .so-trig-icon {
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    #so-toolbar-trigger .so-trig-logo {
      display: block;
      width: 24px;
      height: 24px;
      object-fit: contain;
    }
    #so-toolbar-trigger.so-spin .so-trig-icon {
      animation: so-trig-spin 0.6s cubic-bezier(0.34, 1.4, 0.5, 1);
    }
    @keyframes so-trig-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    #so-toolbar-trigger:hover .so-trig-icon { color: var(--color-text); }
    #so-trig-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      font-size: 11px;
      font-weight: 600;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--color-bg-elevated);
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    #shareout-admin-toolbar.so-open #so-trig-badge {
      opacity: 0;
    }

`;
