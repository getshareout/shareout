/**
 * Workspace shell constants: design tokens scoped to .wsx, navigation icons, and rail items.
 */
/** Missing-in-worker tokens the marketing demo relied on, scoped to this shell. */
export const WORKSPACE_TOKENS = `
.wsx {
  --glass-bg-strong: rgba(255,255,255,0.78);
  --radius-2xl: 24px;
  --shadow-hero: 0 40px 100px -20px rgba(28,25,23,0.22);
  --ease-out-expo: cubic-bezier(0.16,1,0.3,1);
  --text-xs: 0.75rem; --text-sm: 0.875rem; --text-base: 1rem; --text-h3: 1.5rem;
  --wsx-rail: 244px; --wsx-act: 300px; --wsx-rightcol: var(--wsx-act);
  --wsx-headbar: 45px;
}`;

export const ICON = {
  brief: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  foryou: '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fav: '<path d="M12 17.3l-5.5 3.3 1.5-6.3-4.9-4.2 6.4-.5L12 3.5l2.5 5.9 6.4.5-4.9 4.2 1.5 6.3z"/>',
  shared: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  browse: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  alert: '<path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6z"/><path d="M10 21h4"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>',
  admin: '<path d="M12 3l8 3v6c0 4.5-3 7.6-8 9-5-1.4-8-4.5-8-9V6z"/>',
  datasets: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  crew: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>',
  library: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18M18 7H10M18 11H10"/>',
  assets: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  catalog: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20z"/>',
  knowledge: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6.2 7.7l4.6 8.6M17.8 7.7l-4.6 8.6"/>',
};

/** Rail navigation. `view` items switch the canvas Home pane; `link` items navigate. */
export interface NavItem { key: string; label: string; i18n?: string; icon: keyof typeof ICON; kind: 'view' | 'link'; href?: string; }
