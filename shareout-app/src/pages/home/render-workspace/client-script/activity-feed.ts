/** Activity feed, Brief widgets, and tile/table artifact widgets. */
export const workspace_client_activity_feed_JS = `  // ===== activity feed + brief widgets =====
  // Grouped row: same event repeated (kind|artifact|actor) collapses to one with an Nx count.
  function evRow(g, dismissable) {
    var e = g.e || g; var count = g.count || 1; var ids = g.ids ? g.ids.join(',') : e.id; var ts = g.ts || e.ts;
    var ic = e.actor_picture ? '<img src="' + esc(e.actor_picture) + '" alt="">' : (KIND_ICON[e.kind] || '\\u2022');
    var top = e.actor ? esc(e.actor) : esc(e.artifact_name || (e.kind === 'unused_artifacts' ? t('evt.cleanup') : ''));
    var sum = e.actor && e.artifact_name ? (esc(e.summary) + ' \\u00B7 ' + esc(e.artifact_name)) : esc(e.summary);
    if (count > 1) sum += ' \\u00B7 ' + count + '\\u00D7';
    var x = dismissable ? '<button class="wsx-ev__x" data-eids="' + esc(ids) + '" type="button" title="' + esc(t('inspector.dismiss')) + '" aria-label="' + esc(t('inspector.dismiss')) + '">\\u00D7</button>' : '';
    // One-click "archive all" for the janitor card → 30-day trash. Workspace card: admins
    // only. Personal card (no workspaceId, personal home so no WSX_WS): always the owner.
    var janOk = e.kind === 'unused_artifacts' && ((window.WSX_ADMIN && e.workspaceId) || (!window.WSX_WS && !e.workspaceId));
    var act = janOk
      ? '<button type="button" class="so-c-btn so-c-btn--secondary so-c-btn--sm" data-unused-archive="' + esc(e.workspaceId || '') + '" data-unused-n="' + (e.count || 0) + '">' + esc(t('evt.archiveAll')) + '</button>'
      : '';
    // Workspace-level cards (unused pages, files) carry no artifact slug — route them to /home.
    var href = e.slug ? '/a/' + encodeURIComponent(e.slug) + '/' : '/home';
    return '<a class="wsx-ev" data-kind="' + esc(e.kind) + '" data-name="' + esc(e.artifact_name) + '" data-id="' + esc(e.artifact_id) + '" href="' + href + '">'
      + '<span class="wsx-ev__ic">' + ic + '</span>'
      + '<span class="wsx-ev__main"><span class="wsx-ev__top">' + top + '</span><span class="wsx-ev__sum">' + sum + '</span></span>'
      + act
      + '<span class="wsx-ev__time">' + timeAgo(ts) + '</span>' + x + '</a>';
  }
  // Group duplicate events (same as the Activity panel) so 4× "sheets_append failed" is one row.
  function fill(id, rows, empty, dismissable) {
    var el = document.getElementById(id); if (!el) return;
    var groups = groupFeed(rows);
    var cEl = document.getElementById(id + 'Count');
    if (cEl) cEl.textContent = groups.length ? String(groups.length) : '';
    var wdg = el.closest('.wsx-widget'); if (wdg) wdg.classList.toggle('is-empty-hidden', !groups.length);
    el.innerHTML = groups.length ? groups.map(function (g) { return evRow(g, dismissable); }).join('') : '<div class="wsx-empty">' + empty + '</div>';
  }
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
        renderActivity();
        fill('wsxNeedsYou', needsEvents, t('activity.nothingNeedsYou'), true);
        var runs = pulseEvents.filter(function (e) { return e.kind === 'run'; });
        fill('wsxRuns', runs, t('activity.noRecentRuns'), false);
        var nEl = document.getElementById('wsxNarration');
        if (nEl) {
          var bits = [];
          var needN = groupFeed(needsEvents).length, pulseN = pulseEvents.length;
          if (needN) bits.push(t(needN === 1 ? 'activity.needsYouPlural' : 'activity.needsYou').replace('{n}', String(needN)));
          if (pulseN) bits.push(t(pulseN === 1 ? 'activity.update' : 'activity.updates').replace('{n}', String(pulseN)));
          nEl.innerHTML = bits.length ? esc(t('activity.sinceAway').replace('{summary}', bits.join(', ')))
            : '<span class="muted">' + esc(t('activity.allCaughtUp')) + '</span>';
        }
      })
      .catch(function () {});
  }
  loadFeed();

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
  var TBL_HEAD = '<div class="wsx-tbl__head"><span></span><span>' + esc(t('widget.colName')) + '</span><span>' + esc(t('widget.colType')) + '</span><span>' + esc(t('widget.colViews')) + '</span><span>' + esc(t('widget.colUpdated')) + '</span></div>';
  function widgetView(id) { try { return localStorage.getItem(VIEW_LS + id) === 'table' ? 'table' : 'tile'; } catch (e) { return 'tile'; } }
  function renderArtView(id) {
    var el = document.getElementById(id); var d = ART_DATA[id]; if (!el || !d) return;
    var head = d.folderHead || '';
    var body = !d.count
      ? '<div class="wsx-empty">' + esc(d.empty || t('common.nothingHere')) + '</div>'
      : (widgetView(id) === 'table'
        ? '<div class="wsx-tbl">' + TBL_HEAD + (d.rowsHtml || '') + '</div>'
        : '<div class="artifacts-grid">' + (d.cardsHtml || '') + '</div>');
    el.innerHTML = head + body;
    localizeFragment(el);
    hidePendingArts(el);
  }
  function syncViewSeg(id) {
    var seg = document.querySelector('[data-viewseg-for="' + id + '"]'); if (!seg) return;
    var mode = widgetView(id);
    seg.querySelectorAll('[data-vw]').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-vw') === mode); });
  }
  ['wsxRecentW', 'wsxForYou', 'wsxArtMount'].forEach(syncViewSeg);
  ws.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-vw]'); if (!btn) return;
    var seg = btn.closest('[data-viewseg-for]'); if (!seg) return;
    var id = seg.getAttribute('data-viewseg-for'); var mode = btn.getAttribute('data-vw');
    try { localStorage.setItem(VIEW_LS + id, mode); } catch (_) {}
    seg.querySelectorAll('[data-vw]').forEach(function (x) { x.classList.toggle('is-on', x === btn); });
    renderArtView(id);
  });
  function fillCardWidget(id, url, empty) {
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var cEl = document.getElementById(id + 'Count');
        ART_DATA[id] = { cardsHtml: d && d.cardsHtml, rowsHtml: d && d.rowsHtml, count: (d && d.count) || 0, empty: empty };
        if (cEl) cEl.textContent = ART_DATA[id].count ? String(ART_DATA[id].count) : '';
        renderArtView(id);
      })
      .catch(function () {});
  }
  var homeWsq = window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '';
  fillCardWidget('wsxForYou', '/v1/home/for-you?limit=12' + homeWsq, t('activity.nothingForYou'));
  (function () {
    var id = 'wsxRecentW';
    fetch('/v1/home/recent?limit=8' + homeWsq, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var el = document.getElementById(id); var cEl = document.getElementById(id + 'Count');
        var n = (d && d.count) || 0;
        var wdg = el && el.closest('.wsx-widget'); if (wdg) wdg.classList.toggle('is-empty-hidden', !n);
        if (cEl) cEl.textContent = n ? String(n) : '';
        ART_DATA[id] = { cardsHtml: d && d.cardsHtml, rowsHtml: d && d.rowsHtml, count: n, empty: t('activity.recentEmpty') };
        renderArtView(id);
      })
      .catch(function () {});
  })();

`;
