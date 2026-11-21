/** Activity feed, Brief widgets, and tile/table artifact widgets. */
export const workspace_client_activity_feed_JS = `  // ===== activity feed + brief widgets =====
  var recentItems = [], homeLoaded = {};
  // Grouped row: same event repeated (kind|artifact|actor) collapses to one with an Nx count.
  // actLabel: what the row's button says (Reply, Review, Open) — the whole row is the link.
  function evRow(g, dismissable, actLabel) {
    var e = g.e || g; var count = g.count || 1; var ids = g.ids ? g.ids.join(',') : e.id; var ts = g.ts || e.ts;
    var top = e.actor ? esc(e.actor) : esc(e.artifact_name || (e.kind === 'unused_artifacts' ? t('evt.cleanup') : ''));
    var sum = e.actor && e.artifact_name ? (esc(e.summary) + ' \\u00B7 ' + esc(e.artifact_name)) : esc(e.summary);
    if (count > 1) sum += ' \\u00B7 ' + count + '\\u00D7';
    var x = dismissable ? '<button class="wsx-ev__x" data-eids="' + esc(ids) + '" type="button" title="' + esc(t('inspector.dismiss')) + '" aria-label="' + esc(t('inspector.dismiss')) + '">\\u00D7</button>' : '';
    // One-click "archive all" for the janitor card → 30-day trash. Workspace card: admins
    // only. Personal card (no workspaceId, personal home so no WSX_WS): always the owner.
    var janOk = e.kind === 'unused_artifacts' && ((window.WSX_ADMIN && e.workspaceId) || (!window.WSX_WS && !e.workspaceId));
    var act = janOk
      ? '<button type="button" class="so-c-btn so-c-btn--secondary so-c-btn--sm" data-unused-archive="' + esc(e.workspaceId || '') + '" data-unused-n="' + (e.count || 0) + '">' + esc(t('evt.archiveAll')) + '</button>'
      : (actLabel ? '<span class="wsx-ev__go">' + esc(actLabel) + '</span>' : '');
    // Workspace-level cards (unused pages, files) carry no artifact slug — route them to /home.
    var href = e.slug ? '/a/' + encodeURIComponent(e.slug) + '/' : '/home';
    return '<a class="wsx-ev" data-kind="' + esc(e.kind) + '" data-name="' + esc(e.artifact_name) + '" data-id="' + esc(e.artifact_id) + '" href="' + href + '">'
      + iconChip(e, 'wsx-ev__ic')
      + '<span class="wsx-ev__main"><span class="wsx-ev__top">' + top + '</span><span class="wsx-ev__sum">' + sum + '</span></span>'
      + act
      + '<span class="wsx-ev__time">' + timeAgo(ts) + '</span>' + x + '</a>';
  }
  // Needs you on Home: fresh items only (older than two weeks stay in the bell), each with
  // the action it asks for. Returns how many are shown, for the line under the greeting.
  var NEEDS_FRESH_MS = 14 * 864e5;
  function needsAct(k) {
    if (k === 'comment' || k === 'reply' || k === 'mention' || k === 'message') return t('home.actReply');
    if (k === 'access' || k === 'admin_request') return t('home.actReview');
    return t('home.actOpen');
  }
  function renderNeeds() {
    var el = document.getElementById('wsxNeedsYou'); if (!el) return 0;
    var now = Date.now();
    var groups = groupFeed(needsEvents).filter(function (g) { return now - (g.ts < 1e12 ? g.ts * 1000 : g.ts) < NEEDS_FRESH_MS; });
    var n = document.getElementById('wsxNeedsN'); if (n) { n.hidden = !groups.length; n.textContent = String(groups.length); }
    el.innerHTML = groups.length
      ? groups.slice(0, 4).map(function (g) { return evRow(g, true, needsAct(g.e.kind)); }).join('')
      : '<div class="wsx-empty wsx-empty--calm">' + esc(t('activity.nothingNeedsYou')) + '</div>';
    return groups.length;
  }
  var WIN_LABEL = { today: 'inspector.today', '7d': 'inspector.win7d', '30d': 'inspector.win30d' };
  // Two-surface feed: actionable Needs You (individual, dismissable) + aggregated Pulse.
  // The first (boot) response is kept in feedBoot so the notifications bell primes its
  // badge from it instead of issuing a second /v1/home/activity-feed at boot.
  // (WSX_WIN is hoisted from inspector.ts but not yet assigned on this boot call.)
  var feedBoot = null;
  function loadFeed() {
    var wsq = window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '';
    var req = fetch('/v1/home/activity-feed?limit=50&window=' + (WSX_WIN || '7d') + wsq, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
    if (!feedBoot) feedBoot = req;
    req
      .then(function (d) {
        needsEvents = (d && d.needs) || [];
        pulseEvents = (d && d.pulse) || [];
        homeLoaded.feed = true;
        renderActivity();
        renderBriefLine(renderNeeds());
        var pw = document.getElementById('wsxPulseWin'); if (pw) pw.textContent = t(WIN_LABEL[WSX_WIN || '7d'] || 'inspector.win7d');
      })
      .catch(function () { homeLoaded.feed = true; renderActivity(); renderBriefLine(renderNeeds()); });
  }
  loadFeed();
  wireActivityControls();

  // Janitor "Archive all": soft-delete the workspace's unopened pages into the 30-day
  // trash (recoverable). Recomputed server-side, admin-gated. Confirm before swiping.
  ws.addEventListener('click', function (e) {
    var b = e.target.closest('[data-unused-archive]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var wid = b.getAttribute('data-unused-archive'); var n = b.getAttribute('data-unused-n') || '0';
    if (!window.confirm(n === '1' ? t('evt.archiveConfirmOne') : t('evt.archiveConfirm').replace('{n}', n))) return;
    // Exception to optimistic: the server recomputes which pages are unused, so the
    // button stays busy until it answers; then the feed refreshes and a toast confirms.
    b.disabled = true; b.textContent = t('evt.archiving');
    var url = wid ? '/v1/workspaces/' + encodeURIComponent(wid) + '/unused/archive' : '/v1/artifacts/unused/archive';
    fetch(url, { method: 'POST', credentials: 'same-origin' })
      .then(okOr)
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        var k = (d && (d.archived != null ? d.archived : d.count)); if (k == null) k = n;
        showToast(t('evt.archived').replace('{n}', String(k)), 'success');
        if (typeof artCache !== 'undefined') artCache = {};
        loadFeed();
      })
      .catch(function (e) { b.disabled = false; b.textContent = t('evt.archiveAll'); failToast(e, t('evt.archiveFailed')); });
  });

  // ===== artifact widgets: tile (cards) <-> table (rows), per-widget + persisted =====
  var ART_DATA = {};
  var VIEW_LS = 'wsx_view:';
  // Header cells carry the row cell classes so narrow containers hide header + cells together.
  // A widget sorted on the server (the paged Artifacts lens) passes its sort, 'col:dir': its
  // header is data-sort-own and each column carries data-artsort; other widgets sort in place.
  var TBL_COLS = [['icon', ''], ['name', 'widget.colName'], ['owner', 'widget.colCreatedBy'], ['shared', 'widget.colShared'], ['access', 'widget.colAccess'], ['type', 'widget.colType'], ['feat', 'widget.colFeatures'], ['tags', 'widget.colTags'], ['views', 'widget.colViews'], ['visitors', 'widget.colVisitors'], ['created', 'widget.colCreated'], ['date', 'widget.colUpdated'], ['acts', '']];
  function tblHead(sort) {
    var s = sort ? sort.split(':') : [];
    return '<div class="wsx-tbl__head"' + (sort ? ' data-sort-own' : '') + '>' + TBL_COLS.map(function (c) {
      var own = sort && c[1] ? ' data-artsort="' + c[0] + '"' + (s[0] === c[0] ? ' aria-sort="' + (s[1] === 'asc' ? 'ascending' : 'descending') + '"' : '') : '';
      var tip = c[0] === 'feat' ? ' data-tip="' + esc(t('widget.colFeaturesTip')) + '"' : '';
      return '<span class="wsx-tr__' + c[0] + '"' + own + tip + '>' + (c[1] ? esc(t(c[1])) : '') + '</span>';
    }).join('') + '</div>';
  }
  // Home's Your artifacts panes share one tile/table choice (stored under For you's key).
  var ARTS_IDS = { wsxRecentArts: 1, wsxForYou: 1, wsxFavArts: 1, wsxSharedArts: 1 };
  function widgetView(id) { try { return localStorage.getItem(VIEW_LS + (ARTS_IDS[id] ? 'wsxForYou' : id)) === 'table' ? 'table' : 'tile'; } catch (e) { return 'tile'; } }
  // Small tiles carry their time as data-ts (D1 "YYYY-MM-DD HH:MM:SS" is UTC); show it as "3h".
  function fillTimes(root) {
    root.querySelectorAll('[data-ts]').forEach(function (x) {
      var v = x.getAttribute('data-ts') || '';
      var ms = /^\\d+$/.test(v) ? Number(v) : Date.parse(/^\\d{4}-\\d\\d-\\d\\d \\d/.test(v) ? v.replace(' ', 'T') + 'Z' : v);
      x.textContent = isNaN(ms) ? '' : timeAgo(ms);
    });
  }
  function renderArtView(id) {
    var el = document.getElementById(id); var d = ART_DATA[id]; if (!el || !d) return;
    var head = d.folderHead || '';
    var body = !d.count
      ? (d.emptyCta && typeof newBtn !== 'undefined' && newBtn
        ? '<div class="wsx-empty wsx-empty--first"><p>' + esc(t('artifacts.emptyFirst')) + '</p><button type="button" class="so-c-btn so-c-btn--primary" data-art-first>' + esc(t('artifacts.createFirst')) + '</button></div>'
        : '<div class="wsx-empty">' + esc(d.empty || t('common.nothingHere')) + '</div>')
      : (widgetView(id) === 'table'
        ? '<div class="wsx-tbl wsx-tbl--art">' + tblHead(d.sort) + (d.rowsHtml || '') + '</div>'
        : d.miniHtml != null ? '<div class="wsx-minis">' + d.miniHtml + '</div>'
        : (d.foldersHtml ? '<div class="wsx-art-folders">' + d.foldersHtml + '</div>' : '')
          + (d.cardsHtml ? '<div class="artifacts-grid">' + d.cardsHtml + '</div>' : ''));
    el.innerHTML = head + body;
    localizeFragment(el);
    fillTimes(el);
    hidePendingArts(el);
  }
  function syncViewSeg(id) {
    var seg = document.querySelector('[data-viewseg-for="' + id + '"]'); if (!seg) return;
    var mode = widgetView(id);
    seg.querySelectorAll('[data-vw]').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-vw') === mode); });
  }
  ['wsxForYou', 'wsxArtMount', 'wsxAssetMount'].forEach(syncViewSeg);
  ws.addEventListener('click', function (e) {
    if (e.target.closest('[data-art-first]')) { newDoc('blank'); return; }
    var btn = e.target.closest('[data-vw]'); if (!btn) return;
    var seg = btn.closest('[data-viewseg-for]'); if (!seg) return;
    var id = seg.getAttribute('data-viewseg-for'); var mode = btn.getAttribute('data-vw');
    try { localStorage.setItem(VIEW_LS + id, mode); } catch (_) {}
    seg.querySelectorAll('[data-vw]').forEach(function (x) { x.classList.toggle('is-on', x === btn); });
    (ARTS_IDS[id] ? Object.keys(ARTS_IDS) : [id]).forEach(renderArtView);
  });
  function fillCardWidget(id, url, empty) {
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        ART_DATA[id] = { cardsHtml: d && d.cardsHtml, rowsHtml: d && d.rowsHtml, miniHtml: (d && d.miniHtml) || '', count: (d && d.count) || 0, empty: empty };
        renderArtView(id);
        homeLoaded.foryou = true;
      })
      .catch(function () { homeLoaded.foryou = true; ART_DATA[id] = { miniHtml: '', rowsHtml: '', count: 0, empty: empty }; renderArtView(id); });
  }
  var homeWsq = window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '';
  fillCardWidget('wsxForYou', '/v1/home/for-you?limit=9' + homeWsq, t('activity.nothingForYou'));
  fetch('/v1/home/recent?limit=12' + homeWsq, { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) { recentItems = (d && d.items) || []; ART_DATA.wsxRecentArts = { miniHtml: (d && d.miniHtml) || '', rowsHtml: (d && d.rowsHtml) || '', count: (d && d.count) || 0, empty: t('home.noRecent') }; })
    .catch(function () { ART_DATA.wsxRecentArts = { miniHtml: '', rowsHtml: '', count: 0, empty: t('home.noRecent') }; })
    .then(function () { homeLoaded.recent = true; renderArtView('wsxRecentArts'); briefArtsDefault(recentItems.length); });

`;
