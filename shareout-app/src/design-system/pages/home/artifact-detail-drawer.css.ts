/**
 * Home page styles — Artifact detail drawer
 * @module design-system/pages/home/artifact-detail-drawer
 */

/** CSS rules for: Artifact detail drawer */
export const artifactDetailDrawerStyles = `/* ── Artifact detail drawer ─────────────────────────── */
.drawer-overlay { position: fixed; inset: 0; z-index: 1200; display: none; }
.drawer-overlay.open { display: block; }
.drawer-backdrop { position: absolute; inset: 0; background: rgba(28, 25, 23, 0.18); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.detail-drawer {
  /* Drawer-scoped contrast tokens: warm near-black hairlines + a tinted surface
     read against the near-white glass drawer (the global white-on-white
     --glass-border does not). Stay translucent to keep the glass language. */
  --detail-hairline: rgba(28, 25, 23, 0.10);
  --detail-hairline-strong: rgba(28, 25, 23, 0.14);
  --detail-surface: rgba(245, 245, 244, 0.66);
  --detail-surface-hover: rgba(245, 245, 244, 0.92);
  position: absolute; top: var(--space-4); right: var(--space-4); bottom: var(--space-4);
  width: 480px; max-width: calc(100vw - var(--space-8));
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: var(--glass-blur-lg);
  -webkit-backdrop-filter: var(--glass-blur-lg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow), -28px 0 64px -32px rgba(28, 25, 23, 0.32);
  display: flex; flex-direction: column; overflow: hidden;
  transform: translateX(calc(100% + var(--space-5)));
  transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer-overlay.open .detail-drawer { transform: translateX(0); }
/* Grab handle for the mobile bottom-sheet (hidden on desktop). The 22px row is
   the touch zone; the visible 40×4 pill is drawn with ::before. */
.drawer-grip { display: none; flex: none; height: 22px; cursor: grab; touch-action: none; }
.drawer-grip::before { content: ""; display: block; width: 40px; height: 4px; margin: 9px auto 0; border-radius: 999px; background: rgba(28, 25, 23, 0.18); }
/* Primary "open the live artifact" action at the top of the detail panel —
   the one clear way out of the drawer and into the artifact. */
.detail-open-cta {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 16px; border-radius: var(--radius-lg);
  background: var(--color-primary); color: var(--color-text-inverse);
  font-weight: 600; font-size: 0.92rem; text-decoration: none;
  box-shadow: var(--shadow-sm); transition: filter var(--duration-fast);
}
.detail-open-cta svg { width: 18px; height: 18px; }
.detail-open-cta:hover { filter: brightness(1.05); }
/* Add-connector drawer (picker → config) */
.conn-add-head-l { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.conn-add-head-l b { font-size: 0.98rem; }
.conn-back { border: none; background: none; padding: 0; font: inherit; font-size: 0.84rem; font-weight: 600; color: var(--color-text-secondary); cursor: pointer; }
.conn-back:hover { color: var(--color-text); }
.conn-picker-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-3); }
.conn-picker-grid .connector { background: rgba(255,255,255,0.55); }
.detail-foot { display: flex; gap: 0.5rem; padding: var(--space-4) var(--space-5); border-top: 1px solid var(--detail-hairline); flex-shrink: 0; }
.detail-foot .so-c-btn { flex: 1; }
.detail-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.detail-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--detail-hairline);
  flex-shrink: 0;
}
.detail-type {
  display: inline-flex; align-items: center;
  padding: 3px 11px; border-radius: var(--radius-full);
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--type-color, var(--color-primary));
  background: color-mix(in srgb, var(--type-color, var(--color-primary)) 14%, transparent);
}
.detail-head-actions { display: flex; align-items: center; gap: 0.15rem; }
.detail-icon {
  width: 32px; height: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--radius-md);
  background: transparent; color: var(--color-text-secondary);
  text-decoration: none; cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.detail-icon svg { width: 17px; height: 17px; }
.detail-icon:hover { background: rgba(255, 255, 255, 0.6); color: var(--color-text); }
.detail-icon.is-disabled {
  opacity: 0.4;
  color: var(--color-text-tertiary);
  cursor: not-allowed;
  pointer-events: none;
}
.detail-icon.is-disabled:hover { background: transparent; color: var(--color-text-tertiary); }
.detail-icon.danger:hover { background: var(--color-error); color: var(--color-text-inverse); }
.detail-head-sep { width: 1px; height: 18px; background: var(--detail-hairline-strong); margin: 0 0.2rem; flex-shrink: 0; }
.detail-regen.loading svg { animation: spin 0.9s linear infinite; }
.detail-regen:hover svg { transform: rotate(-35deg); }
.detail-regen svg { transition: transform var(--duration-fast); }
@keyframes spin { to { transform: rotate(360deg); } }

.detail-scroll { overflow-y: auto; padding: var(--space-5) var(--space-5) var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); }
.detail-scroll .so-c-input { border-color: var(--detail-hairline); background: var(--detail-surface); }

/* Full-bleed header media with overlaid controls */
.detail-media { position: relative; flex-shrink: 0; height: 150px; overflow: hidden; background: linear-gradient(135deg, color-mix(in srgb, var(--type-color) 16%, var(--color-surface)) 0%, var(--color-surface) 100%); }
.detail-media-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.detail-media::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to bottom, rgba(28,25,23,0.28) 0%, rgba(28,25,23,0) 32%, rgba(28,25,23,0) 72%, rgba(28,25,23,0.10) 100%); }
.detail-media .detail-type { position: absolute; top: 12px; left: 14px; z-index: 2; background: rgba(255,255,255,0.92); box-shadow: var(--shadow-sm); }
.detail-media-actions { position: absolute; top: 9px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: var(--radius-full); background: rgba(255,255,255,0.80); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: var(--shadow-sm); }
.detail-media-actions .detail-icon { width: 30px; height: 30px; }
.detail-media-actions .detail-icon:hover { background: rgba(28,25,23,0.10); }

/* Title row + visibility icon toggle */
.detail-titlebar { display: flex; align-items: flex-start; gap: 0.5rem; }
.detail-title-input { flex: 1; min-width: 0; padding: 2px 0; border: none; background: transparent; font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; color: var(--color-text); border-bottom: 1px solid transparent; transition: border-color var(--duration-fast); }
.detail-title-input:focus { outline: none; border-bottom-color: var(--color-primary); }
.detail-title-static { flex: 1; min-width: 0; font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; color: var(--color-text); }
.detail-vis-toggle { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--detail-hairline); border-radius: var(--radius-md); background: var(--detail-surface); color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast), transform var(--duration-fast); }
.detail-vis-toggle svg { width: 16px; height: 16px; }
.detail-vis-toggle:hover { background: var(--detail-surface-hover); color: var(--color-text); border-color: var(--detail-hairline-strong); }
.detail-vis-toggle:active { transform: scale(0.94); }
.detail-vis-toggle.is-ws { background: var(--color-primary-light); border-color: transparent; color: var(--color-primary); }
.detail-vis-toggle.is-static { cursor: default; }
.detail-vis-toggle.is-static:hover { background: var(--detail-surface); color: var(--color-text-secondary); border-color: var(--detail-hairline); }
.detail-vis-toggle.is-static.is-ws:hover { background: var(--color-primary-light); color: var(--color-primary); }

/* Description (inline editable) */
.detail-desc { width: 100%; resize: none; overflow: hidden; border: none; background: transparent; padding: 0; margin: -2px 0 0; font: inherit; font-size: 0.9rem; line-height: 1.45; color: var(--color-text-secondary); }
.detail-desc::placeholder { color: var(--color-text-tertiary); }
.detail-desc:focus { outline: none; }
textarea.detail-desc:focus { color: var(--color-text); }
.detail-desc-static { white-space: pre-wrap; }

/* Owner + KPI chips */
.detail-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.detail-meta-row .card-owner { margin-top: 0; }
.detail-kpis { display: inline-flex; align-items: center; gap: 6px; }
.detail-kpis[role="button"] { cursor: pointer; }
.detail-kpi { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid var(--detail-hairline); border-radius: var(--radius-full); background: var(--detail-surface); color: var(--color-text-secondary); font-size: 0.8rem; transition: background var(--duration-fast), border-color var(--duration-fast); }
.detail-kpi svg { width: 14px; height: 14px; }
.detail-kpi b { font-weight: 700; color: var(--color-text); }
.detail-kpis[role="button"]:hover .detail-kpi { border-color: var(--detail-hairline-strong); background: var(--detail-surface-hover); }

/* Link row + icon buttons */
.detail-link { display: flex; gap: 0.5rem; }
.detail-link input { flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--detail-hairline); border-radius: var(--radius-md); font: inherit; font-size: 0.82rem; color: var(--color-text); background: var(--detail-surface); }
.detail-link input:focus { outline: none; border-color: var(--color-primary); }
.detail-iconbtn { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 38px; border: none; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); cursor: pointer; transition: background var(--duration-fast), transform var(--duration-fast); }
.detail-iconbtn svg { width: 16px; height: 16px; }
.detail-iconbtn:hover { background: var(--color-primary-hover); }
.detail-iconbtn:active { transform: scale(0.94); }
.detail-iconbtn.sm { width: 28px; height: 26px; background: var(--detail-surface); color: var(--color-text-secondary); border: 1px solid var(--detail-hairline); }
.detail-iconbtn.sm svg { width: 14px; height: 14px; }
.detail-iconbtn.sm:hover { background: var(--detail-surface-hover); color: var(--color-text); }
.detail-iconbtn.sm.danger:hover { background: var(--color-error); color: var(--color-text-inverse); border-color: transparent; }

/* Tags */
.detail-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.detail-tags:empty { display: none; }
.detail-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; font-size: 0.78rem; font-weight: 600; color: var(--color-text); background: var(--detail-surface); border: 1px solid var(--detail-hairline); border-radius: var(--radius-full); }
.detail-tag button { width: 18px; height: 18px; border: none; border-radius: 50%; background: transparent; color: var(--color-text-tertiary); cursor: pointer; font-size: 0.95rem; line-height: 1; display: flex; align-items: center; justify-content: center; transition: all var(--duration-fast); }
.detail-tag button:hover { background: var(--color-error); color: var(--color-text-inverse); }
.detail-tag-input { margin-top: -2px; }

/* Folder (compact, icon-led) */
.detail-folder { display: flex; align-items: center; gap: 8px; color: var(--color-text-secondary); }
.detail-folder svg { width: 16px; height: 16px; flex-shrink: 0; }
.detail-folder select { flex: 1; min-width: 0; }

/* Collaborators */
.detail-empty { font-size: 0.85rem; color: var(--color-text-tertiary); }
.detail-collabs { display: flex; flex-direction: column; gap: 6px; }
.detail-collabs:empty { display: none; }
.detail-collab { display: flex; align-items: center; gap: 0.5rem; padding: 7px 8px 7px 12px; background: var(--detail-surface); border: 1px solid var(--detail-hairline); border-radius: var(--radius-md); }
.detail-collab-email { flex: 1; min-width: 0; font-size: 0.84rem; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detail-collab-role { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-text-secondary); }
.detail-collab button { width: 22px; height: 22px; border: none; border-radius: 50%; background: transparent; color: var(--color-text-tertiary); cursor: pointer; font-size: 1.05rem; line-height: 1; transition: all var(--duration-fast); }
.detail-collab button:hover { background: var(--color-error); color: var(--color-text-inverse); }
.detail-collab-add { display: flex; gap: 0.5rem; align-items: flex-start; }
.detail-collab-field { position: relative; flex: 1; min-width: 0; }
.detail-collab-field input {
  width: 100%; box-sizing: border-box;
  padding: 9px 12px; border: 1px solid var(--detail-hairline); border-radius: var(--radius-md);
  font: inherit; font-size: 0.82rem; color: var(--color-text); background: var(--detail-surface);
}
.detail-collab-field input:focus { outline: none; border-color: var(--color-primary); }
.detail-collab-suggest {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20;
  display: flex; flex-direction: column; gap: 2px;
  padding: 4px; background: var(--color-bg-elevated);
  border: 1px solid var(--detail-hairline); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md); max-height: 220px; overflow-y: auto;
}
.detail-collab-suggest[hidden] { display: none !important; }
.detail-collab-suggest-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  width: 100%; padding: 7px 10px; border: none; border-radius: var(--radius-sm);
  background: transparent; text-align: left; cursor: pointer; font: inherit;
}
.detail-collab-suggest-item:hover, .detail-collab-suggest-item.active { background: var(--color-primary-light); }
.detail-collab-suggest-name { font-size: 0.82rem; font-weight: 600; color: var(--color-text); }
.detail-collab-suggest-email { font-size: 0.72rem; color: var(--color-text-secondary); }

/* Resources panel (Files · Datasets · Schedules · Alerts · CrewAI) */
.detail-resources { display: flex; flex-direction: column; gap: var(--space-4); }
.detail-resources:empty { display: none; }
.detail-res-group { display: flex; flex-direction: column; gap: 0.45rem; padding-top: var(--space-4); border-top: 1px solid var(--detail-hairline); }
.detail-res-head { display: flex; align-items: center; gap: 7px; color: var(--color-text-secondary); }
.detail-res-head svg { width: 15px; height: 15px; flex-shrink: 0; }
.detail-res-glabel { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.detail-res-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-full); background: var(--detail-surface); border: 1px solid var(--detail-hairline); font-size: 0.68rem; font-weight: 700; color: var(--color-text-secondary); }
.detail-res-list { display: flex; flex-direction: column; gap: 5px; }
.detail-res-item { display: flex; flex-direction: column; gap: 3px; padding: 7px 10px; background: var(--detail-surface); border: 1px solid var(--detail-hairline); border-radius: var(--radius-md); }
.detail-res-item.is-off { opacity: 0.6; }
.detail-res-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
.detail-res-dest { flex-shrink: 0; font-size: 0.82rem; font-weight: 600; color: var(--color-text); white-space: nowrap; }
.detail-res-when { flex: 1; min-width: 0; font-size: 0.82rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detail-res-stat { flex-shrink: 0; font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-text-tertiary); padding: 1px 7px; border-radius: var(--radius-full); background: rgba(28,25,23,0.05); }
.detail-res-stat.is-ok { color: var(--color-success); background: rgba(16,185,129,0.14); }
.detail-res-stat.is-fail { color: var(--color-error); background: rgba(220,38,38,0.12); }
.detail-res-subline { display: flex; }
.detail-res-cron { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.7rem; color: var(--color-text-tertiary); background: rgba(28,25,23,0.05); padding: 1px 6px; border-radius: 5px; }
.detail-res-acts { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
.detail-res-acts .detail-sched-btn { margin-left: auto; }
.detail-res-empty { font-size: 0.84rem; color: var(--color-text-tertiary); padding: 2px 0; }
.detail-res-add { align-self: flex-start; margin-top: 2px; padding: 6px 12px; border: 1px solid var(--detail-hairline); border-radius: var(--radius-md); background: var(--detail-surface); color: var(--color-text-secondary); font: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.detail-res-add:hover { background: var(--detail-surface-hover); color: var(--color-text); }
.detail-sched-btn { padding: 4px 10px; border: 1px solid var(--detail-hairline); border-radius: var(--radius-sm); background: var(--color-bg-elevated, var(--color-bg-elevated)); color: var(--color-text-secondary); font: inherit; font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: all var(--duration-fast); }
.detail-sched-btn:hover { background: var(--detail-surface-hover); color: var(--color-text); }
/* Home modals now use the shared .so-c-modal component (design-system/components/modal.ts).
   These rules only re-apply home-specific field spacing inside that shared shell. */
.sched-create-btn { flex: 1; padding: 8px; border: none; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: filter var(--duration-fast); }
.sched-create-btn:hover { filter: brightness(1.05); }

`;
