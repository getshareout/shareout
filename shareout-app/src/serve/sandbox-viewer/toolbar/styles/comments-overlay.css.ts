/**
 * Viewer toolbar styles — Comments panel, pins, and composer
 * @module serve/sandbox-viewer/toolbar/styles/comments-overlay
 */

/** CSS rules for: Comments panel, pins, and composer */
export const commentsOverlayStyles = `    #so-comments-overlay {
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: none;
      align-items: stretch;
      justify-content: flex-end;
      font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
    }
    #so-comments-overlay.open { display: flex; }
    #so-comments-overlay .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(28, 25, 23, 0.2);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #so-comments-panel {
      position: relative;
      width: 400px;
      max-width: 90vw;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: -8px 0 40px rgba(0,0,0,0.12);
      border-left: 1px solid rgba(231, 229, 228, 0.6);
      animation: soSlideIn 0.25s ease-out;
    }
    @keyframes soSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      #so-comments-panel { animation: none; }
    }
    .so-cmt-tabs {
      display: flex;
      gap: 4px;
      padding: 0 24px;
      border-bottom: 1px solid var(--color-border);
    }
    .so-cmt-tab {
      padding: 12px 4px;
      margin-right: 16px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-secondary);
      cursor: pointer;
    }
    .so-cmt-tab.active { color: var(--color-text); border-bottom-color: var(--color-primary); }
    .so-cmt-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .so-cmt-card {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 14px 16px;
      box-shadow: 0 1px 2px rgba(28,25,23,0.04);
    }
    .so-cmt-card.resolved { opacity: 0.6; }
    .so-cmt-card.pending { opacity: 0.55; }
    .so-cmt-agent {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--color-primary-light);
      color: var(--color-primary);
      vertical-align: middle;
    }
    .so-cmt-reactions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .so-cmt-react-chip, .so-cmt-react-add, .so-cmt-react-opt {
      border: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
      border-radius: 999px;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      color: var(--color-text-secondary);
    }
    .so-cmt-react-chip { padding: 4px 9px; font-weight: 500; }
    .so-cmt-react-chip.mine { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); }
    .so-cmt-react-add { padding: 4px 8px; color: var(--color-text-tertiary); }
    .so-cmt-react-add:hover { color: var(--color-text); }
    .so-cmt-react-picker { display: none; gap: 4px; }
    .so-cmt-react-picker.open { display: inline-flex; }
    .so-cmt-react-opt { padding: 4px 7px; border-radius: 8px; }
    .so-cmt-react-opt:hover { background: var(--color-surface); }
    @keyframes soCmtNew {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .so-cmt-card.so-cmt-new { animation: soCmtNew 0.22s ease-out; }
    @media (prefers-reduced-motion: reduce) { .so-cmt-card.so-cmt-new { animation: none; } }
    .so-cmt-presence {
      display: none;
      margin-left: 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--color-text-tertiary);
      vertical-align: middle;
    }
    .so-cmt-presence.show { display: inline; }
    .so-cmt-presence::before {
      content: '';
      display: inline-block;
      width: 7px; height: 7px;
      margin-right: 5px;
      border-radius: 50%;
      background: var(--color-success);
      vertical-align: middle;
    }
    .so-cmt-typing {
      display: none;
      padding: 4px 24px;
      font-size: 12px;
      font-style: italic;
      color: var(--color-text-tertiary);
    }
    .so-cmt-typing.show { display: block; }
    @keyframes soCmtFlash {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.18); }
    }
    .so-toolbar-btn.so-cmt-flash { animation: soCmtFlash 0.6s ease; }
    .so-cmt-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .so-cmt-avatar {
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
      flex-shrink: 0;
    }
    .so-cmt-author { font-size: 14px; font-weight: 600; color: var(--color-text); }
    .so-cmt-time { font-size: 12px; color: var(--color-text-tertiary); }
    .so-cmt-body {
      font-size: 14px;
      line-height: 1.5;
      color: var(--color-text);
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .so-cmt-mention {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--color-primary-light);
      color: var(--color-primary);
      font-weight: 500;
      font-size: 13px;
    }
    .so-cmt-actions {
      display: flex;
      gap: 14px;
      margin-top: 10px;
    }
    .so-cmt-action {
      background: none;
      border: none;
      padding: 0;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
      cursor: pointer;
    }
    .so-cmt-action:hover { color: var(--color-text); }
    .so-cmt-action.resolved { color: var(--color-success); }
    .so-cmt-replies {
      margin-top: 10px;
      padding-left: 14px;
      border-left: 2px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .so-cmt-composer {
      border-top: 1px solid var(--color-border);
      padding: 16px 24px;
      position: relative;
      background: rgba(250, 250, 249, 0.6);
    }
    .so-cmt-textarea {
      width: 100%;
      min-height: 56px;
      max-height: 160px;
      resize: vertical;
      padding: 12px 14px;
      border: 1px solid var(--color-border-strong);
      border-radius: 12px;
      font-family: inherit;
      font-size: 14px;
      color: var(--color-text);
      background: var(--color-bg-elevated);
      outline: none;
    }
    .so-cmt-textarea:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
    .so-cmt-composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
    }
    .so-cmt-replying {
      font-size: 13px;
      color: var(--color-text-secondary);
    }
    .so-cmt-replying button {
      background: none;
      border: none;
      color: var(--color-primary);
      cursor: pointer;
      font-size: 13px;
    }
    .so-cmt-submit {
      padding: 9px 18px;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      min-height: 40px;
    }
    .so-cmt-submit:hover { background: var(--color-primary-hover); }
    .so-cmt-submit:disabled { opacity: 0.5; cursor: default; }
    .so-cmt-mentionbox {
      position: absolute;
      left: 24px;
      right: 24px;
      bottom: 100%;
      margin-bottom: 4px;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      max-height: 200px;
      overflow-y: auto;
      display: none;
    }
    .so-cmt-mentionbox.open { display: block; }
    .so-cmt-mention-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
    }
    .so-cmt-mention-item:hover, .so-cmt-mention-item.active { background: var(--color-surface); }
    .so-cmt-mention-name { font-size: 14px; color: var(--color-text); }
    .so-cmt-mention-email { font-size: 12px; color: var(--color-text-tertiary); }
    .so-cmt-empty { text-align: center; padding: 40px 24px; color: var(--color-text-secondary); font-size: 14px; }
    .so-cmt-loading { text-align: center; padding: 40px; color: var(--color-text-secondary); }
    #so-pins-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9999;
    }
    .so-pin {
      position: absolute;
      width: 26px;
      height: 26px;
      margin-left: -13px;
      margin-top: -26px;
      border-radius: 50% 50% 50% 2px;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      border: 2px solid var(--color-bg-elevated);
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
      transform: rotate(-45deg);
      transition: transform 0.1s ease-out;
    }
    .so-pin span { transform: rotate(45deg); }
    .so-pin:hover { transform: rotate(-45deg) scale(1.12); }
    .so-pin.resolved { background: var(--color-success); }
    .so-cmt-pinbtn {
      background: none;
      border: 1px solid var(--color-border-strong);
      border-radius: 10px;
      padding: 7px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .so-cmt-pinbtn:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .so-cmt-pinbtn.armed { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
    .so-cmt-pinbtn.placed { border-color: var(--color-success); color: var(--color-success); background: var(--color-success-light); }
    .so-cmt-card.action-item { border-left: 3px solid var(--color-primary); }
    .so-cmt-assignee { font-size: 12px; color: var(--color-text-secondary); margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .so-cmt-due { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--color-surface); color: var(--color-text-secondary); border: 1px solid var(--color-border); }
    .so-cmt-due.overdue { background: var(--color-error-light); color: var(--color-error); border-color: var(--color-error); }
    .so-cmt-assign-picker { position: absolute; right: 24px; z-index: 10; min-width: 220px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: none; padding: 8px 0; }
    .so-cmt-assign-picker.open { display: block; }
    .so-cmt-assign-list { max-height: 180px; overflow-y: auto; }
    .so-cmt-assign-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; color: var(--color-text); }
    .so-cmt-assign-item:hover, .so-cmt-assign-item.active { background: var(--color-surface); }
    .so-cmt-assign-item.active { font-weight: 600; }
    .so-cmt-assign-unassign { color: var(--color-text-secondary); border-top: 1px solid var(--color-border); }
    .so-cmt-assign-due { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--color-border); font-size: 13px; }
    .so-cmt-assign-due label { display: flex; align-items: center; gap: 6px; flex: 1; color: var(--color-text-secondary); }
    .so-cmt-assign-due input[type=date] { border: 1px solid var(--color-border); border-radius: 6px; padding: 3px 6px; font-size: 12px; background: var(--color-bg-elevated); color: var(--color-text); }
    @keyframes soCmtHighlight { 0%,100% { box-shadow: none; } 30% { box-shadow: 0 0 0 3px var(--color-primary); } }
    .so-cmt-card.so-cmt-highlight { animation: soCmtHighlight 1.8s ease; }

`;
