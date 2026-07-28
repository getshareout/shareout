import type { ArtifactType, TypeMetadata } from '../types';
import { brandFaviconHead } from '../brand';
import { colors, fonts, radius, shadows, googleFontsPreconnect } from '../design-system/tokens';
import { cssVariables } from '../design-system/base.css';
import { componentStylesheet } from '../design-system/components/index';
import { renderSocialMetaTags, type SocialPreview } from '../serve/social-meta';
import { shareModalMarkup, shareModalScript } from '../components/share-modal';

export interface ViewerContext {
  slug: string;
  artifactName: string;
  artifactType: ArtifactType;
  typeMetadata: TypeMetadata;
  baseUrl: string;
  content: string;
  isAdmin: boolean;
  artifactId: string;
  loggedIn: boolean;
  isFavorite: boolean;
  canManage?: boolean;
  socialPreview?: SocialPreview;
  // Skill Marketplace: metrics + per-user state for the skill viewer chrome.
  skillMetrics?: {
    upvotes: number;
    installs: number;
    attaches: number;
    uses: number;
    voted: boolean;
    installed: boolean;
    canAct: boolean;
  };
  // Workspace Library: module info for the library viewer (version, exports, import URL).
  libraryMetrics?: {
    scope: 'personal' | 'workspace';
    namespace: string;
    moduleName: string;
    version: string | null;
    versions: string[];
    importPath: string | null;
  };
}

const TYPE_LABELS: Record<ArtifactType, string> = {
  html: 'HTML',
  csv: 'CSV',
  txt: 'Text',
  markdown: 'Markdown',
  json: 'JSON',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  skill: 'Skill',
  library: 'Library',
};

const TYPE_ICONS: Record<ArtifactType, string> = {
  html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 4 2 14 6 4 6-4 2-14"/><path d="m8 8h8l-2 10-2 2-2-2-2-10z"/></svg>',
  csv: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
  txt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  markdown: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 15V9l2 3 2-3v6M17 9v6M17 12h-2"/></svg>',
  json: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m0 8v3a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3"/></svg>',
  pdf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
  skill: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  library: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateViewerShell(
  ctx: ViewerContext,
  bodyContent: string,
  extraHead?: string,
  extraStyles?: string
): string {
  const typeLabel = TYPE_LABELS[ctx.artifactType];
  const typeIcon = TYPE_ICONS[ctx.artifactType];

  const adminToolbar = ctx.isAdmin ? `
    <div class="admin-toolbar">
      <a href="/home" class="admin-btn" title="Back to all your artifacts">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
        </svg>
        All artifacts
      </a>
      <a href="${ctx.baseUrl}/a/${ctx.slug}/edit" class="admin-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Edit
      </a>
      <a href="${ctx.baseUrl}/a/${ctx.slug}/admin" class="admin-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
        </svg>
        Stats
      </a>
    </div>` : '';

  const pageTitle = escapeHtml(ctx.socialPreview?.title || ctx.artifactName);
  const socialTags = ctx.socialPreview ? renderSocialMetaTags(ctx.socialPreview) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} | ShareOut</title>
  ${socialTags}
  ${brandFaviconHead}
  ${googleFontsPreconnect}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${cssVariables}
    ${componentStylesheet()}
    :root {
      --bg: var(--color-bg);
      --surface: var(--color-bg-elevated);
      --text: var(--color-text);
      --text-muted: var(--color-text-secondary);
      --border: var(--color-border);
      --primary: var(--color-primary);
      --primary-hover: var(--color-primary-hover);
      --code-bg: var(--color-surface);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-bg: ${colors.text};
        --color-bg-elevated: color-mix(in srgb, ${colors.text} 90%, ${colors.bgElevated});
        --color-surface: color-mix(in srgb, ${colors.text} 82%, ${colors.surface});
        --color-text: ${colors.bg};
        --color-text-secondary: ${colors.textTertiary};
        --color-border: color-mix(in srgb, ${colors.text} 70%, ${colors.borderStrong});
      }
    }
    html, body {
      height: 100%;
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .viewer-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .viewer-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .artifact-info {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }
    .artifact-name {
      font: 600 15px var(--font-display);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--code-bg);
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .header-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
      align-items: center;
    }
    .viewer-header > .so-c-btn--icon { flex-shrink: 0; }
    .fav-btn.active {
      color: ${colors.warning};
      border-color: ${colors.warning};
    }
    .fav-btn.active svg { fill: ${colors.warning}; }
    .viewer-body {
      flex: 1;
      overflow: auto;
      padding: 20px;
    }
    .admin-toolbar {
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      gap: 8px;
      z-index: 1000;
    }
    .admin-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: ${colors.text};
      color: ${colors.bg};
      text-decoration: none;
      border-radius: ${radius.sm};
      font: 500 13px var(--font-body);
      box-shadow: ${shadows.lg};
      transition: all 0.2s;
    }
    .admin-btn:hover {
      background: ${colors.textSecondary};
    }
    ${extraStyles || ''}
  </style>
  ${extraHead || ''}
