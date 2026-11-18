/** Inspector Tests + Automate panels. Shares the inspector IIFE scope. */
export const workspace_client_inspector_automate_JS = `  // ----- Tests (artifact_tests via /v1/artifacts/:id/tests) -----
  function renderTests(art) {
    var box = rbodyEl.querySelector('#wsxTests'); if (!box) return;
    box.innerHTML = i18nLoad();
    fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/tests', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { paintTests(art, box, d); })
      .catch(function () { box.innerHTML = i18nEmpty('inspector.couldNotTests'); });
  }
  function paintTests(art, box, d) {
    var cfg = d && d.config, latest = d && d.latest;
    if (!cfg || !cfg.enabled) {
      box.innerHTML = '<div class="wsx-tests__off">' + esc(t('inspector.testsOff')) + ' <button class="wsx-link" data-tst="open" type="button">' + esc(t('inspector.openEditor')) + '</button></div>';
      box.querySelector('[data-tst="open"]').addEventListener('click', function () { window.open('/a/' + encodeURIComponent(art.slug) + '/edit', '_blank', 'noopener'); });
      return;
    }
    var st = latest && latest.status;
    var badge = st === 'passed' ? '<span class="wsx-row__badge ok">passed</span>'
      : st === 'failed' || st === 'errored' ? '<span class="wsx-row__badge fail">' + esc(st) + '</span>'
      : st === 'running' ? '<span class="wsx-row__badge">running</span>' : '<span class="wsx-row__badge">no runs</span>';
    var counts = latest ? '<div class="wsx-row__sub">' + (latest.passed_count || 0) + ' passed \\u00B7 ' + (latest.failed_count || 0) + ' failed' + (latest.errored_count ? ' \\u00B7 ' + latest.errored_count + ' errored' : '') + '</div>' : '';
    box.innerHTML = '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc((cfg.mode || 'monitor')) + ' mode</div>' + counts + '</div>' + badge + '</div>'
      + '<button class="wsx-abtn wsx-abtn--block wsx-tests__run" data-tst="run" type="button">' + esc(t('inspector.runTestsNow')) + '</button>';
    box.querySelector('[data-tst="run"]').addEventListener('click', function (e) {
      var b = e.currentTarget; b.disabled = true; b.textContent = t('inspector.running');
      fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/tests/run', { method: 'POST', credentials: 'same-origin' })
        .then(okOr)
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.run) paintTests(art, box, { config: cfg, latest: j.run }); else throw new Error('run'); })
        .catch(function (err) { b.disabled = false; b.textContent = t('inspector.runTestsNow'); failToast(err, t('inspector.testRunFailed')); });
    });
  }

  // ----- Automate (per-artifact schedules + alerts) -----
  // An email update set up in another language still reads in the viewer's (its default title is ours).
  var AUTO_ES_TITLES = ['Update by email', 'Actualizar por email'];
  function autoJobTitle(j) { return j.action === 'email_sheet_sync' && (!j.title || AUTO_ES_TITLES.indexOf(j.title) !== -1) ? t('esync.jobTitle') : (j.title || j.action || t('admin.jobDefault')); }
  function autoJobRow(j) {
    var st = j.last_status || ''; var cls = st === 'success' ? ' ok' : st === 'failed' ? ' fail' : '';
    // The email update opens its panel (address, status) like its tile does.
    if (j.action === 'email_sheet_sync') {
      return '<button class="wsx-row wsx-row--btn" type="button" data-aauto="emailsync"><span class="wsx-row__main"><span class="wsx-row__title">' + esc(autoJobTitle(j)) + '</span><span class="wsx-row__sub">' + esc(t('esync.rowSub')) + '</span></span>'
        + '<span class="wsx-row__badge' + (st === 'failed' ? ' fail' : ' ok') + '">' + esc(t(st === 'failed' ? 'esync.badgeFail' : 'esync.badgeOn')) + '</span></button>';
    }
    var sub = esc(cronHuman(j.schedule)) + (j.action ? ' \\u00B7 ' + esc(j.action) : '');
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(autoJobTitle(j)) + '</div><div class="wsx-row__sub">' + sub + '</div></div>' + (st ? '<span class="wsx-row__badge' + cls + '">' + esc(st) + '</span>' : '') + '</div>';
  }
  function autoAlertRow(a) {
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(a.name || a.metric_id || t('inspector.alertDefault')) + '</div><div class="wsx-row__sub">' + esc(a.schedule ? cronHuman(a.schedule) : '') + '</div></div>' + (a.enabled ? '<span class="wsx-row__badge ok">' + esc(t('admin.on')) + '</span>' : '<span class="wsx-row__badge">' + esc(t('admin.off')) + '</span>') + '</div>';
  }
  function renderAutomate(art) {
    rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
    if (!art.id) {
      fetchMeta(art, function (d) {
        if (activeArt !== art) return;
        if (!d || !art.id) { railRetry('inspector.detailsFailed', function () { renderAutomate(art); }); return; }
        renderAutomate(art);
      });
      return;
    }
    if (autoCache[art.id] !== undefined) { paintAutomate(art, autoCache[art.id]); return; }
    var q = '?artifact_id=' + encodeURIComponent(art.id);
    function get(path) { return fetch(path + q, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    Promise.all([get('/v1/jobs'), get('/v1/metric-alerts')]).then(function (res) {
      autoCache[art.id] = { jobs: (res[0] && (res[0].jobs || res[0].items)) || [], alerts: (res[1] && res[1].alerts) || [] };
      if (activeArt === art) paintAutomate(art, autoCache[art.id]);
    });
  }
  function autoTile(act, icon, title, sub, on) {
    return '<button class="wsx-qa' + (on ? ' is-on' : '') + '" data-aauto="' + act + '" type="button"><span class="wsx-qa__ic">' + isvg(icon) + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(title) + '</span><span class="wsx-qa__s">' + esc(sub) + '</span></span></button>';
  }
  // The three ways data comes in (Drive, a link, an emailed Excel): here and in New → Table from an Excel file.
  var DATA_IN_ICONS = {
    drivesync: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
    sheetlink: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    emailsync: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'
  };
  var DATA_IN_COPY = { drivesync: 'dsync', sheetlink: 'slink', emailsync: 'esync' };
  function dataInTiles(order, emailOn) {
    return order.map(function (k) { var p = DATA_IN_COPY[k]; return autoTile(k, DATA_IN_ICONS[k], t(p + '.tile'), t(k === 'emailsync' && emailOn ? 'esync.tileOn' : p + '.tileSub'), k === 'emailsync' && emailOn); }).join('');
  }
  function openDataIn(k, art, onDone) {
    if (k === 'drivesync') openDriveSync(art, onDone);
    else if (k === 'sheetlink') openSheetLinkSync(art, onDone);
    else if (k === 'emailsync') openEmailSync(art, onDone);
  }
  function paintAutomate(art, data) {
    var jobs = data.jobs || [], alerts = data.alerts || [], m = metaCache[art.id], ed = !!(m && m.can_edit);
    function blk(label, help, body) { return '<div class="wsx-auto__sec"><div class="wsx-det__label"><span class="wsx-det__labeltxt">' + esc(label) + '</span>' + (help ? '<button class="wsx-det__help" type="button" aria-label="' + esc(help) + '" data-tip="' + esc(help) + '">?</button>' : '') + '</div>' + body + '</div>'; }
    var h = '<div class="wsx-auto">';
    // Data in first (Drive, a link, an emailed Excel), then send now → what already runs → monitoring → more.
    var emailOn = jobs.some(function (j) { return j.action === 'email_sheet_sync'; });
    if (ed && window.WSX_WS) h += blk(t('inspector.dataIn'), t('inspector.dataInHelp'), '<div class="wsx-qa-grid">' + dataInTiles(['drivesync', 'sheetlink', 'emailsync'], emailOn) + '</div>');
    if (ed) h += blk(t('inspector.deliver'), t('inspector.deliverHelp'), '<div id="wsxDeliver"></div>');
    if (jobs.length) h += blk(t('inspector.autoSchedules'), '', '<div class="wsx-list">' + jobs.map(autoJobRow).join('') + '</div>');
    if (alerts.length) h += blk(t('inspector.autoAlerts'), '', '<div class="wsx-list">' + alerts.map(autoAlertRow).join('') + '</div>');
    if (ed) h += blk(t('inspector.watches'), t('inspector.watchesHelp'), '<div id="wsxWatches"></div>');
    h += '<div class="wsx-auto__sec"><div class="wsx-det__label">' + esc(t('inspector.autoQuick')) + '</div>'
      + '<div class="wsx-qa-grid">'
      + autoTile('schedule', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', t('inspector.autoScheduleSend'), t('inspector.autoScheduleSub'))
      + autoTile('alert', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>', t('inspector.autoSetAlert'), t('inspector.autoSetAlertSub'))
      + autoTile('crew', '<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>', t('inspector.autoStartCrew'), t('inspector.autoStartCrewSub'))
      + '</div>'
      + '<button class="wsx-auto__chat" data-aauto="chat" type="button">' + isvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>') + esc(t('inspector.autoCustom')) + '</button>'
      + '</div></div>';
    rbodyEl.innerHTML = h;
    var dl = rbodyEl.querySelector('#wsxDeliver');
    if (dl) { renderDeliver(art, dl); renderWatches(art); }
    rbodyEl.querySelectorAll('[data-aauto]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = art.name || t('inspector.thisPage'); var k = b.getAttribute('data-aauto');
        if (k === 'schedule' || k === 'alert') openAutoForm(k, { id: art.id, name: n }, function () { delete autoCache[art.id]; });
        else if (k === 'crew') agentAsk(t('inspector.askCrew').replace('{name}', n));
        else if (DATA_IN_ICONS[k]) openDataIn(k, { id: art.id, name: n }, function () { delete autoCache[art.id]; if (activeArt === art) renderAutomate(art); });
        else agentAsk(t('inspector.askCustom').replace('{name}', n));
      });
    });
  }

`;
