/**
 * Home page styles — Data connectors
 * @module design-system/pages/home/data-connectors
 */

/** CSS rules for: Data connectors */
export const dataConnectorsStyles = `/* ── Data connectors ────────────────────────────────── */
.connectors-panel {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
  padding: var(--space-6);
}
.connectors-head {
  display: flex; align-items: baseline; gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}
/* Keep the top panel's header clear of the fixed account pill (top-right). */
.view-users > .connectors-panel:first-child .connectors-head,
.view-connectors > .connectors-panel:first-child .connectors-head { padding-right: 210px; }
.connectors-sub { font-size: 0.82rem; color: var(--color-text-tertiary); }
.ws-conn-panel { margin-bottom: var(--space-5); }
.ws-conn-panel .connectors-head { justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
.ws-conn-add { padding: 7px 12px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: filter var(--duration-fast); white-space: nowrap; }
.ws-conn-add:hover { filter: brightness(1.05); }
.ws-conn-list { display: flex; flex-direction: column; gap: 0.4rem; }
.ws-conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-success); flex: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 18%, transparent); }
/* Connector catalog grid */
.ws-cat-grid { display: flex; flex-direction: column; gap: var(--space-5); }
.ws-cat-group { display: flex; flex-direction: column; gap: 0.6rem; }
.ws-cat-grouphead { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); }
.ws-cat-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 0.75rem; }
.ws-cat-card { display: flex; flex-direction: column; gap: 0.75rem; padding: 14px; border: 1px solid var(--glass-border); border-radius: var(--radius-lg, 14px); background: rgba(255,255,255,0.55); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.ws-cat-card:hover { border-color: color-mix(in srgb, var(--color-primary) 35%, var(--glass-border)); box-shadow: 0 6px 20px rgba(12,26,66,0.06); }
.ws-cat-card.is-connected { background: rgba(255,255,255,0.7); }
.ws-cat-top { display: flex; align-items: flex-start; gap: 0.65rem; }
.ws-cat-icon { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none; border-radius: 10px; background: color-mix(in srgb, var(--cx, var(--color-primary)) 12%, var(--color-bg-elevated)); color: var(--cx, var(--color-primary)); }
.ws-cat-icon svg { width: 20px; height: 20px; }
.ws-cat-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ws-cat-name { display: flex; align-items: center; gap: 0.4rem; font-weight: 700; font-size: 0.92rem; color: var(--color-text); }
.ws-cat-badge { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); padding: 2px 7px; border-radius: var(--radius-full); }
.ws-cat-tag { font-size: 0.76rem; color: var(--color-text-tertiary); line-height: 1.35; }
.ws-cat-body { margin-top: auto; }
.ws-cat-connect { width: 100%; padding: 8px 12px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: filter var(--duration-fast); }
.ws-cat-connect:hover { filter: brightness(1.05); }
.ws-cat-none { font-size: 0.78rem; color: var(--color-text-tertiary); }
.ws-cat-add { margin-top: 0.5rem; padding: 5px 0; border: none; background: none; font: inherit; font-size: 0.78rem; font-weight: 600; color: var(--color-primary); cursor: pointer; }
.ws-cat-add:hover { text-decoration: underline; }
.ws-cat-conns { display: flex; flex-direction: column; gap: 0.35rem; }
.ws-cc { border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: rgba(255,255,255,0.6); }
.ws-cc-main { display: flex; align-items: center; gap: 0.5rem; padding: 7px 10px; }
.ws-cc-name { font-weight: 600; font-size: 0.82rem; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-cc-used { margin-left: auto; border: none; background: none; padding: 0; font: inherit; font-size: 0.74rem; font-weight: 600; color: var(--color-primary); cursor: pointer; }
.ws-cc-info, .ws-cc-del { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.ws-cc-info { margin-left: auto; }
.ws-cc-used + .ws-cc-info { margin-left: 0; }
.ws-cc-info svg, .ws-cc-del svg { width: 15px; height: 15px; }
.ws-cc-info:hover { background: rgba(255,255,255,0.8); color: var(--color-text); }
.ws-cc-del:hover { background: var(--color-error); color: var(--color-text-inverse); }
.ws-cc-aq { margin-left: auto; border: 1px solid var(--color-border); background: transparent; border-radius: var(--radius-sm); padding: 2px 8px; font: inherit; font-size: 0.7rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast); }
.ws-cc-used + .ws-cc-aq { margin-left: 8px; }
.ws-cc-aq + .ws-cc-info { margin-left: 8px; }
.ws-cc-aq.on { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 45%, transparent); background: var(--color-success-light); }
.ws-cc-aq.off { color: var(--color-text-tertiary); }
.ws-cc-aq:hover { border-color: var(--color-primary); color: var(--color-primary); }
.ws-cc-detail-row { padding: 0 10px; border-top: 1px solid var(--glass-border); }
/* Connect drawer: test status, snippet, success */
.ws-add-test { margin-top: 0.5rem; font-size: 0.82rem; font-weight: 600; }
.ws-add-test.testing { color: var(--color-text-tertiary); }
.ws-add-test.ok { color: var(--color-success); }
.ws-add-test.bad { color: var(--color-error); }
.so-c-btn--ghost { background: transparent; border: 1px solid var(--glass-border); color: var(--color-text-secondary); }
.so-c-btn--ghost:hover { background: rgba(255,255,255,0.7); color: var(--color-text); }
.ws-add-done { display: flex; flex-direction: column; gap: 0.75rem; padding-top: 0.5rem; }
.ws-add-done-badge { font-size: 0.9rem; font-weight: 700; color: var(--color-success); }
.ws-add-done-badge.warn { color: var(--color-warning); }
.ws-snip { position: relative; }
.ws-snip-code { margin: 0; padding: 12px 14px; background: color-mix(in srgb, var(--color-primary) 88%, var(--color-text)); color: color-mix(in srgb, var(--color-primary-light) 85%, white); border-radius: var(--radius-md); font: 0.78rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
.ws-snip-copy { position: absolute; top: 8px; right: 8px; padding: 3px 10px; border: 1px solid color-mix(in srgb, var(--color-text-inverse) 25%, transparent); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-text-inverse) 12%, transparent); color: color-mix(in srgb, var(--color-primary-light) 85%, white); font: inherit; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
.ws-snip-copy:hover { background: rgba(255,255,255,0.22); }
.ws-add-donerow { display: flex; justify-content: flex-end; }
/* Rich connectors table */
.ws-conn-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--glass-border); border-radius: var(--radius-md); overflow: hidden; background: rgba(255,255,255,0.5); font-size: 0.86rem; }
.ws-conn-table thead th { text-align: left; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); padding: 9px 14px; background: rgba(255,255,255,0.4); border-bottom: 1px solid var(--glass-border); white-space: nowrap; }
.ws-conn-table th.wsc-status, .ws-conn-table td.wsc-status { width: 28px; padding-right: 0; }
.ws-conn-table th.wsc-actions, .ws-conn-table td.wsc-actions { text-align: right; white-space: nowrap; }
.wsc-row > td { padding: 11px 14px; border-bottom: 1px solid var(--glass-border); vertical-align: middle; }
.wsc-row:hover > td { background: rgba(255,255,255,0.55); }
.wsc-detail-row:last-child > td, .wsc-row:last-child > td { border-bottom: none; }
.wsc-name { font-weight: 600; color: var(--color-text); }
.wsc-provider { display: inline-block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-text-secondary); background: rgba(0,0,0,0.045); padding: 2px 9px; border-radius: var(--radius-full); }
.wsc-created { color: var(--color-text-tertiary); font-size: 0.8rem; white-space: nowrap; }
.wsc-muted { color: var(--color-text-tertiary); }
.wsc-used { border: none; background: none; padding: 0; font: inherit; font-size: 0.84rem; font-weight: 600; color: var(--color-primary); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.wsc-used:hover { filter: brightness(0.9); }
.wsc-act { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: none; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); vertical-align: middle; }
.wsc-act svg { width: 16px; height: 16px; }
.wsc-act:hover { background: rgba(255,255,255,0.7); color: var(--color-text); }
.wsc-act.danger:hover { background: var(--color-error); color: var(--color-text-inverse); }
.wsc-detail-row > td { padding: 0 14px; background: rgba(255,255,255,0.35); }
.wsc-arts { display: flex; flex-direction: column; gap: 0.3rem; padding-bottom: 4px; }
.wsc-art { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 8px 10px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); background: rgba(255,255,255,0.6); text-decoration: none; transition: background var(--duration-fast); }
.wsc-art:hover { background: var(--color-bg-elevated); }
.wsc-art-name { font-weight: 600; font-size: 0.84rem; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsc-art-meta { font-size: 0.74rem; color: var(--color-text-tertiary); white-space: nowrap; flex: none; }
.ws-conn-detail { padding: 8px 0 12px; font-size: 0.82rem; }
.ws-d-row { display: flex; gap: 0.75rem; padding: 4px 0; }
.ws-d-k { flex: none; width: 110px; color: var(--color-text-tertiary); font-weight: 600; }
.ws-d-v { color: var(--color-text); word-break: break-word; min-width: 0; }
.ws-d-sub { margin: 0.5rem 0 0.1rem; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-tertiary); }
.ws-d-note { margin-top: 0.6rem; font-size: 0.74rem; color: var(--color-text-tertiary); line-height: 1.4; }
.ws-add-note { font-size: 0.8rem; color: var(--color-text-secondary); margin: 0.5rem 0 0; line-height: 1.4; }

/* Workspace members (Users section) */
.ws-members-list { display: flex; flex-direction: column; gap: 0.5rem; }
.member-item { border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: rgba(255,255,255,0.5); padding: 10px 12px; display: flex; flex-direction: column; gap: 0.55rem; }
.member-main { display: flex; align-items: center; gap: 0.6rem; }
.member-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.82rem; flex: none; }
.member-id { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
.member-name { font-weight: 600; font-size: 0.88rem; color: var(--color-text); display: flex; align-items: center; gap: 0.4rem; }
.member-email { font-size: 0.76rem; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-pending { font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-warning); background: var(--color-warning-light, var(--color-warning-light)); padding: 1px 6px; border-radius: 999px; }
.member-role-static { font-size: 0.78rem; flex: none; color: var(--color-text-tertiary); font-weight: 600; text-transform: capitalize; }
/* Custom role selector — replaces the native <select> so the menu matches the
   app's design language instead of the browser's default dropdown. */
.role-select { position: relative; flex: none; }
.role-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 10px;
  border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.7); color: var(--color-text);
  font: inherit; font-size: 0.78rem; font-weight: 600; text-transform: capitalize;
  cursor: pointer; white-space: nowrap;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}
.role-trigger:hover { border-color: var(--color-text-tertiary); }
.role-select.open .role-trigger { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.role-caret { width: 13px; height: 13px; color: var(--color-text-secondary); transition: transform var(--duration-fast); }
.role-select.open .role-caret { transform: rotate(180deg); }
.role-menu {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 1200;
  min-width: 130px; padding: 4px;
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; gap: 1px;
}
.role-menu[hidden] { display: none; }
.role-menu-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  text-align: left; border: none; background: none; cursor: pointer;
  padding: 7px 9px; border-radius: var(--radius-sm); font: inherit; font-size: 0.82rem;
  color: var(--color-text);
}
.role-menu-item:hover { background: var(--color-surface); }
.role-menu-item.active { color: var(--color-primary); font-weight: 600; }
.role-check { width: 15px; height: 15px; color: var(--color-primary); opacity: 0; flex-shrink: 0; }
.role-menu-item.active .role-check { opacity: 1; }
.member-metrics { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.member-chip { font-size: 0.72rem; color: var(--color-text-secondary); background: rgba(0,0,0,0.035); border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
.member-chip b { color: var(--color-text); font-weight: 700; }
.member-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.member-act { font-size: 0.74rem; padding: 4px 9px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); background: rgba(255,255,255,0.7); color: var(--color-text-secondary); cursor: pointer; transition: all var(--duration-fast); }
.member-act:hover { background: var(--color-bg-elevated); color: var(--color-text); }
.member-act.danger:hover { background: var(--color-error); color: var(--color-text-inverse); border-color: var(--color-error); }
.member-token { margin: 0.5rem 0; padding: 10px 12px; background: var(--color-surface, var(--color-surface)); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); word-break: break-all; }
.member-token code { font-family: ui-monospace, monospace; font-size: 0.82rem; }
.member-invite-msg { font-size: 0.78rem; color: var(--color-text-secondary); margin: 0.4rem 0; min-height: 1rem; }
.ws-whitelist-row { display: flex; gap: 0.5rem; align-items: center; }
.ws-whitelist-row .so-c-input { flex: 1; }
.ws-publish-policy { display: flex; flex-direction: column; gap: var(--space-4); max-width: 460px; }
.ws-publish-row { display: flex; gap: 0.5rem; align-items: center; }
.ws-publish-row .so-c-input { flex: 1; }
.ws-publish-label { font-size: 0.82rem; color: var(--color-text-secondary); white-space: nowrap; }
.ws-publish-n { flex: 0 0 5rem; }
.appr-picker .appr-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.6rem 0; min-height: 1.6rem; }
.appr-chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); background: var(--color-primary-light); color: var(--color-text-primary); font-size: 0.82rem; }
.appr-chip button { background: none; border: 0; color: inherit; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; }
.appr-chip-empty { font-size: 0.82rem; color: var(--color-text-secondary); }
.appr-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: var(--space-4); }
.ws-branding { display: flex; flex-direction: column; gap: var(--space-5); }
.ws-brand-field { display: flex; flex-direction: column; gap: 0.4rem; }
.ws-brand-logo { display: flex; align-items: center; gap: 0.75rem; }
.ws-brand-preview { width: 120px; height: 56px; object-fit: contain; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); padding: 6px; }
.ws-brand-preview-empty { display: inline-flex; align-items: center; justify-content: center; font-size: 0.78rem; color: var(--color-text-tertiary); }
.ws-brand-hint { font-size: 0.76rem; color: var(--color-text-tertiary); }
.ws-brand-color { display: flex; align-items: center; gap: 0.5rem; }
.ws-brand-color input[type="color"] { width: 40px; height: 36px; padding: 2px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); background: none; cursor: pointer; }
.ws-brand-hex { width: 110px; font-family: ui-monospace, monospace; }
.ws-brand-check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--color-text-secondary); cursor: pointer; }
.ws-brand-actions { display: flex; align-items: center; gap: 0.75rem; }
.connectors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
}
.connector {
  display: flex; align-items: center; gap: 0.625rem;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  cursor: pointer; text-align: left;
  font: inherit;
  transition: transform var(--duration-normal), box-shadow var(--duration-normal), background var(--duration-normal), border-color var(--duration-normal);
}
.connector:hover:not(:disabled) { background: rgba(255, 255, 255, 0.72); }
.connector:hover:not(:disabled) { border-color: var(--color-primary); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.connector-icon {
  width: 32px; height: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--cx) 14%, transparent);
  color: var(--cx);
}
.connector-icon svg { width: 18px; height: 18px; }
.connector-name {
  flex: 1; min-width: 0;
  font-size: 0.88rem; font-weight: 600; color: var(--color-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.connector.is-soon { cursor: default; opacity: 0.55; }
.connector.is-soon .connector-icon { background: var(--color-surface); color: var(--color-text-tertiary); }
.connector-soon {
  flex-shrink: 0;
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  background: var(--color-surface);
  padding: 2px 6px; border-radius: var(--radius-full);
}

`;
