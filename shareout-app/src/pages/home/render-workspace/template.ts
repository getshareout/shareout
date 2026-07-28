/**
 * Server-rendered HTML skeleton for the workspace shell (rail, canvas, activity, agent dock).
 */
import { escapeHtml } from '../../../html/utils';
import { brandLockupHtml } from '../../../brand';
import { parseBranding } from '../../../workspaces';
import type { RenderArgs } from '../types';
import { ICON } from './constants';
import { railNav, svg, widget, viewSeg, GRIP_SVG } from './helpers';
import { homeLangSwitchHtml } from '../home-i18n';
import type { NavItem } from './constants';

/** True when the viewer can open workspace admin surfaces. */
export function canManageWorkspace(args: RenderArgs): boolean {
  return args.workspaceRole === 'owner' || args.workspaceRole === 'admin';
}

/** Rail nav, scoped to context: workspace-only lenses appear only inside a workspace.
 *  Uses the same effective workspace the client hydrates with (workspaceId or ?workspace). */
function buildNav(args: RenderArgs, canManage: boolean): NavItem[] {
  const ws = !!(args.workspaceId || args.workspace);
  const items: NavItem[] = [
    { key: 'brief', label: 'Brief', i18n: 'nav.brief', icon: 'brief', kind: 'view' },
    { key: 'artifacts', label: 'All Artifacts', i18n: 'nav.artifacts', icon: 'browse', kind: 'view' },
    { key: 'schedules', label: 'My Schedules', i18n: 'nav.schedules', icon: 'recent', kind: 'view' },
    { key: 'alerts', label: 'My Alerts', i18n: 'nav.alerts', icon: 'alert', kind: 'view' },
    { key: 'analytics', label: 'Analytics', i18n: 'nav.analytics', icon: 'chart', kind: 'view' },
  ];
  if (ws) items.push({ key: 'datasets', label: 'Datasets', i18n: 'nav.datasets', icon: 'datasets', kind: 'view' });
  if (ws) items.push({ key: 'catalog', label: 'Catalog', i18n: 'nav.catalog', icon: 'catalog', kind: 'view' });
  if (ws) items.push({ key: 'knowledge', label: 'Knowledge', i18n: 'nav.knowledge', icon: 'knowledge', kind: 'view' });
  if (ws && canManage) items.push({ key: 'crew', label: 'Crew AI', i18n: 'nav.crew', icon: 'crew', kind: 'view' });
  items.push({ key: 'library', label: 'Library', i18n: 'nav.library', icon: 'library', kind: 'view' });
  items.push({ key: 'assets', label: 'Assets', i18n: 'nav.assets', icon: 'assets', kind: 'view' });
  if (ws) items.push({ key: 'connectors', label: 'Connectors', i18n: 'nav.connectors', icon: 'plug', kind: 'view' });
  if (ws && canManage) items.push({ key: 'admin', label: 'Admin', i18n: 'nav.admin', icon: 'admin', kind: 'view' });
  return items;
}

