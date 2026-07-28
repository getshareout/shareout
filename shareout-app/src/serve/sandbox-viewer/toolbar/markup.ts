import { escapeHtml } from '../../utils';
import type { ToolbarRenderContext } from '../types';

/** HTML for toolbar buttons, overlays, and comment panel shells. */
export function renderToolbarMarkup(ctx: ToolbarRenderContext): string {
  const {
    currentUser,
    adminInfo,
    loggedIn,
    isFav,
    commentsEnabled,
    commentsIdentityMode,
    commentCount,
    hasMetrics,
    baseUrl,
    slug,
    loginRedirect,
    userLabel,
    userFirstName,
    avatarInner,
    visualEditorEnabled,
    attachedSkills,
  } = ctx;

  const editorBtn = adminInfo ? (visualEditorEnabled ? `
      <a href="${baseUrl}/a/${slug}/edit" class="so-toolbar-btn" title="Open Live Studio">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Editor
      </a>` : `
      <span class="so-toolbar-btn is-disabled" title="Live Studio is not enabled for this workspace" aria-disabled="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Editor
      </span>`) : '';

  const skills = attachedSkills || [];
  const showSkills = loggedIn && skills.length > 0;
  const skillsBtn = showSkills ? `
      <button class="so-toolbar-btn" id="so-skills-btn" onclick="soToggleSkills()" title="Skills attached to this artifact" aria-haspopup="true" aria-expanded="false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        Skills <span class="so-skills-count">${skills.length}</span>
      </button>` : '';
  const skillsOverlay = showSkills ? `
  <div id="so-skills-overlay">
    <div class="backdrop" onclick="soCloseSkills()"></div>
    <div id="so-skills-panel">
      <div class="so-stats-header">
        <h3 class="so-stats-title">Attached skills</h3>
        <button class="so-stats-close" onclick="soCloseSkills()" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="so-skills-body">
        <p class="so-skills-intro">Knowledge attached to this artifact — agents working on it read these as context.</p>
        <div class="so-skills-list">
          ${skills.map(s => `<a class="so-skill-chip" href="${baseUrl}/a/${escapeHtml(s.slug)}/" target="_blank" rel="noopener">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span>${escapeHtml(s.name)}</span>
          </a>`).join('')}
        </div>
      </div>
    </div>
  </div>` : '';

  return `${loggedIn ? `
  <div id="so-back-zone" aria-hidden="true"></div>
  <a href="/home" id="so-back-home" title="Back to all artifacts" aria-label="Back to all artifacts">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
    <span class="so-back-label">All artifacts</span>
  </a>` : ''}
  <div id="shareout-admin-toolbar">
    <div id="so-toolbar-items">${currentUser ? `
      <button class="so-toolbar-btn so-avatar-btn"${adminInfo ? ' onclick="openAdmin()"' : ''} title="${escapeHtml(userLabel)}">
        <span class="so-avatar">${avatarInner}</span>
        <span>${escapeHtml(userFirstName)}</span>
      </button>` : ''}${loggedIn ? `
      <a href="/home" class="so-toolbar-btn" title="Back to all your artifacts">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        All artifacts
      </a>` : ''}${loggedIn ? `
      <button class="so-toolbar-btn so-fav-btn${isFav ? ' active' : ''}" id="so-fav-btn" onclick="toggleFav()" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${isFav ? 'true' : 'false'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <span id="so-fav-label">${isFav ? 'Favorited' : 'Favorite'}</span>
      </button>` : ''}${skillsBtn}${loggedIn && !adminInfo ? `
      <button class="so-toolbar-btn" onclick="soOpenSchedule(true)" title="Get this page sent to you on a schedule (email, Telegram, or Slack)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        Notify me
      </button>` : ''}${loggedIn && hasMetrics ? `
      <button class="so-toolbar-btn" onclick="soOpenFollow()" title="Get alerted when a metric on this page crosses a threshold">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
        </svg>
        Follow metric
      </button>` : ''}${commentsEnabled ? ((loggedIn || commentsIdentityMode !== 'authenticated') ? `
      <button class="so-toolbar-btn" id="so-cmt-btn" onclick="openComments()" title="Comments">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Comments${commentCount > 0 ? ` <span class="so-cmt-count" id="so-cmt-count">${commentCount}</span>` : ''}
      </button>` : `
      <a href="${baseUrl}/auth/login?redirect=${encodeURIComponent(loginRedirect)}" class="so-toolbar-btn" title="Log in to comment">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Log in to comment
      </a>`) : ''}${adminInfo ? `${editorBtn}
      <button class="so-toolbar-btn" onclick="openStats()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
        </svg>
        Stats
      </button>
      <button class="so-toolbar-btn" onclick="openAdmin()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        Settings
      </button>
      <button class="so-toolbar-btn" onclick="soOpenSchedule(false)" title="Schedule delivery (email, Telegram, or Slack)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        Schedule
      </button>` : ''}
    </div>
    <button id="so-toolbar-trigger" onclick="soToggleToolbar()" aria-label="Toggle toolbar" aria-expanded="false">
      ${commentCount > 0 ? `<span id="so-trig-badge">${commentCount}</span>` : '<span id="so-trig-badge" style="display:none"></span>'}
      <span class="so-trig-icon">
        <img src="${baseUrl}/brand/logo-mark.png" alt="ShareOut" width="24" height="24" class="so-trig-logo">
      </span>
    </button>
  </div>${adminInfo ? `
  <div id="so-stats-overlay">
    <div class="backdrop" onclick="closeStats()"></div>
    <div id="so-stats-panel">
      <div class="so-stats-header">
        <h3 class="so-stats-title">Analytics</h3>
        <button class="so-stats-close" onclick="closeStats()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="so-stats-content" id="so-stats-content">
        <div class="so-stats-loading">Loading stats...</div>
      </div>
      <a href="${baseUrl}/a/${slug}/admin" class="so-admin-link">View full dashboard →</a>
    </div>
  </div>
  <div id="so-admin-overlay">
    <div class="backdrop" onclick="closeAdmin()"></div>
    <div id="so-admin-panel">
      <div class="so-stats-header">
        <h3 class="so-stats-title">Settings</h3>
        <button class="so-stats-close" onclick="closeAdmin()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>${currentUser ? `
      <div class="so-admin-user">
        <span class="so-avatar so-avatar-lg">${avatarInner}</span>
        <div class="so-admin-user-meta">
          <span class="so-admin-user-name">${escapeHtml(userLabel)}</span>
          ${currentUser.name ? `<span class="so-admin-user-email">${escapeHtml(currentUser.email)}</span>` : ''}
        </div>
      </div>` : ''}
      <div class="so-stats-content" id="so-admin-content">
        <div class="so-stats-loading">Loading...</div>
      </div>
    </div>
  </div>` : ''}${(loggedIn || commentsIdentityMode !== 'authenticated') && commentsEnabled ? `
  <div id="so-pins-layer"></div>
  <div id="so-comments-overlay" data-identity-mode="${commentsIdentityMode}" data-logged-in="${loggedIn ? '1' : '0'}">
    <div class="backdrop" onclick="closeComments()"></div>
    <div id="so-comments-panel">
      <div class="so-stats-header">
        <h3 class="so-stats-title">Comments<span class="so-cmt-presence" id="so-cmt-presence"></span></h3>
        <button class="so-stats-close" onclick="closeComments()" aria-label="Close comments">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="so-cmt-tabs">
        <button class="so-cmt-tab active" id="so-cmt-tab-open" onclick="setCommentFilter('open')">Open</button>
        <button class="so-cmt-tab" id="so-cmt-tab-resolved" onclick="setCommentFilter('resolved')">Resolved</button>
      </div>
      <div class="so-cmt-list" id="so-cmt-list">
        <div class="so-cmt-loading">Loading comments…</div>
      </div>
      <div class="so-cmt-typing" id="so-cmt-typing"></div>
      <div class="so-cmt-composer">
        <div class="so-cmt-mentionbox" id="so-cmt-mentionbox"></div>
        ${!loggedIn ? `<input type="text" class="so-cmt-textarea" id="so-cmt-guest-name" placeholder="${commentsIdentityMode === 'named' ? 'Your name (required)' : 'Your name (optional)'}" aria-label="Your name" maxlength="80" style="min-height:0;height:36px;margin-bottom:8px;resize:none">` : ''}
        <textarea class="so-cmt-textarea" id="so-cmt-input" placeholder="Add a comment…${loggedIn ? ' use @ to mention' : ''}" aria-label="Add a comment"></textarea>
        <div class="so-cmt-composer-actions">
          <button class="so-cmt-pinbtn" id="so-cmt-pinbtn" onclick="togglePinMode()" title="Attach this comment to a spot on the page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.686-6-10a6 6 0 0 1 12 0c0 4.314-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>
            <span id="so-cmt-pinbtn-label">Pin to page</span>
          </button>
          <button class="so-cmt-submit" id="so-cmt-submit" onclick="submitComment()">Comment</button>
        </div>
        <div class="so-cmt-replying" id="so-cmt-replying" style="margin-top:8px"></div>
      </div>
    </div>
  </div>` : ''}${skillsOverlay}`;
}
