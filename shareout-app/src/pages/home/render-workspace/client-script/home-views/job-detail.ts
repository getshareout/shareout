/** Automation detail page (#l/schedules/<jobId>): what it does, when it runs, its run
 *  history and every editable field (name, schedule, destination, full config). Lazy chunk. */
export const workspace_client_home_views_jobDetail_JS = `  // ===== Automation detail page — lazy chunk 'jobdetail' =====
  var jdEditing = false;
  var jdSlackNames = {};     // artifactId -> { channelId: name }
  function jdFind(id) { return (schedJobs || []).filter(function (j) { return j.id === id; })[0] || null; }
  function jdTitle(j) { var meta = schedDest(j.action); return j.title || (meta[0] + (j.artifact_name ? ' \\u00b7 ' + j.artifact_name : '')); }
  function jdHost(u) { try { return new URL(u).host; } catch (e) { return ''; } }
  // One line saying where it delivers. Webhook URLs carry secrets: show their host only.
  function jdDestSummary(j) {
    var c = j.config || {};
    if (j.action === 'email' || j.action === 'asset_delivery') return (c.recipients || []).join(', ');
    if (j.action === 'slack') {
      if (c.channelId) { var nm = (jdSlackNames[j.artifact_id] || {})[c.channelId]; return nm ? '#' + nm : c.channelId; }
      if (c.slackUserId) return c.slackUserId;
      return c.webhookUrl ? t('adet.webhookAt').replace('{host}', jdHost(c.webhookUrl)) : (c.channel || '');
    }
    if (j.action === 'discord') return c.webhookUrl ? t('adet.webhookAt').replace('{host}', jdHost(c.webhookUrl)) : '';
    if (j.action === 'telegram') return c.chatId || t('adet.ownTelegram');
    if (j.action === 'webhook' || j.action === 'http_get') return c.url || '';
    if (j.action === 'query_snapshot') return (c.queries || []).map(function (q) { return q && q.target && q.target.name; }).filter(Boolean).join(', ');
    if (j.action === 'sheets_append') return c.spreadsheetUrl || c.spreadsheetId || '';
    if (j.action === 'materialize') return (c.target && c.target.name) || '';
    return '';
  }
  function jdSlackChannels(j, cb) {
    if (jdSlackNames[j.artifact_id]) { cb(jdSlackNames[j.artifact_id]); return; }
    fetch('/v1/artifacts/' + encodeURIComponent(j.artifact_id) + '/deliver/slack-channels', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { var map = {}; ((d && d.channels) || []).forEach(function (x) { map[x.id] = x.name; }); jdSlackNames[j.artifact_id] = map; cb(map); })
      .catch(function () { cb({}); });
  }
  function jdField(label, id, value, opts) {
    opts = opts || {};
    var input = opts.area
      ? '<textarea class="wsx-field__in' + (opts.code ? ' is-code' : '') + '" id="' + id + '" rows="' + (opts.rows || 3) + '" spellcheck="' + (opts.code ? 'false' : 'true') + '">' + esc(value || '') + '</textarea>'
      : '<input class="wsx-field__in" id="' + id + '" type="' + (opts.type || 'text') + '" autocomplete="off" value="' + esc(value || '') + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>';
    return '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(label) + '</span>' + input + (opts.note ? '<span class="wsx-field__note">' + esc(opts.note) + '</span>' : '') + '</label>';
  }
  var JD_MODES = ['message', 'snapshot', 'pdf', 'both'];
  // The fields people change, per destination. Anything else stays editable as JSON below.
  function jdDestFields(j) {
    var c = j.config || {}, a = j.action, h = '';
    if (a === 'email' || a === 'asset_delivery') h += jdField(t('autof.recipients'), 'jd_to', (c.recipients || []).join(', '), { ph: t('autof.recipientsPh'), note: t('autof.recipientsNote') });
    if (a === 'email') h += jdField(t('adet.subject'), 'jd_subject', c.subject || '', { ph: t('adet.subjectPh') });
    if (a === 'slack' && c.connection) h += afSel(t('autof.slackChannel'), 'jd_slack', afOpt(c.channelId || '', c.channelId ? (jdDestSummary(j)) : t('common.loading'), true));
    if (a === 'slack' || a === 'telegram') h += afSel(t('adet.mode'), 'jd_mode', JD_MODES.map(function (m) { return afOpt(m, t('adet.mode.' + m), (c.mode || 'message') === m); }).join(''));
    if (a === 'slack' || a === 'telegram' || a === 'discord') h += jdField(t('adet.message'), 'jd_msg', c.customMessage || '', { area: true, rows: 3 });
    if (a === 'webhook' || a === 'http_get') h += jdField(t('adet.url'), 'jd_url', c.url || '', { type: 'url', ph: 'https://' });
    if (a === 'query_snapshot') (c.queries || []).forEach(function (q, i) {
      if (q && typeof q.query === 'string') h += jdField(t('adet.queryTo').replace('{target}', (q.target && q.target.name) || String(i + 1)), 'jd_q' + i, q.query, { area: true, code: true, rows: 6 });
    });
    if ((a === 'sheets_append' || a === 'materialize') && typeof c.query === 'string') h += jdField(t('adet.query'), 'jd_q0', c.query, { area: true, code: true, rows: 6 });
    if (a === 'sheets_append') h += jdField(t('adet.range'), 'jd_range', c.range || '', { ph: 'Sheet1!A1' });
    return h || '<p class="wsx-field__note">' + esc(t('adet.noDestFields')) + '</p>';
  }
  function jdEditHtml(j) {
    return '<div class="wsx-cform wsx-adet__form">'
      + jdField(t('adet.name'), 'jd_title', j.title || '', { ph: jdTitle(j) })
      + jdField(t('adet.description'), 'jd_desc', j.description || '', { area: true, rows: 2, ph: t('adet.descriptionPh') })
      + (j.trigger_type === 'event' ? '' : '<h4 class="wsx-adet__h">' + esc(t('adet.schedule')) + '</h4>' + afScheduleFields('jd', j.schedule))
      + '<h4 class="wsx-adet__h">' + esc(t('adet.dest')) + ' \\u00b7 ' + esc(schedDest(j.action)[0]) + '</h4>' + jdDestFields(j)
      + '<details class="wsx-adet__adv"><summary>' + esc(t('adet.advanced')) + '</summary>'
      + jdField(t('adet.configJson'), 'jd_json', JSON.stringify(j.config || {}, null, 2), { area: true, code: true, rows: 12, note: t('adet.configJsonNote') }) + '</details>'
      + '<div class="wsx-cform__err" id="jd_err" role="alert"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn" type="button" data-jd="cancel">' + esc(t('autof.cancel')) + '</button>'
      + '<button class="wsx-abtn wsx-abtn--primary" type="button" data-jd="save">' + esc(t('adet.save')) + '</button></div></div>';
  }
  // The config to save: the JSON box when it was edited (it wins), else the original
  // config with the friendly fields applied.
  function jdReadConfig(j, root) {
    function q(id) { return root.querySelector('#' + id); }
    var adv = q('jd_json');
    if (adv && adv.value !== adv.defaultValue) {
      try { var parsed = JSON.parse(adv.value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('x'); return { config: parsed }; }
      catch (e) { return { err: 'adet.errJson' }; }
    }
    var c = JSON.parse(JSON.stringify(j.config || {}));
    if (q('jd_to')) { var to = afRecipients(q('jd_to').value); if (!to.length) return { err: 'autof.errRecipients' }; c.recipients = to; }
    if (q('jd_subject')) { var s = q('jd_subject').value.trim(); if (s) c.subject = s; else delete c.subject; }
    if (q('jd_slack') && q('jd_slack').value) c.channelId = q('jd_slack').value;
    if (q('jd_mode')) { var md = q('jd_mode').value; if (md !== 'message' || c.mode) c.mode = md; }
    if (q('jd_msg')) { var mg = q('jd_msg').value; if (mg.trim()) c.customMessage = mg; else delete c.customMessage; }
    if (q('jd_url')) { var u = q('jd_url').value.trim(); if (!/^https?:\\/\\//i.test(u)) return { err: 'adet.errUrl' }; c.url = u; }
    for (var i = 0; c.queries && i < c.queries.length; i++) {
      var qi = q('jd_q' + i); if (!qi) continue;
      if (!qi.value.trim()) return { err: 'adet.errQuery' };
      c.queries[i].query = qi.value;
    }
    if ((j.action === 'sheets_append' || j.action === 'materialize') && q('jd_q0')) { if (!q('jd_q0').value.trim()) return { err: 'adet.errQuery' }; c.query = q('jd_q0').value; }
    if (q('jd_range')) { var rg = q('jd_range').value.trim(); if (rg) c.range = rg; else delete c.range; }
    return { config: c };
  }
  function jdLoadRuns(j, host) {
    fetch('/v1/jobs/' + encodeURIComponent(j.id) + '/logs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!host.isConnected) return;
        host.innerHTML = adetRuns(((d && d.logs) || []).map(function (l) {
          return { id: l.id, surface: 'job', status: l.status, at: l.created_at, dur: l.duration_ms != null ? durLabel(l.duration_ms) : '', note: l.error || '' };
        }));
        adetWireRuns(host);
      }).catch(function () { host.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function jdSave(j, root, btn) {
    var err = root.querySelector('#jd_err'); err.textContent = '';
    var body = {};
    var title = root.querySelector('#jd_title').value.trim();
    if (title !== (j.title || '')) body.title = title || null;
    var desc = root.querySelector('#jd_desc').value.trim();
    if (desc !== (j.description || '')) body.description = desc || null;
    if (j.trigger_type !== 'event') {
      var sc = afReadSchedule(root, 'jd'); if (sc.err) { err.textContent = t(sc.err); return; }
      if (sc.cron !== j.schedule) body.schedule = sc.cron;
    }
    var cf = jdReadConfig(j, root); if (cf.err) { err.textContent = t(cf.err); return; }
    if (JSON.stringify(cf.config) !== JSON.stringify(j.config || {})) body.config = cf.config;
    if (!Object.keys(body).length) { jdEditing = false; jdRender(j); return; }
    // Exception to optimistic: the server validates the cron, the destination and its
    // connection, so the form stays until it answers and shows the reason when it refuses.
    var label = btn.textContent; btn.disabled = true; btn.textContent = t('common.saving');
    fetch('/v1/jobs/' + encodeURIComponent(j.id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = label;
        if (!res.ok || !res.d || !res.d.job) { err.textContent = (res.d && res.d.error) || t('autof.couldNotSave'); return; }
        var nj = res.d.job; nj.artifact_name = j.artifact_name; nj.artifact_slug = j.artifact_slug;
        if (schedJobs) schedJobs = schedJobs.map(function (x) { return x.id === j.id ? nj : x; });
        jdEditing = false; jdRender(nj); wsxToast(t('adet.saved'));
      })
      .catch(function () { btn.disabled = false; btn.textContent = label; err.textContent = t('autof.couldNotSave'); });
  }
  function jdRun(j, b, out) {
    b.disabled = true; b.textContent = t('sched.running'); out.className = 'wsx-runst'; out.textContent = '';
    fetch('/v1/jobs/' + encodeURIComponent(j.id) + '/run', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        var ex = res.d && res.d.execution;
        if (!res.ok || !ex) throw new Error((res.d && res.d.error) || t('sched.couldNotRun'));
        out.className = 'wsx-runst ' + (ex.success ? 'is-ok' : 'is-fail');
        out.textContent = ex.success ? t('sched.runOk').replace('{dur}', durLabel(ex.duration_ms || 0)) : t('sched.runFailed').replace('{error}', ex.error || t('sched.couldNotRun'));
        j.last_status = ex.status || (ex.success ? 'success' : 'failed'); j.last_run_at = new Date().toISOString(); j.last_error = ex.success ? null : (ex.error || null);
        var host = document.querySelector('[data-jd-runs]'); if (host) jdLoadRuns(j, host);
      })
      .catch(function (e2) { out.className = 'wsx-runst is-fail'; out.textContent = e2 instanceof TypeError ? t('sched.couldNotRun') : e2.message; })
      .then(function () { b.disabled = false; b.textContent = t('sched.runNow'); });
  }
  function jdToggle(j) {
    var on = j.enabled !== false;
    fetch('/v1/jobs/' + encodeURIComponent(j.id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { wsxToast((res.d && res.d.error) || t('autof.couldNotUpdate'), true); return; }
        j.enabled = !on; if (res.d && res.d.job) j.next_run_at = res.d.job.next_run_at;
        jdRender(j); wsxToast(t(on ? 'adet.paused' : 'adet.resumed'));
      })
      .catch(function () { wsxToast(t('autof.couldNotUpdate'), true); });
  }
  function jdDelete(j) {
    if (!window.confirm(t('adet.deleteConfirm').replace('{name}', jdTitle(j)))) return;
    fetch('/v1/jobs/' + encodeURIComponent(j.id), { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) { wsxToast(t('autof.couldNotDelete'), true); return; }
        if (schedJobs) schedJobs = schedJobs.filter(function (x) { return x.id !== j.id; });
        wsxToast(t('autof.schedDeleted')); schedRoute(''); syncHash();
      })
      .catch(function () { wsxToast(t('autof.couldNotDelete'), true); });
  }
  function jdRender(j) {
    var m = document.getElementById('wsxSchedMount'); if (!m) return;
    var back = '<button class="wsx-cat__back" type="button" data-jd="back">' + esc(t('adet.backSched')) + '</button>';
    if (!j) { m.innerHTML = '<div class="wsx-adet-page">' + back + '<div class="wsx-empty">' + esc(t('adet.notFound')) + '</div></div>'; m.firstChild.querySelector('[data-jd="back"]').addEventListener('click', function () { schedRoute(''); syncHash(); }); return; }
    var meta = schedDest(j.action), cfg = j.config || {}, src = cfg.connection || cfg.bqConnection || '';
    var paused = j.enabled === false, st = j.last_status || '';
    var badge = paused ? ['', t('sched.badgePaused')] : st ? [st === 'success' ? 'ok' : st === 'failed' ? 'fail' : '', st] : ['', t('sched.badgeIdle')];
    var arrow = '<span class="wsx-sched__arrow">' + isvg('<path d="M5 12h14M13 6l6 6-6 6"/>') + '</span>';
    var flow = (j.artifact_name ? schedChip(j.artifact_name, 'doc', 'is-origin') + arrow : '') + (src ? schedChip(src, 'db', '') + arrow : '') + schedChip(meta[0], meta[1], 'is-dest');
    var dest = jdDestSummary(j);
    var head = '<div class="wsx-adet__head"><h3 class="wsx-adet__title">' + esc(jdTitle(j)) + '</h3><span class="wsx-sched__badge ' + badge[0] + '">' + esc(badge[1]) + '</span></div>'
      + (j.description && !jdEditing ? '<p class="wsx-adet__desc">' + esc(j.description) + '</p>' : '');
    var acts = jdEditing ? '' : '<div class="wsx-adet__acts"><button class="wsx-abtn wsx-abtn--primary" type="button" data-jd="run">' + esc(t('sched.runNow')) + '</button>'
      + '<button class="wsx-abtn" type="button" data-jd="edit">' + esc(t('adet.edit')) + '</button>'
      + '<button class="wsx-abtn" type="button" data-jd="toggle">' + esc(t(paused ? 'autof.resume' : 'autof.pause')) + '</button>'
      + '<button class="wsx-abtn danger" type="button" data-jd="del">' + esc(t('autof.delete')) + '</button><span class="wsx-runst" aria-live="polite"></span></div>';
    var body = jdEditing ? jdEditHtml(j)
      : adetSec(t('adet.what'), '<div class="wsx-sched__flow">' + flow + '</div><dl class="wsx-adet__dl">'
          + adetRow(t('adet.dest'), esc(meta[0]) + (dest ? ' \\u00b7 <span data-jd-dest>' + esc(dest) + '</span>' : ''))
          + (j.artifact_slug ? adetRow(t('adet.artifact'), '<button class="wsx-link" type="button" data-jd="art">' + esc(j.artifact_name || j.artifact_slug) + '</button>') : '')
          + (src ? adetRow(t('adet.source'), esc(src)) : '') + '</dl>')
        + adetSec(t('adet.when'), '<dl class="wsx-adet__dl">'
          + adetRow(t('adet.schedule'), esc(j.trigger_type === 'event' ? t('adet.onEvent').replace('{event}', j.event_type || '') : cronHuman(j.schedule)))
          + (j.trigger_type === 'event' ? '' : adetRow(t('adet.nextRun'), esc(paused ? t('sched.badgePaused') : adetWhen(j.next_run_at))))
          + adetRow(t('adet.lastRun'), esc(adetWhen(j.last_run_at))) + '</dl>'
          + (st === 'failed' && j.last_error ? '<div class="wsx-runst is-fail">' + esc(j.last_error) + '</div>' : ''));
    m.innerHTML = '<div class="wsx-adet-page">' + back + '<div class="wsx-adet" data-adet="' + esc(j.id) + '">' + head + acts + body
      + adetSec(t('adet.history'), '<div data-jd-runs>' + i18nLoad() + '</div>') + '</div></div>';
    var root = m.firstChild;
    if (jdEditing) afWireSchedule(root, 'jd');
    if (j.action === 'slack' && cfg.channelId) jdSlackChannels(j, function (map) {
      var d = root.querySelector('[data-jd-dest]'); if (d && map[cfg.channelId]) d.textContent = '#' + map[cfg.channelId];
      var s = root.querySelector('#jd_slack'); if (!s) return;
      var ids = Object.keys(map);
      s.innerHTML = afOpt('', t(ids.length ? 'inspector.pickChannel' : 'inspector.noChannels'), !cfg.channelId) + ids.map(function (id) { return afOpt(id, '#' + map[id], id === cfg.channelId); }).join('');
    });
    else if (jdEditing && root.querySelector('#jd_slack')) jdSlackChannels(j, function (map) {
      var s = root.querySelector('#jd_slack'); if (!s) return;
      var ids = Object.keys(map);
      s.innerHTML = afOpt('', t(ids.length ? 'inspector.pickChannel' : 'inspector.noChannels'), true) + ids.map(function (id) { return afOpt(id, '#' + map[id]); }).join('');
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-jd]'); if (!b) return;
      var act = b.getAttribute('data-jd');
      if (act === 'back') { schedRoute(''); syncHash(); }
      else if (act === 'edit') { jdEditing = true; jdRender(j); var f = root.ownerDocument.getElementById('jd_title'); if (f) f.focus(); }
      else if (act === 'cancel') { jdEditing = false; jdRender(j); }
      else if (act === 'save') jdSave(j, root, b);
      else if (act === 'run') jdRun(j, b, root.querySelector('.wsx-adet__acts .wsx-runst'));
      else if (act === 'toggle') jdToggle(j);
      else if (act === 'del') jdDelete(j);
      else if (act === 'art' && j.artifact_slug && typeof openArtifactPage === 'function') openArtifactPage(j.artifact_slug, '');
    });
    jdLoadRuns(j, root.querySelector('[data-jd-runs]'));
  }
  function openJobDetail(id) {
    jdEditing = false;
    var m = document.getElementById('wsxSchedMount'); if (!m) return;
    var j = jdFind(id);
    if (j || schedJobs) { jdRender(j); return; }
    m.innerHTML = i18nLoad();
    fetch('/v1/jobs' + (window.WSX_WS ? '?workspace_id=' + encodeURIComponent(window.WSX_WS) : ''), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) { schedJobs = (d && (d.jobs || d.items)) || []; if (schedDetail === id) jdRender(jdFind(id)); })
      .catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
`;
