/**
 * Home page styles — Skill Marketplace
 * @module design-system/pages/home/skill-marketplace
 */

/** CSS rules for: Skill Marketplace */
export const skillMarketplaceStyles = `/* Skill Marketplace */
.lib-segments {
  display: inline-flex; gap: 2px; margin: 0 0 18px; padding: 3px;
  background: rgba(255, 255, 255, 0.5); border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
}
.lib-seg {
  border: none; background: transparent; padding: 7px 18px; border-radius: var(--radius-full);
  font: 600 0.88rem var(--font-body); color: var(--color-text-secondary); cursor: pointer;
  transition: background var(--duration-normal), color var(--duration-normal);
}
.lib-seg:hover { color: var(--color-text); }
.lib-seg.active { background: var(--color-bg-elevated); color: var(--color-primary); box-shadow: var(--shadow-sm); }
.lib-seg:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.lib-section[hidden] { display: none; }
.lib-sec-note { margin: 0 0 16px; }
.sk-market-toolbar { padding: 0 0 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.sk-market-tabs { display: inline-flex; gap: 2px; padding: 3px; background: rgba(255, 255, 255, 0.5); border: 1px solid var(--glass-border); border-radius: var(--radius-full); }
.sk-market-tab {
  border: none; background: transparent; padding: 6px 14px; border-radius: var(--radius-full);
  font: 600 0.82rem var(--font-body, sans-serif); color: var(--color-text-secondary); cursor: pointer;
  transition: background var(--duration-normal), color var(--duration-normal);
}
.sk-market-tab:hover { color: var(--color-text); }
.sk-market-tab.active { background: var(--color-bg-elevated); color: var(--color-primary); box-shadow: var(--shadow-sm); }
.sk-market-tab:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.sk-market-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.lib-modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,0.45); }
.lib-modal[hidden] { display: none; }
.lib-modal-card { width: 100%; max-width: 640px; max-height: 90vh; overflow-y: auto; background: var(--surface, var(--color-bg-elevated)); border: 1px solid var(--border, var(--color-border)); border-radius: 14px; padding: 22px; }
.lib-modal-head { display: flex; align-items: center; justify-content: space-between; }
.lib-modal-head h3 { margin: 0; font: 700 1.1rem var(--font-display, sans-serif); }
.lib-modal-x { border: none; background: transparent; font-size: 24px; line-height: 1; color: var(--text-muted, var(--color-text-tertiary)); cursor: pointer; padding: 0 4px; }
.lib-form { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
.lib-field-row { display: flex; gap: 12px; flex-wrap: wrap; }
.lib-field-row .lib-field { flex: 1; min-width: 140px; }
.lib-field { display: flex; flex-direction: column; gap: 5px; }
.lib-field > span { font-size: 0.78rem; font-weight: 600; color: var(--text-muted, var(--color-text-tertiary)); }
.lib-field input, .lib-field select, .lib-field textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-sm, 8px); background: var(--bg, var(--color-bg)); color: var(--text, var(--color-text)); font: inherit; font-size: 0.85rem;
}
.lib-field textarea { font-family: var(--font-mono, monospace); resize: vertical; }
.lib-form-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 4px; }
.lib-form-msg { font-size: 0.8rem; color: var(--color-danger, #c0392b); margin-right: auto; }
.lib-form-msg.ok { color: var(--color-success, #2e7d32); }
.sk-card {
  display: flex; flex-direction: column; gap: 10px;
  background: var(--surface, var(--color-bg-elevated)); border: 1px solid var(--border, var(--color-border));
  border-radius: 12px; padding: 16px;
}
.sk-card-head { display: flex; align-items: center; gap: 8px; }
.sk-card-title { font: 600 0.95rem var(--font-display, sans-serif); color: var(--text, var(--color-text)); text-decoration: none; }
.sk-card-title:hover { text-decoration: underline; }
.sk-card-sum { font-size: 0.84rem; color: var(--text-muted, var(--color-text-tertiary)); margin: 0; line-height: 1.45; }
.sk-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.sk-chip { font-size: 0.72rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--surface-2, var(--color-surface)); color: var(--text-muted, var(--color-text-tertiary)); }
.sk-chip.sk-tag { background: transparent; border: 1px solid var(--border, var(--color-border)); }
.sk-chip.sk-feat { background: var(--color-warning-light); color: var(--color-warning); }
.sk-card-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.sk-card-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px;
  border: 1px solid var(--border, var(--color-border)); border-radius: 7px; background: var(--surface, var(--color-bg-elevated));
  font: 600 0.78rem var(--font-body, sans-serif); color: var(--text, var(--color-text)); cursor: pointer;
}
.sk-card-btn:hover:not(:disabled) { border-color: var(--text-muted, var(--color-text-tertiary)); }
.sk-card-btn.active { color: var(--primary, var(--color-primary)); border-color: var(--primary, var(--color-primary)); }
.sk-stat { font-size: 0.78rem; color: var(--text-muted, var(--color-text-tertiary)); }
.stats-skills { margin-top: 20px; }
.sk-attached-list { margin-bottom: 10px; }
.sk-chip.sk-attached { display: inline-flex; align-items: center; gap: 4px; background: var(--surface-2, var(--color-surface)); }
.sk-detach { border: none; background: none; cursor: pointer; color: var(--text-muted, var(--color-text-tertiary)); font-size: 0.9rem; line-height: 1; padding: 0; }
.sk-detach:hover { color: var(--color-error); }
.sk-attach-row { display: flex; gap: 8px; align-items: center; }
.sk-attach-sel { flex: 1; padding: 6px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: 7px; font: 500 0.82rem var(--font-body, sans-serif); background: var(--surface, var(--color-bg-elevated)); color: var(--text, var(--color-text)); }
`;