/** Builds the static workspace DOM inserted into the page body. */
export function buildWorkspaceBody(args: RenderArgs): string {
  const name = args.userInfo?.name || 'You';
  const initial = escapeHtml((name[0] || 'Y').toUpperCase());
  const avatar = args.userInfo?.picture
    ? `<img class="wsx__avatar" src="${escapeHtml(args.userInfo.picture)}" alt="">`
    : `<span class="wsx__avatar">${initial}</span>`;
  const canManage = canManageWorkspace(args);

  const brandWs = args.workspaceId ? args.workspaces.find(w => w.id === args.workspaceId) : undefined;
  const brandWsBranding = brandWs ? parseBranding(brandWs.branding) : null;
  const brandHtml = brandWs && brandWsBranding?.logo_ext
    ? `<a class="brand brand-ws" href="/home" title="${escapeHtml(brandWs.name)}"><img class="brand-ws-logo" src="/wl/${escapeHtml(brandWs.id)}.${escapeHtml(brandWsBranding.logo_ext)}" alt="${escapeHtml(brandWs.name)}"></a>`
    : brandLockupHtml({ markSize: 26, href: '/home' });
  const accent = brandWsBranding?.accent_color;
  const accentStyle = accent
    ? ` style="--color-primary:${accent};--color-primary-hover:${accent};--color-primary-light:color-mix(in srgb, ${accent} 12%, transparent);--color-primary-glow:color-mix(in srgb, ${accent} 35%, transparent)"`
    : '';

  // Account menu "Where you are" switcher — Personal + each Team Space (with logo if set).
  const spaceItem = (active: boolean, mark: string, title: string, titleI18n: string | null, desc: string, descI18n: string, space: string, slug: string) =>
    `<button class="wsx-space${active ? ' is-active' : ''}" data-space="${space}" data-slug="${slug}" type="button" role="menuitemradio" aria-checked="${active ? 'true' : 'false'}">
      <span class="wsx-space__mark">${mark}</span>
      <span class="wsx-space__txt"><span class="wsx-space__name"${titleI18n ? ` data-i18n="${titleI18n}"` : ''}>${title}</span><span class="wsx-space__desc" data-i18n="${descI18n}">${desc}</span></span>
    </button>`;
  const personIcon = svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>');
  const spacesHtml = [
    spaceItem(!args.workspaceId, `<span class="wsx-space__icon">${personIcon}</span>`, 'Personal', 'account.personal', 'Your private space — not shared with any team', 'account.personalDesc', '', ''),
    ...args.workspaces.map((w) => {
      const wb = parseBranding(w.branding);
      const mark = wb?.logo_ext
        ? `<img class="wsx-space__logo" src="/wl/${escapeHtml(w.id)}.${escapeHtml(wb.logo_ext)}" alt="">`
        : `<span class="wsx-space__initial">${escapeHtml((w.name[0] || '?').toUpperCase())}</span>`;
      return spaceItem(args.workspaceId === w.id, mark, escapeHtml(w.name), null, 'Team Space — shared with the workspace', 'account.teamDesc', escapeHtml(w.id), escapeHtml(w.slug || ''));
    }),
  ].join('');
  const langSwitch = homeLangSwitchHtml();

  return `
<div class="wsx" id="wsx"${accentStyle}>
  <div class="wsx__body" id="wsxBody">
    <aside class="wsx__rail" id="wsxRail">
      <div class="wsx__railtop">
        ${brandHtml}
        <button class="wsx__collapse" id="wsxCollapse" type="button" data-i18n-title="nav.collapse" data-i18n-aria="nav.collapse" title="Collapse" aria-label="Collapse sidebar">${svg('<path d="M15 6l-6 6 6 6"/>')}</button>
        <button class="wsx__railclose" id="wsxRailClose" type="button" data-i18n-aria="nav.closeMenu" aria-label="Close menu">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
      </div>
      <button class="wsx__create" id="wsxCreateBtn" type="button" data-i18n-title="nav.create" title="Create with AI">${svg(ICON.foryou)}<span data-i18n="nav.create">Create with AI</span></button>
      ${buildNav(args, canManage).map((n, i) => railNav(n, i === 0)).join('')}
      <div class="wsx__railgroup-title" data-i18n="nav.following">Following</div>
      <div class="wsx__follows" id="wsxFollows"></div>
      <div class="wsx__railspace"></div>
      <footer class="wsx__railfoot">
        <button class="wsx__footbtn" id="wsxHelpBtn" type="button" data-i18n-aria="help.title" data-i18n-title="help.title" aria-label="Help &amp; support" title="Help &amp; support">${svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>')}</button>
        <a class="wsx__footbtn" href="https://docs.shareout.site" target="_blank" rel="noopener" data-i18n-aria="foot.docs" data-i18n-title="foot.docs" aria-label="Documentation" title="Documentation">${svg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>')}</a>
        ${args.appVersion ? `<span class="wsx__footver" title="Release ${escapeHtml(args.appVersion)}">v${escapeHtml(args.appVersion)}</span>` : ''}
      </footer>
    </aside>

    <main class="wsx__canvas">
      <div class="wsx__chrome">
        <button class="wsx__hamb" id="wsxHamb" type="button" data-i18n-aria="nav.openMenu" aria-label="Open menu" aria-controls="wsxRail" aria-expanded="false">${svg('<path d="M3 6h18M3 12h18M3 18h18"/>')}</button>
        <div class="wsx__tabs" id="wsxTabs"></div>
        <div class="wsx__tabmode" id="wsxTabMode" hidden><button data-mode="view" class="is-on" type="button" data-i18n="tabs.view">View</button><button data-mode="edit" type="button" data-i18n="tabs.edit">Edit</button></div>
        <button class="wsx__search" id="wsxOpenSearch" type="button" data-i18n-aria="palette.aria" aria-label="Search" data-i18n-title="palette.aria" title="Search (⌘K)">${svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>')}<span class="wsx__search-label" data-i18n="palette.search">Search</span><kbd class="wsx__search-kbd">⌘K</kbd></button>
        <button class="wsx__tabdevice" id="wsxTabDevice" type="button" hidden aria-pressed="false" data-i18n-title="tabs.mobilePreview" data-i18n-aria="tabs.mobilePreview" title="Toggle mobile preview" aria-label="Toggle mobile preview">${svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>')}</button>
        <button class="wsx__tabdevice" id="wsxTabFull" type="button" hidden data-i18n-title="tabs.fullScreen" data-i18n-aria="tabs.fullScreen" title="Full screen" aria-label="View full screen">${svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>')}</button>
        <button class="wsx__notifbtn" id="wsxNotifBtn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="wsxNotifPanel" data-i18n-title="notif.title" data-i18n-aria="notif.title" title="Notifications" aria-label="Notifications">${svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>')}<span class="wsx__notifbadge" id="wsxNotifBadge" hidden>0</span></button>
        <button class="wsx__acct wsx__acct--mob" id="wsxAcctBtnMob" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="wsxAccPanel" title="Account">${avatar}<span class="wsx__acctname">${escapeHtml(name)}</span></button>
      </div>
      <div class="wsx__panes" id="wsxPanes">
        <div class="wsx__pane is-active" data-pane="home" id="wsxHomePane">
          <div class="wsx__view is-active" data-view="brief">
            <p class="wsx__narration" id="wsxNarration"><span class="muted" data-i18n="narration.reading">Reading your workspace…</span></p>
            <div class="wsx__brief">
              ${widget('wsxRecentW', 'widget.recentlyViewed', 'Recently viewed', 'recent', true, true)}
              ${widget('wsxNeedsYou', 'widget.needsYou', 'Needs you', 'shared')}
              ${widget('wsxRuns', 'widget.runs', 'Runs', 'recent')}
              <section class="wsx-widget wsx-widget--wide wsx-actwidget" id="wsxActWidget" data-wid="wsxActWidget">
                <div class="wsx-widget__head"><button class="wsx-widget__grip" type="button" data-i18n-aria="widget.drag" data-i18n-title="widget.drag" aria-label="Drag to reorder" title="Drag to reorder">${GRIP_SVG}</button><span class="wsx__live-dot"></span><span data-i18n="widget.activity">Activity</span></div>
                <div class="wsx-widget__body" id="wsxActBody"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
                <span class="wsx-widget__rz" aria-hidden="true"></span>
              </section>
              ${widget('wsxForYou', 'widget.forYou', 'For you', 'foryou', true, true)}
            </div>
          </div>
          <div class="wsx__view" data-view="artifacts">
            <h2 class="wsx__viewtitle" data-i18n="view.allArtifacts">All Artifacts</h2>
            <div class="wsx__chips" id="wsxArtChips">
              <button class="wsx-chip is-on" data-art-filter="recent" type="button" data-i18n="filter.recent">Recent</button>
              <button class="wsx-chip" data-art-filter="favorites" type="button" data-i18n="filter.favorites">Favorites</button>
              <button class="wsx-chip" data-art-filter="shared" type="button" data-i18n="filter.shared">Shared with me</button>
              <button class="wsx-chip" data-art-filter="mine" type="button" data-i18n="filter.mine">Mine</button>
              <div class="wsx__chips-right">
                <div class="wsx-qsearch">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                  <input type="search" id="wsxArtSearch" class="wsx-qsearch__inp" data-qs-local="1" data-i18n-placeholder="qsearch.placeholder" placeholder="Filter…" data-i18n-aria="qsearch.aria" aria-label="Filter artifacts" autocomplete="off" spellcheck="false">
                </div>
                ${viewSeg('wsxArtMount')}
                <button class="wsx-trash-link" id="wsxTrashBtn" type="button">${svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}<span data-i18n="filter.recentlyDeleted">Recently deleted</span></button>
              </div>
            </div>
            <div id="wsxArtMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="assets">
            <div class="wsx-assets__head">
              <h2 class="wsx__viewtitle" data-i18n="view.assets">Assets</h2>
              <div class="wsx-assets__headr">
                <button class="wsx-abtn" id="wsxAssetDeliveries" type="button">${svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>')}<span data-i18n="assets.sentDeliveries">Sent deliveries</span></button>
                <button class="wsx-assets__upload" id="wsxAssetUpload" type="button">${svg('<path d="M12 5v14"/><path d="M5 12h14"/>')}<span data-i18n="assets.uploadFiles">Upload files</span></button>
              </div>
            </div>
            <p class="wsx-lens__intro" data-i18n="intro.assets">Store images, video, and files once and reuse them across pages — every asset gets a permanent link you can embed in an artifact or send to a customer. Any file type.</p>
            <div class="wsx__chips" id="wsxAssetChips">
              <button class="wsx-chip is-on" data-asset-filter="all" type="button" data-i18n="filter.all">All</button>
              <button class="wsx-chip" data-asset-filter="image" type="button" data-i18n="filter.images">Images</button>
              <button class="wsx-chip" data-asset-filter="video" type="button" data-i18n="filter.video">Video</button>
              <button class="wsx-chip" data-asset-filter="doc" type="button" data-i18n="filter.docs">Docs</button>
            </div>
            <input type="file" id="wsxAssetFile" multiple hidden>
            <div id="wsxAssetMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="schedules">
            <h2 class="wsx__viewtitle" data-i18n="view.mySchedules">My Schedules</h2>
            <div id="wsxSchedMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="alerts">
            <h2 class="wsx__viewtitle" data-i18n="view.myAlerts">My Alerts</h2>
            <div id="wsxAlertMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="analytics">
            <h2 class="wsx__viewtitle" data-i18n="view.analytics">Analytics</h2>
            <div id="wsxAnalyticsMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="datasets">
            <h2 class="wsx__viewtitle" data-i18n="view.datasets">Datasets</h2>
            <p class="wsx-lens__intro" data-i18n="intro.datasets">Tables that workspace pages have shared — query them from any page with <code>so.workspace.table(name)</code>.</p>
            <div id="wsxDatasetMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="catalog">
            <h2 class="wsx__viewtitle" data-i18n="view.catalog">Catalog</h2>
            <p class="wsx-lens__intro" data-i18n="intro.catalog">Your workspace data map — sources, datasets, pipelines and terms, with lineage. Agents keep it current; search to trace where data comes from.</p>
            <div id="wsxCatMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="knowledge">
            <h2 class="wsx__viewtitle" data-i18n="view.knowledge">Knowledge</h2>
            <p class="wsx-lens__intro" data-i18n="intro.knowledge">What your workspace has learned from its pages — topics, clients and facts, kept up to date as you publish. Search it, or open a page to see where a fact came from.</p>
            <div id="wsxKnMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="crew">
            <h2 class="wsx__viewtitle" data-i18n="view.crew">Crew AI</h2>
            <p class="wsx-lens__intro" data-i18n="intro.crew">Autonomous agents that run on a schedule or an event, read your workspace data, and deliver a result. Run one now, pause it, or check its history.</p>
            <div id="wsxCrewMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="library">
            <h2 class="wsx__viewtitle" data-i18n="view.library">Library</h2>
            <div class="wsx__chips" id="wsxLibTabs">
              <button class="wsx-chip is-on" data-lib-tab="modules" type="button" data-i18n="lib.modules">Modules</button>
              <button class="wsx-chip" data-lib-tab="skills" type="button" data-i18n="lib.skills">Skills</button>
            </div>
            <div id="wsxLibMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="connectors">
            <h2 class="wsx__viewtitle" data-i18n="view.connectors">Connectors</h2>
            <p class="wsx-lens__intro" data-i18n="intro.connectors">Data sources your workspace can query by name — bring your own credentials once, then use them from any page.</p>
            <div id="wsxConnMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="admin">
            <h2 class="wsx__viewtitle" data-i18n="view.admin">Admin</h2>
            <div class="wsx__chips" id="wsxAdminTabs">
              <button class="wsx-chip is-on" data-admin-tab="overview" type="button" data-i18n="admin.overview">Overview</button>
              <button class="wsx-chip" data-admin-tab="artifacts" type="button" data-i18n="admin.artifacts">Artifacts</button>
              <button class="wsx-chip" data-admin-tab="members" type="button" data-i18n="admin.members">Members</button>
              <button class="wsx-chip" data-admin-tab="clients" type="button" data-i18n="admin.clients">Sharing</button>
              <button class="wsx-chip" data-admin-tab="automation" type="button" data-i18n="admin.automation">Automation</button>
              <button class="wsx-chip" data-admin-tab="ai" type="button" data-i18n="admin.ai">AI</button>
              <button class="wsx-chip" data-admin-tab="security" type="button" data-i18n="admin.security">Security</button>
              <button class="wsx-chip" data-admin-tab="support" type="button" data-i18n="admin.support">Support</button>
              <button class="wsx-chip" data-admin-tab="settings" type="button" data-i18n="admin.settings">Settings</button>
            </div>
            <div id="wsxAdminMount"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
          </div>
          <div class="wsx__view" data-view="agent">
            <h2 class="wsx__viewtitle" id="wsxAgentTitle" data-i18n="view.results">Results</h2>
            <div id="wsxAgentMount"></div>
          </div>
          <div class="wsx__view" data-view="create">
            <div class="wsx__chero">
              <h2 class="wsx__viewtitle" data-i18n="view.create">Create with AI</h2>
              <p class="wsx__csub" data-i18n="create.subtitle">Describe what you want — I’ll ask a couple quick questions, then build it live. Talk to me in the bar below.</p>
            </div>
            <div class="wsx__ccols">
              <section class="wsx-cpanel"><div class="wsx-panel-title" data-i18n="create.ideas">Ideas to start</div><div class="wsx__chips" id="wsxIdeas"></div></section>
              <section class="wsx-cpanel"><div class="wsx-panel-title" data-i18n="create.bringData">Bring your data</div><div class="wsx__chips" id="wsxSources"></div></section>
            </div>
          </div>
        </div>
      </div>

    </main>

    <aside class="wsx__activity">
      <button class="wsx__acthandle" id="wsxActHandle" type="button" aria-label="Drag to resize panel" title="Drag to resize"></button>
      <div class="wsx__rtabs" id="wsxRtabs"></div>
      <div class="wsx__rbody" id="wsxRbody"></div>
    </aside>
  </div>

  <div class="wsx__railscrim" id="wsxRailScrim" hidden></div>
  <div class="wsx__scrim" id="wsxScrim" hidden></div>
  <section class="wsx__composer" id="wsxComposer" data-state="resting">
    <div class="wsx__composer-grip" id="wsxComposerGrip" title="Drag to resize" aria-hidden="true"></div>
    <header class="wsx__composer-bar">
      <span class="wsx__composer-title"><span class="wsx__live-dot"></span><span data-i18n="composer.chat">Chat</span></span>
      <div class="wsx__composer-btns">
        <button type="button" id="wsxSearchBtn" data-i18n-title="composer.search" data-i18n-aria="composer.search" title="Search this chat" aria-label="Search this chat">${svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>')}</button>
        <button type="button" id="wsxThreadsBtn" data-i18n-title="composer.history" data-i18n-aria="composer.history" title="Chat history" aria-label="Chat history">${svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>')}</button>
        <button type="button" id="wsxNewChat" data-i18n-title="composer.newChat" data-i18n-aria="composer.newChat" title="New chat" aria-label="New chat">${svg('<path d="M12 5v14M5 12h14"/>')}</button>
        <button type="button" id="wsxComposerMin" data-i18n-title="composer.minimize" data-i18n-aria="composer.minimize" title="Minimize" aria-label="Minimize">${svg('<path d="M6 9l6 6 6-6"/>')}</button>
      </div>
    </header>
    <div class="wsx__threads" id="wsxThreads" hidden>
      <div class="wsx__threads-head"><span data-i18n="composer.chats">Chats</span><button type="button" id="wsxThreadsClose" data-i18n-aria="composer.closeHistory" aria-label="Close history">${svg('<path d="M18 6L6 18M6 6l12 12"/>')}</button></div>
      <div class="wsx__threads-list" id="wsxThreadsList"></div>
    </div>
    <div class="wsx__searchbar" id="wsxSearch" hidden>
      <input class="wsx__searchinput" id="wsxSearchInput" data-i18n-placeholder="composer.findInChat" placeholder="Find in chat…" data-i18n-aria="composer.findInChat" aria-label="Find in chat" autocomplete="off">
      <span class="wsx__searchcount" id="wsxSearchCount"></span>
      <button type="button" id="wsxSearchPrev" data-i18n-title="composer.prevMatch" data-i18n-aria="composer.prevMatch" title="Previous match" aria-label="Previous match">${svg('<path d="M18 15l-6-6-6 6"/>')}</button>
      <button type="button" id="wsxSearchNext" data-i18n-title="composer.nextMatch" data-i18n-aria="composer.nextMatch" title="Next match" aria-label="Next match">${svg('<path d="M6 9l6 6 6-6"/>')}</button>
      <button type="button" id="wsxSearchClose" data-i18n-title="composer.closeSearch" data-i18n-aria="composer.closeSearch" title="Close search" aria-label="Close search">${svg('<path d="M18 6L6 18M6 6l12 12"/>')}</button>
    </div>
    <div class="wsx__thread" id="wsxThread">
      <div class="wsx__threadlist" id="wsxThreadList"></div>
      <button type="button" class="wsx__scrolldown" id="wsxScrollDown" hidden data-i18n-aria="composer.scrollLatest" aria-label="Scroll to latest">${svg('<path d="M12 5v14M5 12l7 7 7-7"/>')}</button>
    </div>
    <div class="wsx__attachchip" id="wsxAttachChip" hidden></div>
    <form class="wsx__dockbar" id="wsxDock">
      ${svg(ICON.foryou)}
      <input class="wsx__dockinput" id="wsxAsk" data-i18n-placeholder="composer.placeholder" placeholder="Ask your workspace — “show me CPM artifacts”…" data-i18n-aria="composer.ask" aria-label="Ask your workspace" autocomplete="off">
      <input type="file" id="wsxAttachInput" hidden accept=".xlsx,.xls,.pptx,.csv,.pdf,image/*">
      <button class="wsx__dockattach" id="wsxAttach" type="button" data-i18n-aria="composer.attach" data-i18n-title="composer.attach" aria-label="Attach file" title="Attach file">${svg('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>')}</button>
      <button class="wsx__dockmic" id="wsxMic" type="button" data-i18n-aria="composer.voice" data-i18n-title="composer.voice" aria-label="Voice message" title="Voice message" hidden>${svg('<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>')}</button>
      <button class="wsx__docksend" type="submit" data-i18n-aria="composer.send" aria-label="Send">${svg('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button>
    </form>
  </section>

  <div class="wsx__help-scrim" id="wsxHelpScrim" hidden></div>
  <section class="wsx__help-panel" id="wsxHelpPanel" hidden data-i18n-aria="help.title" aria-label="Help and support">
    <header class="wsx__help-head"><span data-i18n="help.title">Help &amp; support</span><button type="button" id="wsxHelpClose" data-i18n-aria="help.close" aria-label="Close">${svg('<path d="M18 6L6 18M6 6l12 12"/>')}</button></header>
    <div class="wsx__help-body">
      <p class="wsx-lens__intro" data-i18n="help.intro">Hit a bug or have a question? Tell us — we'll reply here and by email.</p>
      <div class="wsx-field">
        <input class="wsx-field__in" id="wsxHelpSubject" type="text" data-i18n-placeholder="help.subject" placeholder="Short summary">
      </div>
      <div class="wsx-field">
        <textarea class="wsx-field__in wsx-field__ta" id="wsxHelpBody" data-i18n-placeholder="help.body" placeholder="What happened?"></textarea>
      </div>
      <div class="wsx__help-actions"><button class="wsx-abtn" id="wsxHelpSend" type="button" data-i18n="help.send">Send</button><span class="wsx-admin__savemsg" id="wsxHelpMsg"></span></div>
      <div class="wsx__help-mine" id="wsxHelpMine"></div>
    </div>
  </section>

  <div class="wsx__notif-scrim" id="wsxNotifScrim" hidden></div>
  <aside class="wsx__notif-panel" id="wsxNotifPanel" role="dialog" data-i18n-aria="notif.title" aria-label="Notifications" hidden>
    <header class="wsx__notif-head">
      <span class="wsx__notif-title" data-i18n="notif.title">Notifications</span>
      <div class="wsx__notif-headr">
        <button class="wsx__notif-readall" id="wsxNotifReadAll" type="button" hidden data-i18n="notif.markAll">Mark all read</button>
        <button class="wsx__notif-close" id="wsxNotifClose" type="button" data-i18n-aria="help.close" aria-label="Close">${svg('<path d="M18 6L6 18M6 6l12 12"/>')}</button>
      </div>
    </header>
    <div class="wsx__notif-tabs" role="tablist">
      <button class="wsx__notif-tab is-on" id="wsxNotifTabUnread" type="button" role="tab" data-tab="unread" aria-selected="true"><span data-i18n="notif.tabUnread">Unread</span><span class="wsx__notif-tabn" id="wsxNotifTabUnreadN" hidden>0</span></button>
      <button class="wsx__notif-tab" id="wsxNotifTabSeen" type="button" role="tab" data-tab="seen" aria-selected="false" data-i18n="notif.tabSeen">Seen</button>
    </div>
    <div class="wsx__notif-body" id="wsxNotifBody"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
  </aside>

  <div class="wsx__accpanel" id="wsxAccPanel" role="dialog" data-i18n-aria="account.title" aria-label="Account and spaces" hidden>
    <div class="wsx__accpanel-head">
      <div class="wsx__accmenu-head">${avatar}<span class="wsx__accmenu-name">${escapeHtml(name)}</span></div>
      <button class="wsx__accpanel-close" id="wsxAccClose" type="button" data-i18n-aria="help.close" aria-label="Close">${svg('<path d="M18 6L6 18M6 6l12 12"/>')}</button>
    </div>
    <div class="wsx__accpanel-body">
      <div class="wsx__accsec-title" data-i18n="account.whereYouAre">Where you are</div>
      <div class="wsx__spaces">${spacesHtml}</div>
      <div class="wsx__accdiv"></div>
      <div class="wsx__accsec-title" data-i18n="account.language">Language</div>
      ${langSwitch}
      <div class="wsx__accdiv"></div>
      <div class="wsx__accsec-title" data-i18n="account.linkedAccounts">Linked accounts</div>
      <p class="wsx__accsub" data-i18n="account.linkedDesc">Link your other emails to see all their workspaces from one login.</p>
      <div class="wsx__linked" id="wsxLinked"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
      <div class="wsx__accactions">
        <a class="wsx-accbtn" href="/settings/telegram?go=1" target="_blank" rel="noopener">${svg('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>')}<span data-i18n="account.telegram">Connect Telegram</span></a>
        <a class="wsx-accbtn" href="/v1/auth/link-google?redirect=%2Fhome%3Fnext%3D1">${svg('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>')}<span data-i18n="account.linkGoogle">Link Google account</span></a>
        <a class="wsx-accbtn wsx-accbtn--out" href="/auth/logout">${svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}<span data-i18n="account.signOut">Sign out</span></a>
      </div>
    </div>
  </div>

  <div class="wsx__trash" id="wsxTrash" hidden>
    <div class="wsx__trash-card">
      <div class="wsx__trash-head"><b data-i18n="trash.title">Recently deleted</b><button class="wsx__trash-close" id="wsxTrashClose" type="button" data-i18n-aria="help.close" aria-label="Close">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div>
      <div class="wsx__trash-list" id="wsxTrashList"><div class="wsx-empty" data-i18n="common.loading">Loading…</div></div>
    </div>
  </div>
</div>`;
}
