import type { Env } from '../../types';
/**
 * Server-rendered HTML fragments for artifact cards, folders, and empty states.
 */
import { escapeHtml } from '../../html/utils';
import type { ArtifactRow, HomeFilters, HomeFolder, RecentActivityRow, RecentCommentRow } from './types';
import { FEATURE_META, TYPE_META } from './constants';
import { artifactTypeGroup } from './filters';
import { buildResultLabel, fmtCount, buildArtifactShareUrl } from './utils';

/** analytics_events.timestamp is stored as unix seconds; tolerate ms and ISO too. */
function parseTs(ts: string | number): number {
  const n = typeof ts === 'number' ? ts : Number(ts);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  return new Date(ts).getTime();
}

function timeAgo(ts: string | number): string {
  const ms = parseTs(ts);
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Inner HTML for the Activity panel — lazy-loaded via /v1/home/activity. */
export function renderRecentActivity(rows: RecentActivityRow[]): string {
  if (!rows.length) {
    return '<div class="detail-empty">No recent activity yet. Views show up here as people open your artifacts.</div>';
  }
  return `<div class="activity-table" role="table">
      <div class="activity-row activity-row--head" role="row">
        <span role="columnheader">Artifact</span>
        <span role="columnheader">Event</span>
        <span role="columnheader">Location</span>
        <span role="columnheader" class="activity-c-time">When</span>
      </div>
      ${rows.map(act => `
      <div class="activity-row" role="row">
        <span class="activity-c-name" role="cell"><span class="activity-dot"></span><strong>${escapeHtml(act.artifact_name)}</strong></span>
        <span class="activity-c-event" role="cell">${escapeHtml(act.event_type || 'view')}</span>
        <span class="activity-c-loc" role="cell">${act.country ? escapeHtml(act.country) : '—'}</span>
        <span class="activity-c-time" role="cell" title="${escapeHtml(String(act.timestamp))}">${timeAgo(act.timestamp)}</span>
      </div>`).join('')}
    </div>`;
}

/** Inner HTML for the Conversations panel — recent comments across artifacts. */
export function renderRecentComments(rows: RecentCommentRow[]): string {
  if (!rows.length) {
    return '<div class="detail-empty">No conversations yet. Comments across your artifacts show up here.</div>';
  }
  return `<div class="conv-feed">
    ${rows.map(c => {
      const snippet = c.content.length > 120 ? c.content.slice(0, 120) + '…' : c.content;
      return `<a class="conv-item" href="/a/${encodeURIComponent(c.slug)}/">
        <span class="conv-dot${c.resolved ? ' resolved' : ''}"></span>
        <span class="conv-body">
          <span class="conv-line"><strong>${escapeHtml(c.author_name)}</strong> on <strong>${escapeHtml(c.artifact_name)}</strong></span>
          <span class="conv-snippet">${escapeHtml(snippet)}</span>
        </span>
        <span class="conv-time" title="${escapeHtml(String(c.created_at))}">${timeAgo(c.created_at)}</span>
      </a>`;
    }).join('')}
  </div>`;
}

const VIS_LOCK_ICON = '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
const VIS_PEOPLE_ICON = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';

const CREATE_STAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/></svg>';

function renderCreateCta(createEnabled: boolean): string {
  if (!createEnabled) return '';
  return `<button class="empty-cta" onclick="window.location.href='/create'">
      ${CREATE_STAR_SVG}
      Create with AI
    </button>`;
}

function ownerInitials(name: string | null): string {
  const n = (name || '').trim();
  if (!n) return '?';
  return n.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

function renderOwnerAvatar(a: ArtifactRow): string {
  const isYou = a.user_role === 'owner';
  const label = isYou ? 'You' : (a.owner_name || 'Unknown');
  const inner = a.owner_picture
    ? `<img src="${escapeHtml(a.owner_picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
    : escapeHtml(ownerInitials(a.owner_name));
  return `<span class="card-owner" title="Owner: ${escapeHtml(label)}"><span class="owner-avatar">${inner}</span><span class="owner-name">${escapeHtml(label)}</span></span>`;
}

function renderVisibilityBadge(a: ArtifactRow): string {
  const isWs = a.visibility === 'workspace';
  const visLabel = isWs ? 'All Workspace' : 'Private';
  const visClass = isWs ? 'badge-workspace' : 'badge-private';
  const visIcon = isWs ? VIS_PEOPLE_ICON : VIS_LOCK_ICON;
  const id = escapeHtml(a.id);
  const inner = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${visIcon}</svg>${escapeHtml(visLabel)}`;
  const canToggle = a.user_role === 'owner' && !!a.workspace_id;
  if (canToggle) {
    const nextVis = isWs ? 'private' : 'workspace';
    const title = isWs ? 'Make private — click to toggle' : 'Share with workspace — click to toggle';
    return `<button type="button" class="card-badge card-preview-badge vis-toggle ${visClass}" id="badge-${id}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" onclick="event.stopPropagation();event.preventDefault();toggleVisibility('${id}','${nextVis}')">${inner}</button>`;
  }
  return `<span class="card-badge card-preview-badge ${visClass}" id="badge-${id}">${inner}</span>`;
}

// Amber "Under review" while a public publish is held private by the safety check;
// red "Blocked" on takedown. Nothing on approved pages (the common case).
function renderModerationBadge(a: ArtifactRow): string {
  const held = a.moderation_status === 'pending' && !!a.moderation_held_visibility;
  const blocked = a.moderation_status === 'blocked';
  if (!held && !blocked) return '';
  const cls = blocked ? 'badge-blocked' : 'badge-review';
  const label = blocked ? 'Blocked' : 'Under review';
  return `<span class="card-badge card-preview-badge ${cls}">${escapeHtml(label)}</span>`;
}

export function renderArtifactCard(a: ArtifactRow, hostname: string, env?: Env): string {
  const tm = TYPE_META[a.artifact_type] || TYPE_META.html;
  const date = a.updated_at || a.created_at;
  const formattedDate = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const pageUrl = buildArtifactShareUrl(hostname, a.slug, a.display_slug, undefined, undefined, env);
  const tagList = a.tags ? a.tags.split('\n').filter(Boolean) : [];
  const tagsHtml = tagList.length ? `
      <div class="card-tags">
        ${tagList.map(t => `<button type="button" class="card-tag" onclick="event.stopPropagation();event.preventDefault();filterByTag(this.textContent)" title="Filter by ${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>` : '';
  const features = FEATURE_META.filter(f => (a[f.key] as number) > 0);
  const featuresHtml = features.length ? `
      <div class="card-features">
        ${features.map(f => `<span class="feature" title="${escapeHtml(f.label)}" aria-label="${escapeHtml(f.label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${f.svg}</svg></span>`).join('')}
      </div>` : '';

    return `
    <article class="artifact-card"
      draggable="${a.user_role === 'owner' ? 'true' : 'false'}"
      data-id="${escapeHtml(a.id)}"
      data-visibility="${escapeHtml(a.visibility)}"
      data-workspace="${escapeHtml(a.workspace_id || '')}"
      data-owner-name="${escapeHtml(a.user_role === 'owner' ? 'You' : (a.owner_name || 'Unknown'))}"
      data-owner-pic="${escapeHtml(a.owner_picture || '')}"
      data-shared="${a.user_role !== 'owner' ? '1' : '0'}"
      data-favorite="${a.is_favorite ? '1' : '0'}"
      data-type-group="${artifactTypeGroup(a.artifact_type)}"
      data-name="${escapeHtml(a.name.toLowerCase())}"
      data-tags="${escapeHtml(tagList.join('\n').toLowerCase())}"
      data-role="${escapeHtml(a.user_role)}"
      data-folder="${escapeHtml(a.folder_id || '')}"
      data-example="${a.is_example ? '1' : '0'}"
      data-slug="${escapeHtml(a.slug)}"
      data-display-slug="${escapeHtml(a.display_slug || a.slug)}"
      data-type="${escapeHtml(a.artifact_type || 'html')}"
      data-views="${a.total_views}"
      data-updated="${escapeHtml(a.updated_at || a.created_at)}"
      data-created="${escapeHtml(a.created_at)}">
      <button type="button" class="card-select" onclick="event.stopPropagation();event.preventDefault();toggleSelect('${escapeHtml(a.id)}')" aria-label="Select" title="Select">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <div class="card-preview-wrap">
        <a class="card-preview" href="/a/${escapeHtml(a.slug)}/" draggable="false" style="--type-color:${tm.color}">
          <img class="card-preview-img" src="/t/${escapeHtml(a.id)}_card.webp?v=${encodeURIComponent(a.updated_at || a.created_at)}" srcset="/t/${escapeHtml(a.id)}_card.webp?v=${encodeURIComponent(a.updated_at || a.created_at)} 720w, /t/${escapeHtml(a.id)}.webp?v=${encodeURIComponent(a.updated_at || a.created_at)} 2400w" sizes="300px" alt="" loading="lazy" draggable="false" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="card-preview-fallback" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${tm.svg}</svg></span>
          <span class="type-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${tm.svg}</svg>${escapeHtml(tm.label)}</span>
        </a>
        ${renderVisibilityBadge(a)}
        ${renderModerationBadge(a)}
      </div>
      <div class="card-actions">
        <button class="card-action-btn icon-only fav-toggle${a.is_favorite ? ' active' : ''}" onclick="event.stopPropagation();toggleFavorite('${escapeHtml(a.id)}')" title="${a.is_favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${a.is_favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${a.is_favorite ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" fill="${a.is_favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
        <a class="card-action-btn icon-only" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener" draggable="false" onclick="event.stopPropagation();" title="Open in new tab" aria-label="Open in new tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
        </a>
        <button class="card-action-btn icon-only" onclick="event.stopPropagation();copyLink('${escapeHtml(pageUrl)}')" title="Copy link" aria-label="Copy link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
        ${a.user_role === 'owner' ? `
        <a class="card-action-btn icon-only" href="/v1/artifacts/${escapeHtml(a.id)}/export" download onclick="event.stopPropagation();" title="Export (your data is yours)" aria-label="Export">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>` : ''}
        ${a.user_role === 'owner' ? `
        <button class="card-action-btn icon-only" onclick="event.stopPropagation();openFolderPicker(['${escapeHtml(a.id)}'])" title="Move to folder" aria-label="Move to folder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>` : ''}
        ${a.user_role === 'owner' ? `
        <button class="card-action-btn icon-only danger" onclick="event.stopPropagation();confirmDelete('${escapeHtml(a.id)}')" title="Delete" aria-label="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>` : ''}
      </div>
      <div class="card-body">
        <div class="card-top">
          <span class="card-type-icon" style="--type-color:${tm.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tm.svg}</svg></span>
          <a class="card-title" href="/a/${escapeHtml(a.slug)}/" draggable="false">${escapeHtml(a.name)}</a>
          ${renderVisibilityBadge(a)}
        </div>
        ${a.description ? `<p class="card-description">${escapeHtml(a.description)}</p>` : ''}
        ${renderOwnerAvatar(a)}
        <div class="card-meta">
          <span class="card-meta-item" title="Views"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${fmtCount(a.total_views)}</span>
          <span class="card-meta-item" title="Unique visitors"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${fmtCount(a.unique_visitors)}</span>
          <span class="card-meta-item" title="Last updated"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${formattedDate}</span>
        </div>
        ${tagsHtml}
        ${featuresHtml}
      </div>
    </article>`;
}

/** Compact table row for the workspace Brief's table view (mirrors the card data). */
export function renderArtifactRow(a: ArtifactRow, _hostname: string): string {
  const tm = TYPE_META[a.artifact_type] || TYPE_META.html;
  const date = a.updated_at || a.created_at;
  const formattedDate = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `<a class="wsx-tr" href="/a/${escapeHtml(a.slug)}/" data-id="${escapeHtml(a.id)}" data-slug="${escapeHtml(a.slug)}" data-name="${escapeHtml(a.name)}">
    <span class="wsx-tr__icon" style="--type-color:${tm.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tm.svg}</svg></span>
    <span class="wsx-tr__name">${escapeHtml(a.name)}</span>
    <span class="wsx-tr__type">${escapeHtml(tm.label)}</span>
    <span class="wsx-tr__views">${fmtCount(a.total_views)}</span>
    <span class="wsx-tr__date">${formattedDate}</span>
  </a>`;
}

const FOLDER_SVG = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';

/** Drive-style folder tile for the All Artifacts grid. Click drills in; the
 *  hover actions (rename/delete) only render for users who can manage folders. */
export function renderFolderCard(f: HomeFolder, scope: 'workspace' | 'personal', canManage: boolean): string {
  // English fallback; the client localizes from data-count (see artifacts-browser localizeFolderCounts).
  const count = `${f.artifact_count} ${f.artifact_count === 1 ? 'artifact' : 'artifacts'}`;
  const nm = escapeHtml(f.name);
  const id = escapeHtml(f.id);
  const actions = canManage ? `
      <div class="wsx-folder-card__actions">
        <button type="button" class="wsx-folder-card__act" title="Rename folder" aria-label="Rename folder" onclick="event.stopPropagation();renameFolder('${id}',this.closest('.wsx-folder-card').getAttribute('data-folder-name'))">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button type="button" class="wsx-folder-card__act danger" title="Delete folder" aria-label="Delete folder" onclick="event.stopPropagation();deleteFolder('${id}',this.closest('.wsx-folder-card').getAttribute('data-folder-name'))">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>` : '';
  return `<article class="wsx-folder-card" data-scope="${scope}" data-folder-id="${id}" data-folder-name="${nm}" tabindex="0" role="button" onclick="enterFolder('${id}',this.getAttribute('data-folder-name'))" onkeydown="if(event.key==='Enter'){enterFolder('${id}',this.getAttribute('data-folder-name'))}">
      <span class="wsx-folder-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${FOLDER_SVG}</svg></span>
      <span class="wsx-folder-card__txt">
        <span class="wsx-folder-card__name">${nm}</span>
        <span class="wsx-folder-card__count" data-count="${f.artifact_count}">${count}</span>
      </span>${actions}
    </article>`;
}

export function renderHomeEmptyState(filters: HomeFilters, createEnabled = false): string {
  const { scope, search, type } = filters;
  return `
    <div class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      <h2 class="empty-title">${scope === 'favorites' ? 'No favorites yet' : search || type || scope === 'shared' ? 'Nothing here yet' : 'Your first artifact is one prompt away'}</h2>
      <p class="empty-description">${scope === 'favorites' ? 'Star an artifact to keep it here for quick access.' : search ? `No artifacts match “${escapeHtml(search)}”.` : type || scope === 'shared' ? 'Try a different filter, or create something new.' : 'Tell the AI what you want and it builds & publishes it for you.'}</p>
      ${renderCreateCta(createEnabled)}
    </div>`;
}
