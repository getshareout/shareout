import { escapeHtml } from '../../utils';
import type { ToolbarRenderContext } from '../types';
import { TOOLBAR_COPY } from './copy';
import { GUEST_COPY } from './copy-guest';
import { renderGuestPanel } from './script-guest';

const icon = (paths: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  metric: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
};

/**
 * The viewer header: a slim bar above the artifact with the page's name, who owns it
 * and its version on the left, and the few things a viewer does on the right
 * (favorite, schedule, comments, share). Rarely used actions sit in the title's menu.
 * Owner tools (edit, stats, settings) live in ShareOut's home, linked from that menu.
 * Also renders the comments and skills side panels the header opens.
 */
export function renderToolbarMarkup(ctx: ToolbarRenderContext): string {
  const {
    adminInfo,
    loggedIn,
    isFav,
    commentsEnabled,
    commentsIdentityMode,
    commentsGuest,
    commentCount,
    hasMetrics,
    baseUrl,
    slug,
    artifactId,
    loginRedirect,
    attachedSkills,
    title,
    ownerName,
    versionNo,
    locale,
  } = ctx;
  const c = TOOLBAR_COPY[locale];
  const canPost = loggedIn || commentsIdentityMode !== 'authenticated' || commentsGuest;

  const skills = attachedSkills || [];
  const showSkills = loggedIn && skills.length > 0;

  const menuItems = [
    loggedIn && hasMetrics ? `
        <button type="button" class="so-hd__item" role="menuitem" onclick="soHdMenu(false);soOpenFollow()" title="${c.followTitle}">${icon(ICON.metric)}<span>${c.followMetric}</span></button>` : '',
    showSkills ? `
        <button type="button" class="so-hd__item" role="menuitem" id="so-skills-btn" onclick="soHdMenu(false);soToggleSkills()" title="${c.skillsTitle}" aria-haspopup="dialog" aria-expanded="false">${icon(ICON.book)}<span>${c.skills}</span><span class="so-skills-count">${skills.length}</span></button>` : '',
    adminInfo ? `${loggedIn && (hasMetrics || showSkills) ? '\n        <div class="so-hd__sep" role="separator"></div>' : ''}
        <a class="so-hd__item" role="menuitem" href="${baseUrl}/home#a/${encodeURIComponent(slug)}" title="${c.openInShareOutTitle}">${icon(ICON.external)}<span>${c.openInShareOut}</span></a>` : '',
  ].join('');
  const hasMenu = menuItems.trim() !== '';

  const name = `<span class="so-hd__name">${escapeHtml(title)}</span>`;
  const titleEl = hasMenu
    ? `<button type="button" class="so-hd__title" id="so-hd-menu-btn" onclick="soHdMenu(undefined, event)" aria-haspopup="menu" aria-expanded="false" aria-controls="so-hd-menu" title="${c.moreOptions}">${name}${icon(ICON.chevron, 14)}</button>`
    : `<span class="so-hd__title">${name}</span>`;
  const meta = [ownerName ? escapeHtml(ownerName) : '', versionNo ? `<span title="${c.versionTitle}${versionNo}">v${versionNo}</span>` : '']
    .filter(Boolean).join('<span class="so-hd__dot" aria-hidden="true">·</span>');

  const commentsBtn = commentsEnabled ? (canPost ? `
      <button type="button" class="so-hd__btn" id="so-cmt-btn" onclick="soHdComments()" title="${c.comments}" aria-label="${c.comments}">${icon(ICON.comment)}<span class="so-hd__label">${c.comments}</span>${commentCount > 0 ? `<span class="so-cmt-count" id="so-cmt-count">${commentCount}</span>` : ''}</button>` : `
      <a class="so-hd__btn" href="${baseUrl}/auth/login?redirect=${encodeURIComponent(loginRedirect)}" title="${c.loginToComment}">${icon(ICON.comment)}<span class="so-hd__label">${c.loginToComment}</span></a>`) : '';

  return `
  <header id="so-header" class="so-hd${loggedIn ? '' : ' so-hd--guest'}">
    <div class="so-hd__left">${loggedIn ? `
      <a href="${baseUrl}/home" class="so-hd__btn so-hd__btn--icon" title="${c.back}" aria-label="${c.back}">${icon(ICON.back)}</a>` : `
      <img src="${baseUrl}/brand/logo-mark.png" alt="ShareOut" width="20" height="20" class="so-hd__mark">`}
      <div class="so-hd__titlewrap">
        ${titleEl}${meta ? `
        <span class="so-hd__meta">${meta}</span>` : ''}${hasMenu ? `
        <div class="so-hd__menu" id="so-hd-menu" role="menu" aria-label="${c.moreOptions}" hidden>${menuItems}
        </div>` : ''}
      </div>
    </div>
    <div class="so-hd__right" id="so-hd-actions">${loggedIn ? `
      <span class="so-live-presence-btn" id="so-live-presence-btn" title="${c.liveViewers}" hidden>
        <span class="so-live-presence-dot" aria-hidden="true"></span>
        <span class="so-live-presence-avatars" id="so-live-presence-avatars" aria-hidden="true"></span>
        <span class="so-hd__label" id="so-live-presence-label"></span>
      </span>
      <button type="button" class="so-hd__btn so-hd__btn--icon so-fav-btn${isFav ? ' active' : ''}" id="so-fav-btn" onclick="toggleFav()" title="${isFav ? c.favRemove : c.favAdd}" aria-pressed="${isFav ? 'true' : 'false'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${ICON.star}</svg>
        <span class="so-hd__sr" id="so-fav-label">${isFav ? c.favorited : c.favorite}</span>
      </button>
      <button type="button" class="so-hd__btn" onclick="soOpenSchedule(${adminInfo ? 'false' : 'true'})" title="${adminInfo ? c.scheduleTitle : c.notifyTitle}" aria-label="${c.schedule}">${icon(ICON.calendar)}<span class="so-hd__label">${c.schedule}</span></button>` : ''}${commentsBtn}${loggedIn ? `
      <button type="button" class="so-hd__btn so-hd__btn--primary" id="so-share-btn" onclick='openShare(${JSON.stringify(artifactId)},${JSON.stringify(slug)},${JSON.stringify(slug)},${adminInfo?.canEdit ? 'true' : 'false'})' title="${c.shareTitle}" aria-label="${c.share}">${icon(ICON.share)}<span class="so-hd__label">${c.share}</span></button>` : ''}
    </div>
  </header>${canPost && commentsEnabled ? `
  <div id="so-pins-layer"></div>
  <div id="so-comments-overlay" data-identity-mode="${commentsIdentityMode}" data-logged-in="${loggedIn ? '1' : '0'}" data-guest="${!loggedIn && commentsGuest ? '1' : '0'}">
    <div id="so-comments-panel" class="so-side" role="dialog" aria-modal="false" aria-labelledby="so-cmt-title">
      <div class="so-side__head">
        <h3 class="so-side__title" id="so-cmt-title">${c.comments}<span class="so-cmt-presence" id="so-cmt-presence"></span></h3>
        <button class="so-side__close" onclick="closeComments()" aria-label="${c.closeComments}">${icon(ICON.close, 18)}</button>
      </div>
      <div class="so-cmt-tabs">
        <button class="so-cmt-tab active" id="so-cmt-tab-open" onclick="setCommentFilter('open')">${c.open}</button>
        <button class="so-cmt-tab" id="so-cmt-tab-resolved" onclick="setCommentFilter('resolved')">${c.resolved}</button>
      </div>
      <div class="so-cmt-list" id="so-cmt-list">
        <div class="so-cmt-loading">${c.loadingComments}</div>
      </div>
      <div class="so-cmt-typing" id="so-cmt-typing"></div>
      <div class="so-cmt-conn" id="so-cmt-conn" aria-live="polite"></div>
      <div class="so-cmt-composer">
        <div class="so-cmt-mentionbox" id="so-cmt-mentionbox"></div>
        ${!loggedIn && commentsGuest ? renderGuestPanel(GUEST_COPY[locale]) : ''}${!loggedIn && !commentsGuest ? `<input type="text" class="so-cmt-textarea" id="so-cmt-guest-name" placeholder="${commentsIdentityMode === 'named' ? c.nameRequired : c.nameOptional}" aria-label="${c.yourName}" maxlength="80" style="min-height:0;height:36px;margin-bottom:8px;resize:none">` : ''}
        <textarea class="so-cmt-textarea" id="so-cmt-input" placeholder="${c.addComment}${loggedIn ? c.useMention : ''}" aria-label="${c.addCommentAria}"></textarea>
        <div class="so-cmt-composer-actions">
          <button class="so-cmt-pinbtn" id="so-cmt-pinbtn" onclick="togglePinMode()" title="${c.pinTitle}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.686-6-10a6 6 0 0 1 12 0c0 4.314-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>
            <span id="so-cmt-pinbtn-label">${c.pinToPage}</span>
          </button>
          <button class="so-cmt-submit" id="so-cmt-submit" onclick="submitComment()">${c.comment}</button>
        </div>
        <div class="so-cmt-replying" id="so-cmt-replying" style="margin-top:8px"></div>
      </div>
    </div>
  </div>` : ''}${showSkills ? `
  <div id="so-skills-overlay">
    <div id="so-skills-panel" class="so-side" role="dialog" aria-modal="false" aria-labelledby="so-skills-title">
      <div class="so-side__head">
        <h3 class="so-side__title" id="so-skills-title">${c.attachedSkills}</h3>
        <button class="so-side__close" onclick="soCloseSkills()" aria-label="${c.close}">${icon(ICON.close, 18)}</button>
      </div>
      <div class="so-skills-body">
        <p class="so-skills-intro">${c.skillsIntro}</p>
        <div class="so-skills-list">
          ${skills.map(s => `<a class="so-skill-chip" href="${baseUrl}/a/${escapeHtml(s.slug)}/" target="_blank" rel="noopener">${icon(ICON.book, 13)}<span>${escapeHtml(s.name)}</span></a>`).join('')}
        </div>
      </div>
    </div>
  </div>` : ''}`;
}
