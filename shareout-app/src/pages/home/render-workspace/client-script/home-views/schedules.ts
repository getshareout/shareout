/** My Schedules lens — Airflow-style job list and run history. */
export const workspace_client_home_views_schedules_JS = `  // ----- My Schedules — Airflow-style: origin → flow → destination, humanized cron,
  // last/next run, and lazy per-job run-history bars. -----
  var SCHED_DEST_ICO = {
    email: 'mail', slack: 'img:/brand/slack-icon.png', telegram: 'img:/brand/telegram-icon.png',
    discord: 'chat', webhook: 'globe', http_get: 'globe',
    query_snapshot: 'db',
    sheets_append: 'sheet', materialize: 'db', artifact_test: 'check'
  };
  function schedDest(action) {
    var k = action ? ('sched.dest.' + action) : 'sched.dest.run';
    return [t(k), SCHED_DEST_ICO[action] || 'doc'];
  }
  var SCHED_ICON = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>', doc: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  function schedChip(label, iconKey, cls) {
    var ico = iconKey && iconKey.indexOf('img:') === 0
      ? '<img src="' + iconKey.slice(4) + '" alt="" width="14" height="14">'
      : isvg(SCHED_ICON[iconKey] || SCHED_ICON.doc);
    return '<span class="wsx-sched__chip ' + (cls || '') + '">' + ico + '<span>' + esc(label) + '</span></span>';
  }
  var CRON_DAYS = ['sched.daySun', 'sched.dayMon', 'sched.dayTue', 'sched.dayWed', 'sched.dayThu', 'sched.dayFri', 'sched.daySat'];
  function cronHuman(c) {
    if (!c) return t('sched.cronOnSchedule');
    var p = String(c).trim().split(/\\s+/); if (p.length < 5) return c;
    var H = parseInt(p[1], 10), M = parseInt(p[0], 10);
    var hhmm = (isNaN(H) || isNaN(M)) ? '' : ((H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M);
    if (p[2] === '*' && p[3] === '*' && p[4] === '*') return hhmm ? t('sched.cronDailyAt').replace('{time}', hhmm) : t('sched.cronDaily');
    if (p[2] === '*' && p[4] !== '*') {
      var day = t(CRON_DAYS[parseInt(p[4], 10)] || '') || p[4];
      return t('sched.cronWeeklyAt').replace('{day}', day).replace('{time}', hhmm);
    }
    if (p[2] !== '*' && p[3] === '*') return t('sched.cronMonthlyAt').replace('{day}', p[2]).replace('{time}', hhmm);
    return c;
  }
  function whenAgo(ms) { if (!ms) return ''; try { return timeAgo(ms); } catch (e) { return ''; } }
  // One run-history bar. Clickable (opens the Run Inspector drawer) only inside a
  // Team Space, where the workspace-scoped run-detail endpoint is reachable.
  function runBar(status, surface, runId) {
    var c = (status === 'success' || status === 'completed' || status === 'done' || status === 'delivered' || status === 'ok') ? 'ok'
      : (status === 'failed' || status === 'error' || status === 'errored') ? 'fail' : 'pend';
    var click = (window.WSX_WS && runId) ? ' so-runbar is-click" data-run-surface="' + esc(surface) + '" data-run-id="' + esc(runId) : '';
    return '<span class="wsx-runbar is-' + c + click + '" title="' + esc(status || '') + '"></span>';
  }
  function wireBars(host) {
    host.querySelectorAll('[data-run-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (window.SO_openRunDrawer) window.SO_openRunDrawer(b.getAttribute('data-run-surface'), b.getAttribute('data-run-id'));
      });
    });
  }
  function runsLink() { return window.WSX_WS ? '<a class="wsx-runs-link" href="/app/runs?ws=' + encodeURIComponent(window.WSX_WS) + '">' + esc(t('sched.viewAllRuns')) + '</a>' : ''; }
  function loadJobLogs(id, host) {
    fetch('/v1/jobs/' + encodeURIComponent(id) + '/logs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var logs = (d && d.logs) || [];
        if (!logs.length) { host.innerHTML = '<span class="wsx-sched__noruns">' + esc(t('sched.noRuns')) + '</span>'; return; }
        host.innerHTML = logs.slice(0, 24).reverse().map(function (l) {
          return runBar(l.status, 'job', l.id);
        }).join('');
        wireBars(host);
      }).catch(function () { host.innerHTML = ''; });
  }
  function loadSchedules() {
    var m = document.getElementById('wsxSchedMount'); m.innerHTML = i18nLoad();
    fetch('/v1/jobs', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) {
        var jobs = (d && (d.jobs || d.items)) || [];
        if (!jobs.length) {
          m.innerHTML = '<div class="wsx-qa-grid wsx-qa-grid--lens">'
            + '<button class="wsx-qa" data-newauto="Schedule a recurring send of one of my pages \\u2014 " type="button"><span class="wsx-qa__ic">' + isvg(SCHED_ICON.clock) + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('sched.emptyChat')) + '</span><span class="wsx-qa__s">' + esc(t('sched.emptyChatSub')) + '</span></span></button>'
            + '<button class="wsx-qa" data-newauto="Walk me through creating a schedule step by step: pick a page, a destination (Slack/Email/Telegram) and a time." type="button"><span class="wsx-qa__ic">' + isvg(SCHED_ICON.check) + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('sched.emptyStep')) + '</span><span class="wsx-qa__s">' + esc(t('sched.emptyStepSub')) + '</span></span></button>'
            + '</div>';
          wireNewAuto(m); return;
        }
        m.innerHTML = runsLink() + jobs.map(function (j) {
          var meta = schedDest(j.action);
          var cfg = j.config || {};
          var src = cfg.connection || cfg.bqConnection || '';
          var st = j.last_status || ''; var cls = st === 'success' ? 'ok' : (st === 'failed' ? 'fail' : '');
          var title = j.title || (meta[0] + (j.artifact_name ? ' · ' + j.artifact_name : ''));
          var flow = '';
          if (j.artifact_name) flow += schedChip(j.artifact_name, 'doc', 'is-origin');
          if (src) flow += '<span class="wsx-sched__arrow">' + isvg('<path d="M5 12h14M13 6l6 6-6 6"/>') + '</span>' + schedChip(src, 'db', '');
          flow += '<span class="wsx-sched__arrow">' + isvg('<path d="M5 12h14M13 6l6 6-6 6"/>') + '</span>' + schedChip(meta[0], meta[1], 'is-dest');
          return '<div class="wsx-sched" data-job="' + esc(j.id) + '">'
            + '<div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(title) + '</div>'
            +   (st ? '<span class="wsx-sched__badge ' + cls + '">' + esc(st) + '</span>' : '<span class="wsx-sched__badge">' + esc(j.enabled === false ? t('sched.badgePaused') : t('sched.badgeIdle')) + '</span>') + '</div>'
            + '<div class="wsx-sched__flow">' + flow + '</div>'
            + '<div class="wsx-sched__meta"><span class="wsx-sched__when">' + isvg(SCHED_ICON.clock) + esc(cronHuman(j.schedule)) + '</span>'
            +   (j.last_run_at ? '<span>' + esc(t('sched.lastRun')) + ' ' + esc(whenAgo(j.last_run_at)) + '</span>' : '')
            +   (j.next_run_at ? '<span>' + esc(t('sched.next')) + ' ' + esc(whenAgo(j.next_run_at)) + '</span>' : '') + '</div>'
            + '<div class="wsx-runbars" data-runs="' + esc(j.id) + '"><span class="wsx-sched__noruns">' + esc(t('sched.loadingRuns')) + '</span></div>'
            + '</div>';
        }).join('');
        m.querySelectorAll('[data-runs]').forEach(function (host) { loadJobLogs(host.getAttribute('data-runs'), host); });
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
  // Quick-action tiles that kick off a guided chat (Schedules + Alerts empty states).
  function wireNewAuto(root) {
    root.querySelectorAll('[data-newauto]').forEach(function (b) {
      b.addEventListener('click', function () { agentAsk(b.getAttribute('data-newauto')); });
    });
  }
  function loadAlerts() {
    var m = document.getElementById('wsxAlertMount'); m.innerHTML = i18nLoad();
    fetch('/v1/metric-alerts', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) {
        var al = (d && d.alerts) || [];
        if (!al.length) {
          m.innerHTML = '<p class="wsx-lens__intro">' + esc(t('alerts.intro')) + '</p>'
            + '<div class="wsx-qa-grid wsx-qa-grid--lens">'
            + '<button class="wsx-qa" data-newauto="Set up an alert that pings me when " type="button"><span class="wsx-qa__ic">' + isvg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>') + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('alerts.emptyChat')) + '</span><span class="wsx-qa__s">' + esc(t('alerts.emptyChatSub')) + '</span></span></button>'
            + '<button class="wsx-qa" data-newauto="Walk me through creating a metric alert step by step: pick a page, a metric, a condition (above/below a threshold) and how often to check." type="button"><span class="wsx-qa__ic">' + isvg('<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>') + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('alerts.emptyStep')) + '</span><span class="wsx-qa__s">' + esc(t('alerts.emptyStepSub')) + '</span></span></button>'
            + '</div>';
          wireNewAuto(m); return;
        }
        m.innerHTML = runsLink() + al.map(function (a) {
          var cond = a.condition || (a.config && (a.config.condition || a.config.comparator)) || '';
          var thr = (a.threshold != null ? a.threshold : (a.config && a.config.threshold));
          var sub = [esc(a.metric_id || a.metric || ''), cond ? esc(cond) + (thr != null ? ' ' + esc(thr) : '') : '', a.schedule ? esc(cronHuman(a.schedule)) : ''].filter(Boolean).join(' \\u00B7 ');
          return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + isvg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>') + ' ' + esc(a.name || a.metric_id || t('alerts.defaultName'))
            + '</div><span class="wsx-sched__badge ' + (a.enabled ? 'ok' : '') + '">' + esc(a.enabled ? t('alerts.badgeOn') : t('alerts.badgeOff')) + '</span></div>'
            + (sub ? '<div class="wsx-sched__meta"><span>' + sub + '</span></div>' : '')
            + (a.artifact_name ? '<div class="wsx-sched__flow">' + schedChip(a.artifact_name, 'doc', 'is-origin') + '</div>' : '')
            + (window.WSX_WS ? '<div class="wsx-runbars" data-alert-runs="' + esc(a.id) + '"><span class="wsx-sched__noruns">' + esc(t('sched.loadingRuns')) + '</span></div>' : '')
            + '</div>';
        }).join('');
        m.querySelectorAll('[data-alert-runs]').forEach(function (h) { loadAlertEvents(h.getAttribute('data-alert-runs'), h); });
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function loadAlertEvents(id, host) {
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/metric-alerts/' + encodeURIComponent(id) + '/events', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var ev = (d && d.events) || [];
        if (!ev.length) { host.innerHTML = '<span class="wsx-sched__noruns">' + esc(t('sched.noChecks')) + '</span>'; return; }
        host.innerHTML = ev.slice(0, 24).reverse().map(function (e) {
          var st = e.error ? 'failed' : (e.delivered ? 'delivered' : (e.matched ? 'matched' : 'ok'));
          return runBar(st, 'alert', e.id);
        }).join('');
        wireBars(host);
      }).catch(function () { host.innerHTML = ''; });
  }
`;