</head>
<body>
  <div class="viewer-container">
    <header class="viewer-header">${ctx.loggedIn ? `
      <a href="/home" class="so-c-btn so-c-btn--ghost so-c-btn--icon so-c-btn--sm" title="Back to all artifacts" aria-label="Back to all artifacts">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </a>` : ''}
      <div class="artifact-info">
        <span class="artifact-name">${escapeHtml(ctx.artifactName)}</span>
        <span class="type-badge">${typeIcon} ${typeLabel}</span>
      </div>
      <div class="header-actions">${ctx.loggedIn ? `
        <button class="so-c-btn so-c-btn--ghost so-c-btn--sm fav-btn${ctx.isFavorite ? ' active' : ''}" id="so-fav-btn" onclick="soToggleFav()" title="${ctx.isFavorite ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${ctx.isFavorite ? 'true' : 'false'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${ctx.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <span id="so-fav-label">${ctx.isFavorite ? 'Favorited' : 'Favorite'}</span>
        </button>
        <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" id="so-share-btn" onclick="openShare('${ctx.artifactId}','${ctx.slug}',${escapeHtml(JSON.stringify(ctx.artifactName))},${ctx.canManage ?? ctx.isAdmin})" title="Share">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>` : ''}
        <a href="${ctx.baseUrl}/a/${ctx.slug}/${ctx.content.includes('\n') ? escapeHtml(ctx.artifactName) + getExtension(ctx.artifactType) : 'download'}" download="${escapeHtml(ctx.artifactName)}${getExtension(ctx.artifactType)}" class="so-c-btn so-c-btn--secondary so-c-btn--sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </a>
      </div>
    </header>
    <main class="viewer-body">
      ${bodyContent}
    </main>
  </div>
  ${ctx.loggedIn ? shareModalMarkup() : ''}
  ${adminToolbar}${ctx.loggedIn ? `
  <script>
    ${shareModalScript({ baseUrl: ctx.baseUrl })}
    window.soToggleFav = function() {
      var btn = document.getElementById('so-fav-btn');
      if (!btn) return;
      var on = btn.classList.contains('active');
      btn.disabled = true;
      fetch('${ctx.baseUrl}/v1/artifacts/${ctx.artifactId}/favorite', { method: on ? 'DELETE' : 'POST', credentials: 'include' })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function() {
          on = !on;
          btn.classList.toggle('active', on);
          btn.title = on ? 'Remove from favorites' : 'Add to favorites';
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          var svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
          var lbl = document.getElementById('so-fav-label'); if (lbl) lbl.textContent = on ? 'Favorited' : 'Favorite';
        })
        .catch(function(err) { console.error('Favorite error:', err); })
        .finally(function() { btn.disabled = false; });
    };
  </script>` : ''}
</body>
</html>`;
}

function getExtension(type: ArtifactType): string {
  switch (type) {
    case 'csv': return '.csv';
    case 'txt': return '.txt';
    case 'markdown': return '.md';
    case 'skill': return '.md';
    case 'json': return '.json';
    case 'pdf': return '.pdf';
    default: return '';
  }
}
