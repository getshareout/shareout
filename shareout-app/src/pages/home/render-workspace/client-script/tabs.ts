/** Tabbed canvas and artifact panes. */
export const workspace_client_tabs_JS = `  // ===== tabs (Home + open artifacts) =====
  var tabsEl = document.getElementById('wsxTabs');
  var panesEl = document.getElementById('wsxPanes');
  var homePane = document.getElementById('wsxHomePane');
  var tabs = [{ key: 'home', label: t('tabs.home'), home: true }];
  var panes = {};            // key -> { pane, iframe, art }
  var activeKey = 'home';
  var activeArt = null;      // ctx of the active artifact tab, or null on Home

  // Global View/Edit toggle lives in the tab bar; it drives the active artifact pane.
  var tabModeEl = document.getElementById('wsxTabMode');
  if (tabModeEl) tabModeEl.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () { var rec = panes[activeKey]; if (rec) setEditMode(rec, b.getAttribute('data-mode')); });
  });
  // Device (mobile/web) preview toggle — lives next to View/Edit, drives the active pane.
  var tabDeviceEl = document.getElementById('wsxTabDevice');
  if (tabDeviceEl) tabDeviceEl.addEventListener('click', function () {
    var rec = panes[activeKey]; if (!rec) return;
    var on = !rec.pane.classList.contains('is-mobile');
    rec.pane.classList.toggle('is-mobile', on);
    if (rec.mobileBtn) rec.mobileBtn.classList.toggle('is-on', on);
    syncTabMode();
  });
  // Full-screen toggle — shows the active artifact's live stage full screen (Escape exits, native).
  var tabFullEl = document.getElementById('wsxTabFull');
  if (tabFullEl) tabFullEl.addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var rec = panes[activeKey]; if (!rec) return;
    var el = rec.iframe;
    if (el && el.requestFullscreen) el.requestFullscreen();
  });
  // Reflect the active pane's mode + show only on an artifact tab.
  function syncTabMode() {
    if (!tabModeEl) return;
    var rec = panes[activeKey];
    tabModeEl.hidden = !rec;
    if (rec) tabModeEl.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-mode') === rec.mode); });
    if (tabDeviceEl) {
      tabDeviceEl.hidden = !rec;
      var mob = !!(rec && rec.pane.classList.contains('is-mobile'));
      tabDeviceEl.classList.toggle('is-on', mob);
      tabDeviceEl.setAttribute('aria-pressed', mob ? 'true' : 'false');
    }
    if (tabFullEl) tabFullEl.hidden = !rec;
  }

  // The pane = a View/Edit toolbar + the live stage iframe + a hidden edit iframe.
  // Edit-Lite renders the source HTML statically (scripts off) into the edit iframe so
  // the parent can drive contentEditable text edits and round-trip them cleanly.
  var ART_PANE_HTML =
    '<div class="wsx__stagebar2">'
    + '<button class="wsx__ubtn js-undo" type="button" title="Undo" hidden>' + isvg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>') + '</button>'
    + '<button class="wsx__ubtn js-redo" type="button" title="Redo" hidden>' + isvg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/>') + '</button>'
    + '<button class="wsx__ubtn js-mobile" type="button" title="Mobile preview" hidden>' + isvg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>') + '</button>'
    + '<span class="wsx__savestat js-savestat"></span>'
    + '<span class="wsx__editspacer"></span>'
    + '<button class="wsx__discard js-discard" type="button" hidden>' + esc(t('tabs.discard')) + '</button>'
    + '<button class="wsx__publish js-publish" type="button" hidden>' + esc(t('tabs.publish')) + '</button>'
    + '<a class="wsx__fulledit js-fulledit" target="_blank" rel="noopener" hidden title="' + esc(t('tabs.editLiteHint')) + '">' + esc(t('tabs.openFullEditor')) + '</a>'
    + '</div>'
    + '<iframe class="wsx__stageframe" title="Artifact" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>'
    + '<iframe class="wsx__editframe" title="Edit" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>';

  function spark(daily) {
    if (!daily || !daily.length) return '';
    var max = Math.max.apply(null, daily.map(function (d) { return d.views || 0; })) || 1;
    return '<div class="wsx-spark">' + daily.map(function (d) { return '<span style="height:' + Math.round(((d.views || 0) / max) * 100) + '%"></span>'; }).join('') + '</div>';
  }
  function vwrAgo(at) {
    var s = Math.floor((Date.now() - Date.parse(at)) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 2592000) return Math.floor(s / 86400) + 'd';
    return new Date(at).toLocaleDateString();
  }
  function viewersHtml(viewers) {
    if (!viewers || !viewers.length) return '';
    var row = function (v) {
      var who = esc(v.name || v.email);
      var tm = v.lastViewedAt
        ? '<span class="wsx-vwr__t">' + vwrAgo(v.lastViewedAt) + '</span>'
        : '<span class="wsx-vwr__t wsx-vwr__t--none">' + esc(t('tabs.notViewedYet')) + '</span>';
      return '<div class="wsx-vwr" title="' + esc(v.email) + '">'
        + '<span class="wsx-vwr__n">' + who + '</span>' + tm + '</div>';
    };
    var head = viewers.slice(0, 10).map(row).join('');
    var rest = viewers.slice(10).map(row).join('');
    var out = '<div class="wsx-panel-title" style="margin-top:14px">' + esc(t('tabs.viewers')) + ' (' + viewers.length + ')</div>'
      + '<div class="wsx-vwrs">' + head + '</div>';
    if (rest) {
      out += '<div class="wsx-vwrs" hidden>' + rest + '</div>'
        + '<button type="button" class="wsx-vwr__more"'
        + ' data-more="' + esc(t('tabs.showAllViewers')) + '" data-less="' + esc(t('tabs.showFewerViewers')) + '"'
        + ' onclick="var m=this.previousElementSibling;m.hidden=!m.hidden;this.textContent=m.hidden?this.getAttribute(\\'data-more\\'):this.getAttribute(\\'data-less\\')">'
        + esc(t('tabs.showAllViewers')) + '</button>';
    }
    return out;
  }
  function paintStats(panel, d) {
    panel.hidden = false;
    var viewers = (d && d.viewerTracking) || [];
    if (!d || (!d.totalViews && !d.uniqueVisitors && !viewers.length)) { panel.innerHTML = '<div class="wsx-det__statempty">' + esc(t('tabs.noViews')) + '</div>'; return; }
    var countries = (d.topCountries || []).slice(0, 3).map(function (c) { return esc(c.name) + ' (' + c.count + ')'; }).join(' \\u00B7 ');
    panel.innerHTML = '<div class="wsx-panel-title">' + esc(t('tabs.last14')) + '</div><div class="wsx-stat-row">'
      + '<div><div class="wsx-stat__n">' + (d.totalViews || 0) + '</div><div class="wsx-stat__l">' + esc(t('tabs.views')) + '</div></div>'
      + '<div><div class="wsx-stat__n">' + (d.uniqueVisitors || 0) + '</div><div class="wsx-stat__l">' + esc(t('tabs.visitors')) + '</div></div></div>'
      + spark(d.dailyStats || [])
      + (countries ? '<div class="wsx-stat__l" style="margin-top:10px">' + esc(t('tabs.top')) + ' ' + countries + '</div>' : '')
      + viewersHtml(viewers);
  }
  function loadAnalytics(id, panel) {
    panel.hidden = false;
    if (!id) { panel.innerHTML = i18nEmpty('tabs.analyticsNeedId'); return; }
    if (statsCache[id] !== undefined) { paintStats(panel, statsCache[id]); return; }
    panel.innerHTML = i18nEmpty('tabs.loadingAnalytics');
    fetch('/v1/artifacts/' + encodeURIComponent(id) + '/analytics?days=14', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { statsCache[id] = d; paintStats(panel, d); })
      .catch(function () { panel.innerHTML = i18nEmpty('tabs.couldNotAnalytics'); });
  }
  function makeArtifactPane(art) {
    var pane = document.createElement('div');
    pane.className = 'wsx__pane wsx__pane--art';
    pane.setAttribute('data-pane', art.key);
    pane.innerHTML = ART_PANE_HTML;
    var iframe = pane.querySelector('.wsx__stageframe');
    iframe.src = '/a/' + encodeURIComponent(art.slug) + '/?wsx=1';
    var editframe = pane.querySelector('.wsx__editframe');
    var rec = {
      pane: pane, iframe: iframe, editframe: editframe, art: art,
      mode: 'view', loaded: false, dirty: false, baseUpdatedAt: null, saveTimer: 0,
      savestat: pane.querySelector('.js-savestat'),
      publishBtn: pane.querySelector('.js-publish'),
      fullEdit: pane.querySelector('.js-fulledit'),
      undoBtn: pane.querySelector('.js-undo'),
      redoBtn: pane.querySelector('.js-redo'),
      mobileBtn: pane.querySelector('.js-mobile'),
      discardBtn: pane.querySelector('.js-discard'),
      sel: null, history: [], histIdx: -1,
    };
    rec.fullEdit.href = '/a/' + encodeURIComponent(art.slug) + '/edit';
    rec.publishBtn.addEventListener('click', function () { publishEdit(rec); });
    rec.undoBtn.addEventListener('click', function () { undoEdit(rec); });
    rec.redoBtn.addEventListener('click', function () { redoEdit(rec); });
    rec.discardBtn.addEventListener('click', function () { discardDraft(rec); });
    rec.mobileBtn.addEventListener('click', function () { var on = !rec.pane.classList.contains('is-mobile'); rec.pane.classList.toggle('is-mobile', on); rec.mobileBtn.classList.toggle('is-on', on); syncTabMode(); });
    return rec;
  }
  function discardDraft(rec) {
    if (!rec.art.id) return;
    if (!window.confirm(t('tabs.discardConfirm'))) return;
    if (rec.saveTimer) clearTimeout(rec.saveTimer);
    setSaveStatus(rec, t('tabs.discarding'));
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/draft', { method: 'DELETE', credentials: 'same-origin' })
      .then(function () { rec.dirty = false; renderTabs(); rec.loaded = false; rec.sel = null; loadEditSource(rec); })
      .catch(function () { setSaveStatus(rec, t('tabs.couldNotDiscard'), 'warn'); });
  }
  // Undo/redo snapshots the SOURCE doc; restore re-renders the live preview.
  function pushHistory(rec) {
    if (!rec.srcDoc || !rec.srcDoc.body) return;
    var snap = rec.srcDoc.body.innerHTML;
    if (rec.history[rec.histIdx] === snap) return;
    rec.history = rec.history.slice(0, rec.histIdx + 1);
    rec.history.push(snap);
    if (rec.history.length > 60) rec.history.shift();
    rec.histIdx = rec.history.length - 1;
    updateUndoButtons(rec);
  }
  function restoreHistory(rec) {
    if (!rec.srcDoc || !rec.srcDoc.body) return;
    if (rec.histTimer) clearTimeout(rec.histTimer);
    rec.srcDoc.body.innerHTML = rec.history[rec.histIdx] || '';
    rec.pendingSel = null;
    rec.dirty = true; renderTabs(); setSaveStatus(rec, 'Editing\\u2026');
    if (rec.saveTimer) clearTimeout(rec.saveTimer);
    rec.saveTimer = setTimeout(function () { autosaveDraft(rec); }, 1200);
    renderLive(rec); updateUndoButtons(rec);
  }
  function undoEdit(rec) { if (rec.histIdx > 0) { rec.histIdx--; restoreHistory(rec); } }
  function redoEdit(rec) { if (rec.histIdx < rec.history.length - 1) { rec.histIdx++; restoreHistory(rec); } }
  function updateUndoButtons(rec) {
    rec.undoBtn.disabled = rec.histIdx <= 0;
    rec.redoBtn.disabled = rec.histIdx >= rec.history.length - 1;
  }

`;
