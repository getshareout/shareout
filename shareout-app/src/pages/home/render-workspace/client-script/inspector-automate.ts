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
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.run) paintTests(art, box, { config: cfg, latest: j.run }); else { b.disabled = false; b.textContent = t('inspector.runTestsNow'); try { wsxToast(t('inspector.testRunFailed'), true); } catch (e) {} } })
        .catch(function () { b.disabled = false; b.textContent = t('inspector.runTestsNow'); try { wsxToast(t('inspector.testRunFailed'), true); } catch (e) {} });
    });
  }

  // ----- Automate (per-artifact schedules + alerts) -----
  function autoJobRow(j) {
    var st = j.last_status || ''; var cls = st === 'success' ? ' ok' : st === 'failed' ? ' fail' : '';
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(j.title || j.action || t('admin.jobDefault')) + '</div><div class="wsx-row__sub">' + esc(cronHuman(j.schedule)) + (j.action ? ' \\u00B7 ' + esc(j.action) : '') + '</div></div>' + (st ? '<span class="wsx-row__badge' + cls + '">' + esc(st) + '</span>' : '') + '</div>';
  }
  function autoAlertRow(a) {
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(a.name || a.metric_id || t('inspector.alertDefault')) + '</div><div class="wsx-row__sub">' + esc(a.schedule ? cronHuman(a.schedule) : '') + '</div></div>' + (a.enabled ? '<span class="wsx-row__badge ok">' + esc(t('admin.on')) + '</span>' : '<span class="wsx-row__badge">' + esc(t('admin.off')) + '</span>') + '</div>';
  }
  function renderAutomate(art) {
    if (autoCache[art.id] !== undefined) { paintAutomate(art, autoCache[art.id]); return; }
    rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
    Promise.all([
      fetch('/v1/jobs' + (window.WSX_WS ? '?workspace_id=' + encodeURIComponent(window.WSX_WS) : ''),{ credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/v1/metric-alerts' + (window.WSX_WS ? '?workspace_id=' + encodeURIComponent(window.WSX_WS) : ''), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var jobs = ((res[0] && (res[0].jobs || res[0].items)) || []).filter(function (j) { return !art.id || j.artifact_id === art.id; });
      var alerts = ((res[1] && res[1].alerts) || []).filter(function (a) { return !art.id || a.artifact_id === art.id; });
      autoCache[art.id] = { jobs: jobs, alerts: alerts };
      paintAutomate(art, autoCache[art.id]);
    });
  }
  function autoTile(act, icon, title, sub) {
    return '<button class="wsx-qa" data-aauto="' + act + '" type="button"><span class="wsx-qa__ic">' + isvg(icon) + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(title) + '</span><span class="wsx-qa__s">' + esc(sub) + '</span></span></button>';
  }
  function paintAutomate(art, data) {
    var jobs = data.jobs || [], alerts = data.alerts || [];
    var h = '<div class="wsx-auto">';
    if (jobs.length) h += '<div class="wsx-det__label">' + esc(t('inspector.autoSchedules')) + '</div><div class="wsx-list">' + jobs.map(autoJobRow).join('') + '</div>';
    if (alerts.length) h += '<div class="wsx-det__label"' + (jobs.length ? ' style="margin-top:10px"' : '') + '>' + esc(t('inspector.autoAlerts')) + '</div><div class="wsx-list">' + alerts.map(autoAlertRow).join('') + '</div>';
    h += '<div class="wsx-det__label"' + (jobs.length || alerts.length ? ' style="margin-top:12px"' : '') + '>' + esc(t('inspector.autoQuick')) + '</div>'
      + '<div class="wsx-qa-grid">'
      + autoTile('schedule', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', t('inspector.autoScheduleSend'), t('inspector.autoScheduleSub'))
      + autoTile('alert', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>', t('inspector.autoSetAlert'), t('inspector.autoSetAlertSub'))
      + autoTile('crew', '<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>', t('inspector.autoStartCrew'), t('inspector.autoStartCrewSub'))
      + '</div>'
      + '<button class="wsx-auto__chat" data-aauto="chat" type="button">' + isvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>') + esc(t('inspector.autoCustom')) + '</button>'
      + '</div>';
    rbodyEl.innerHTML = h;
    rbodyEl.querySelectorAll('[data-aauto]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = art.name || t('inspector.thisPage'); var k = b.getAttribute('data-aauto');
        if (k === 'schedule' || k === 'alert') openAutoForm(k, { id: art.id, name: n }, function () { delete autoCache[art.id]; });
        else if (k === 'crew') agentAsk(t('inspector.askCrew').replace('{name}', n));
        else agentAsk(t('inspector.askCustom').replace('{name}', n));
      });
    });
  }

`;
