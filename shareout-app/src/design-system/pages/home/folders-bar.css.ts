/**
 * Home page styles — Folders bar
 * @module design-system/pages/home/folders-bar
 */

/** CSS rules for: Folders bar */
export const foldersBarStyles = `/* ── Folders bar ────────────────────────────────────── */
.folders-bar { margin: 0 0 1rem; }
.folders-panel { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3) var(--space-5); margin-bottom: var(--space-3); }
.folders-row {
  display: inline-flex; align-items: center; gap: 10px;
  min-width: 0; margin-top: 0;
}
.folders-row[hidden] { display: none; }
.folders-row[data-scope="workspace"]:not([hidden]) + .folders-row[data-scope="personal"] {
  padding-left: var(--space-5);
  border-left: 1px solid var(--color-border);
}
.folders-strip {
  display: inline-flex; align-items: center; gap: 8px;
  min-width: 0; max-width: 100%;
}
.folders-chips {
  display: flex; flex-wrap: nowrap; gap: 8px;
  flex: 0 1 auto; min-width: 0; max-width: min(560px, 40vw);
  overflow-x: auto; overflow-y: hidden;
  padding-bottom: 2px; scrollbar-width: thin; scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
}
.folders-chips::-webkit-scrollbar { height: 6px; }
.folders-chips::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 999px; }
.folders-chips[hidden] { display: none; }
.folder-chip {
  position: relative; display: inline-flex; align-items: center; gap: 8px;
  flex: 0 0 auto; scroll-snap-align: start;
  padding: 7px 10px 7px 11px; border: 1px solid rgba(0,0,0,0.1);
  border-radius: var(--radius-md); background: var(--color-bg-elevated);
  cursor: pointer; font-size: 0.85rem; color: var(--color-text);
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.folder-chip:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.folder-chip:focus { outline: none; }
.folder-chip:focus-visible,
.folder-chip:active:not(.editing):not(.confirming):not(:has(.folder-chip-menu:active)) {
  outline: none;
  background: var(--color-primary); border-color: var(--color-primary);
  color: var(--color-text-inverse); box-shadow: var(--shadow-md);
}
.folder-chip:focus-visible .folder-chip-icon,
.folder-chip:focus-visible .folder-chip-scope,
.folder-chip:active:not(.editing):not(.confirming):not(:has(.folder-chip-menu:active)) .folder-chip-icon,
.folder-chip:active:not(.editing):not(.confirming):not(:has(.folder-chip-menu:active)) .folder-chip-scope { color: rgba(255,255,255,0.9); }
.folder-chip:focus-visible .folder-chip-count,
.folder-chip:active:not(.editing):not(.confirming):not(:has(.folder-chip-menu:active)) .folder-chip-count { background: rgba(255,255,255,0.22); color: var(--color-text-inverse); }
.folder-chip-icon { width: 16px; height: 16px; color: var(--color-primary); flex-shrink: 0; }
.folder-chip-name { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.folder-chip-scope { display: inline-flex; align-items: center; flex-shrink: 0; }
.folder-chip-scope svg { width: 12px; height: 12px; }
.folder-chip[data-scope="workspace"] { background: var(--color-primary-light); border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); }
.folder-chip[data-scope="workspace"] .folder-chip-icon,
.folder-chip[data-scope="workspace"] .folder-chip-scope { color: var(--color-primary); }
.folder-chip[data-scope="personal"] .folder-chip-icon { color: var(--color-text-secondary); }
.folder-chip[data-scope="personal"] .folder-chip-scope { color: var(--color-text-tertiary); }
.folder-chip-count { font-size: 0.72rem; color: var(--color-text-tertiary); background: rgba(0,0,0,0.05); border-radius: 10px; padding: 1px 7px; }
.folder-chip-menu { display: flex; align-items: center; justify-content: center; width: 0; height: 20px; border: none; background: none; border-radius: 50%; cursor: pointer; padding: 0; margin-left: -8px; color: var(--color-text-tertiary); opacity: 0; overflow: hidden; transition: opacity 0.15s, width 0.15s, margin 0.15s; }
.folder-chip:hover .folder-chip-menu { opacity: 1; width: 20px; margin-left: 0; }
.folder-chip-menu:hover { background: rgba(0,0,0,0.06); color: var(--color-text); }
.folder-chip-menu svg { width: 14px; height: 14px; }
.folder-chip.editing { cursor: default; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); background: var(--color-bg-elevated); }
.folder-chip-rename { font: inherit; font-size: 0.85rem; font-weight: 500; color: var(--color-text); border: none; outline: none; background: transparent; width: 130px; max-width: 160px; padding: 0; margin: 0; }
.folder-chip.confirming { cursor: default; border-color: var(--color-error); background: color-mix(in srgb, var(--color-error) 8%, transparent); }
.folder-chip.confirming .folder-chip-icon, .folder-chip.confirming .folder-chip-name { color: var(--color-error); }
.folder-chip-confirm { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: none; border-radius: 50%; cursor: pointer; flex-shrink: 0; }
.folder-chip-confirm svg { width: 13px; height: 13px; }
.folder-chip-confirm.yes { background: var(--color-error); color: var(--color-text-inverse); }
.folder-chip-confirm.no { background: rgba(0,0,0,0.06); color: var(--color-text-secondary); }
.folder-chip-confirm.no:hover { background: rgba(0,0,0,0.12); }
.folder-new-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0;
  border: 1px dashed rgba(0,0,0,0.18); border-radius: var(--radius-md);
  background: none; cursor: pointer; color: var(--color-text-secondary);
}
.folder-new-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.folder-new-btn svg { width: 17px; height: 17px; }
.folders-breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; }
.folders-breadcrumb[hidden] { display: none; }
.crumb-root, .crumb-mid { border: none; background: none; cursor: pointer; color: var(--color-primary); font: inherit; padding: 0; }
.crumb-root:hover, .crumb-mid:hover { text-decoration: underline; }
.crumb-sep { color: var(--color-text-tertiary); }
.crumb-current { font-weight: 600; color: var(--color-text); }
.crumb-root.drag-over { background: var(--color-primary-light); border-radius: var(--radius-sm); text-decoration: underline; }

/* ── Drive-style folders in the All Artifacts grid ──── */
.wsx-folders-sec { margin: 0 0 var(--space-4); }
.wsx-sec-row { display: flex; align-items: center; justify-content: flex-start; gap: var(--space-3); margin: 0 0 var(--space-3); }
.wsx-sec-label { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--color-text-tertiary); }
.wsx-sec-label--pages { display: block; margin: var(--space-2) 0 var(--space-3); }
.wsx__view .folders-breadcrumb { margin: 0 0 var(--space-3); }
/* Single row; scroll horizontally when the folders overflow (never wrap). */
.wsx-folder-grid { display: flex; flex-wrap: nowrap; gap: var(--space-3); overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; scrollbar-width: thin; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
.wsx-folder-grid > .wsx-folder-card { flex: 0 0 200px; scroll-snap-align: start; }
.wsx-folder-grid::-webkit-scrollbar { height: 6px; }
.wsx-folder-grid::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 999px; }
.wsx-folder-card { position: relative; display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
.wsx-folder-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.wsx-folder-card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx-folder-card__icon { display: inline-flex; flex-shrink: 0; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: var(--radius-md); background: var(--color-primary-light); color: var(--color-primary); }
.wsx-folder-card__icon svg { width: 20px; height: 20px; }
.wsx-folder-card[data-scope="personal"] .wsx-folder-card__icon { background: rgba(0,0,0,0.04); color: var(--color-text-secondary); }
.wsx-folder-card__txt { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.wsx-folder-card__name { font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-folder-card__count { font-size: 0.78rem; color: var(--color-text-tertiary); }
.wsx-folder-card__actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.wsx-folder-card:hover .wsx-folder-card__actions, .wsx-folder-card:focus-within .wsx-folder-card__actions { opacity: 1; }
.wsx-folder-card__act { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-tertiary); cursor: pointer; box-shadow: var(--shadow-sm); }
.wsx-folder-card__act:hover { color: var(--color-text); background: rgba(0,0,0,0.06); }
.wsx-folder-card__act.danger:hover { color: var(--color-error); }
.wsx-folder-card__act svg { width: 14px; height: 14px; }
.wsx-folder-new { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px dashed var(--color-border); border-radius: var(--radius-md); background: none; color: var(--color-text-secondary); font: 600 0.82rem var(--font-body); cursor: pointer; }
.wsx-folder-new:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-folder-new svg { width: 15px; height: 15px; }
.wsx-folder-newin { display: inline-flex; }
.wsx-folder-newin input { font: 600 0.82rem var(--font-body); color: var(--color-text); padding: 6px 12px; min-width: 170px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-bg-elevated); outline: none; box-shadow: 0 0 0 3px var(--color-primary-light); }
/* Drag an artifact card onto a folder tile (or the breadcrumb root) to move it. */
.artifact-card.is-dragging { opacity: 0.5; }
.wsx-folder-card.drag-over { border-color: var(--color-primary); background: var(--color-primary-light); box-shadow: 0 0 0 3px var(--color-primary-light); }

/* ── Folder guide (README instruction surface) ──────── */
.wsx-fguide { margin: 0 0 var(--space-4); padding: var(--space-4) var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); }
.wsx-fguide__head { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--space-3); color: var(--color-text-tertiary); }
.wsx-fguide__head svg { width: 15px; height: 15px; flex-shrink: 0; }
.wsx-fguide__label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.wsx-fguide__edit { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--radius-sm); background: none; color: var(--color-text-tertiary); cursor: pointer; }
.wsx-fguide__edit:hover { background: rgba(0,0,0,0.06); color: var(--color-text); }
.wsx-fguide__edit svg { width: 15px; height: 15px; }
.wsx-fguide__body { color: var(--color-text); font-size: 0.92rem; line-height: 1.6; }
.wsx-fguide__body > :first-child { margin-top: 0; }
.wsx-fguide__body > :last-child { margin-bottom: 0; }
.wsx-fguide__body h1, .wsx-fguide__body h2, .wsx-fguide__body h3 { margin: var(--space-4) 0 var(--space-2); line-height: 1.3; }
.wsx-fguide__body h1 { font-size: 1.2rem; } .wsx-fguide__body h2 { font-size: 1.05rem; } .wsx-fguide__body h3 { font-size: 0.95rem; }
.wsx-fguide__body p, .wsx-fguide__body ul, .wsx-fguide__body ol, .wsx-fguide__body blockquote, .wsx-fguide__body table { margin: 0 0 var(--space-3); }
.wsx-fguide__body ul, .wsx-fguide__body ol { padding-left: 1.4em; }
.wsx-fguide__body li { margin: 2px 0; }
.wsx-fguide__body a { color: var(--color-primary); }
.wsx-fguide__body code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.86em; background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: var(--radius-sm); }
.wsx-fguide__body pre { background: rgba(0,0,0,0.06); padding: var(--space-3); border-radius: var(--radius-md); overflow-x: auto; }
.wsx-fguide__body pre code { background: none; padding: 0; }
.wsx-fguide__body blockquote { padding-left: var(--space-3); border-left: 3px solid var(--color-border); color: var(--color-text-secondary); }
.wsx-fguide__body table { border-collapse: collapse; width: 100%; }
.wsx-fguide__body th, .wsx-fguide__body td { border: 1px solid var(--color-border); padding: 6px 10px; text-align: left; }
.wsx-fguide--empty { display: flex; align-items: center; gap: 12px; width: 100%; margin: 0 0 var(--space-4); padding: var(--space-4) var(--space-5); border: 1px dashed var(--color-border); border-radius: var(--radius-lg); background: none; color: var(--color-text-secondary); cursor: pointer; text-align: left; }
.wsx-fguide--empty:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-fguide--empty svg { width: 20px; height: 20px; flex-shrink: 0; }
.wsx-fguide__cta { display: flex; flex-direction: column; gap: 2px; }
.wsx-fguide__cta strong { font-weight: 600; font-size: 0.9rem; }
.wsx-fguide__cta em { font-style: normal; font-size: 0.8rem; color: var(--color-text-tertiary); }
.wsx-fguide__ta { width: 100%; min-height: 220px; resize: vertical; font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.85rem; line-height: 1.55; color: var(--color-text); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); outline: none; }
.wsx-fguide__ta:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }

`;
