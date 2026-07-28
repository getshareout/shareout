/**
 * Home page styles — Workspace = Team Space (expand to its shared folders inline)
 * @module design-system/pages/home/workspace-team-space-expand-to-its-shared-folders-inline
 */

/** CSS rules for: Workspace = Team Space (expand to its shared folders inline) */
export const workspaceTeamSpaceExpandToItsSharedFoldersInlineStyles = `/* ── Workspace = Team Space (expand to its shared folders inline) ───── */
.ws-item { display: flex; flex-direction: column; }
.ws-row { display: flex; align-items: center; gap: 2px; }
.ws-row .ws-btn { flex: 1; min-width: 0; }
.ws-expand {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 30px; flex-shrink: 0;
  border: none; background: transparent; cursor: pointer; padding: 0;
  color: var(--color-text-tertiary); border-radius: var(--radius-sm);
}
.ws-expand svg { width: 14px; height: 14px; transition: transform var(--duration-normal); }
.ws-item.open > .ws-row .ws-expand svg { transform: rotate(90deg); }
.ws-expand:hover { color: var(--color-text); background: rgba(255,255,255,0.6); }
.ws-folders {
  display: flex; flex-direction: column; gap: 1px;
  margin: 2px 0 4px 26px;
  padding-left: 8px;
  border-left: 1px solid var(--color-border);
}
.ws-folders[hidden] { display: none; }
.ws-folder-link, .ws-folder-new {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 8px;
  border: none; background: transparent; cursor: pointer;
  font: inherit; font-size: 0.84rem; text-align: left;
  color: var(--color-text-secondary); border-radius: var(--radius-sm);
}
.ws-folder-link svg, .ws-folder-new svg { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.85; }
.ws-folder-link:hover, .ws-folder-new:hover { background: rgba(255,255,255,0.6); color: var(--color-text); }
.ws-folder-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-folder-count { font-size: 0.7rem; color: var(--color-text-tertiary); }
.ws-folder-new { color: var(--color-primary); font-weight: 600; }
.ws-folders-empty, .ws-folders-loading { padding: 6px 8px; font-size: 0.78rem; color: var(--color-text-tertiary); }

`;
