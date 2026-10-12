/** Step-by-step (no AI) forms: schedule a send (POST /v1/jobs) and create a metric alert (POST /v1/metric-alerts). */
export const workspace_client_home_views_autoForms_JS = `  // ----- Step-by-step forms, no AI: schedule a send / create a metric alert -----
  // Local time + zone → the UTC cron the scheduler runs on. A time that crosses
  // midnight in UTC moves the weekday (or day of month) with it.
  function afCron(freq, time, day, tz, at) {
    if (freq === 'hourly') return { cron: '0 * * * *' };
    var hm = String(time || '').split(':'); var h = parseInt(hm[0], 10), mi = parseInt(hm[1], 10);
    if (isNaN(h) || isNaN(mi)) return { err: 'autof.errTime' };
    var m = h * 60 + mi - tzOffset(tz, at || new Date());
    var shift = m < 0 ? -1 : m >= 1440 ? 1 : 0; m = (m + 1440) % 1440;
    var base = (m % 60) + ' ' + Math.floor(m / 60);
    if (freq === 'daily') return { cron: base + ' * * *' };
    if (freq === 'weekdays') return { cron: base + ' * * ' + (shift < 0 ? '0-4' : shift > 0 ? '2-6' : '1-5') };
    if (freq === 'weekly') return { cron: base + ' * * ' + ((parseInt(day, 10) + shift + 7) % 7) };
    if (freq === 'monthly') { var d = parseInt(day, 10) + shift; return d >= 1 && d <= 28 ? { cron: base + ' ' + d + ' * *' } : { err: 'autof.errMonthDay' }; }
    return { err: 'autof.errTime' };
  }
  function afOpt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function afSel(label, id, opts) { return '<label class="wsx-field" data-af="' + id + '"><span class="wsx-field__lbl">' + esc(label) + '</span><select class="wsx-field__in" id="' + id + '">' + opts + '</select></label>'; }
  function afTzOptions() {
    var cur = viewerTz();
    var all = []; try { all = Intl.supportedValuesOf('timeZone').slice(); } catch (e) {}
    if (all.indexOf(cur) < 0) all.unshift(cur); if (all.indexOf('UTC') < 0) all.push('UTC');
    return all.map(function (z) { return afOpt(z, z.replace(/_/g, ' '), z === cur); }).join('');
  }
  function afFreqOptions(kind) {
    var f = kind === 'alert' ? ['hourly', 'daily', 'weekdays', 'weekly'] : ['daily', 'weekdays', 'weekly', 'monthly'];
    var lbl = { hourly: 'autof.freqHourly', daily: 'autof.freqDaily', weekdays: 'autof.freqWeekdays', weekly: 'autof.freqWeekly', monthly: 'autof.freqMonthly' };
    return f.map(function (k) { return afOpt(k, t(lbl[k]), k === (kind === 'alert' ? 'daily' : 'weekly')); }).join('');
  }
  function afDayOptions(freq) {
    if (freq === 'monthly') { var o = ''; for (var d = 1; d <= 28; d++) o += afOpt(d, String(d), d === 1); return o; }
    return [1, 2, 3, 4, 5, 6, 0].map(function (d) { return afOpt(d, t(CRON_DAYS[d]), d === 1); }).join('');
  }
  // Channels come from the server's deliver status: email always, Telegram only once
  // linked, Slack only when the workspace has it AND the caller can post to a channel.
  function afChannels(st) {
    var out = [['email', t('autof.chEmail')]];
    if (st && st.slack && st.slack.connected && st.role !== 'viewer') out.push(['slack', t('autof.chSlack')]);
    if (st && st.telegram && st.telegram.linked) out.push(['telegram', t('autof.chTelegram')]);
    return out;
  }
  function afRecipients(raw) { return String(raw || '').split(/[,;\\s]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  // kind: 'schedule' | 'alert'. preset: { id, name } to skip the artifact picker. onDone runs after a save.
  function openAutoForm(kind, preset, onDone) {
    var isAlert = kind === 'alert';
    var st = null, defs = [], names = {};
    var body = '<div class="wsx-cform">'
      + (preset && preset.id ? '<p class="wsx-field__note"><b>' + esc(t('autof.artifact')) + ':</b> ' + esc(preset.name || '') + '</p>'
        : afSel(t('autof.artifact'), 'af_art', afOpt('', t('common.loading'), true)))
      + '<div class="wsx-cform" id="af_dyn"></div>'
      + '<div class="wsx-cform__row">' + afSel(t('autof.frequency'), 'af_freq', afFreqOptions(kind))
      + afSel(t('autof.weekday'), 'af_day', afDayOptions('weekly')) + '</div>'
      + '<div class="wsx-cform__row">' + '<label class="wsx-field" data-af="af_time"><span class="wsx-field__lbl">' + esc(t('autof.time')) + '</span><input class="wsx-field__in" id="af_time" type="time" value="09:00"></label>'
      + afSel(t('autof.timezone'), 'af_tz', afTzOptions()) + '</div>'
      + '<div class="wsx-cform__err" id="af_err" role="alert"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-link" id="af_ai" type="button">' + esc(t('autof.useAi')) + '</button>'
      + '<button class="wsx-abtn" id="af_cancel" type="button">' + esc(t('autof.cancel')) + '</button>'
      + '<button class="wsx-abtn wsx-abtn--primary" id="af_submit" type="button" disabled>' + esc(t(isAlert ? 'autof.submitAlert' : 'autof.submitSchedule')) + '</button></div></div>';
    var modal = wsxModal(t(isAlert ? 'autof.alertTitle' : 'autof.scheduleTitle'), body);
    var root = modal.body;
    function q(id) { return root.querySelector('#' + id); }
    function artId() { return preset && preset.id ? preset.id : (q('af_art') ? q('af_art').value : ''); }
    function artName() { return preset && preset.id ? preset.name || '' : names[artId()] || ''; }
    function err(k, raw) { q('af_err').textContent = raw || (k ? t(k) : ''); }
    function syncFreq() {
      var f = q('af_freq').value, dayF = root.querySelector('[data-af="af_day"]');
      var showDay = f === 'weekly' || f === 'monthly';
      dayF.hidden = !showDay; if (showDay) { q('af_day').innerHTML = afDayOptions(f); dayF.querySelector('.wsx-field__lbl').textContent = t(f === 'monthly' ? 'autof.monthDay' : 'autof.weekday'); }
      root.querySelector('[data-af="af_time"]').hidden = f === 'hourly'; root.querySelector('[data-af="af_tz"]').hidden = f === 'hourly';
    }
    function paintChannel() {
      var box = q('af_chbox'); if (!box) return;
      var ch = q('af_ch').value; var mine = (st && st.email && st.email.address) || '';
      if (ch === 'email') {
        var self = st && st.role === 'viewer';
        box.innerHTML = '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('autof.recipients')) + '</span><input class="wsx-field__in" id="af_to" type="text" autocomplete="off" value="' + esc(mine) + '"' + (self ? ' readonly' : ' placeholder="' + esc(t('autof.recipientsPh')) + '"') + '></label>'
          + '<p class="wsx-field__note">' + esc(t(self ? 'autof.selfOnly' : 'autof.recipientsNote')) + '</p>';
      } else if (ch === 'slack') {
        box.innerHTML = afSel(t('autof.slackChannel'), 'af_slack', afOpt('', t('common.loading'), true));
        fetch('/v1/artifacts/' + encodeURIComponent(artId()) + '/deliver/slack-channels', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { var s = q('af_slack'); if (!s) return; var c = (d && d.channels) || []; s.innerHTML = afOpt('', t(c.length ? 'inspector.pickChannel' : 'inspector.noChannels'), true) + c.map(function (x) { return afOpt(x.id, '#' + x.name); }).join(''); })
          .catch(function () {});
      } else box.innerHTML = '<p class="wsx-field__note">' + esc(t('autof.telegramNote')) + '</p>';
    }
    function paintDyn() {
      var dyn = q('af_dyn'); var h = '';
      if (isAlert) {
        if (!defs.length) {
          dyn.innerHTML = '<p class="wsx-field__note">' + esc(t('autof.noMetrics')) + '</p>';
          q('af_submit').disabled = true; return;
        }
        h += afSel(t('autof.metric'), 'af_metric', defs.map(function (d, i) { return afOpt(d.metric_id, d.label || d.metric_id, i === 0); }).join(''))
          + '<div class="wsx-cform__row">' + afSel(t('autof.when'), 'af_op', afOpt('gt', t('autof.opGt'), true) + afOpt('lt', t('autof.opLt')) + afOpt('eq', t('autof.opEq')) + afOpt('change_pct_gt', t('autof.opUpPct')) + afOpt('change_pct_lt', t('autof.opDownPct')))
          + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('autof.value')) + '</span><input class="wsx-field__in" id="af_val" type="number" step="any" inputmode="decimal"></label></div>';
      }
      h += afSel(t('autof.channel'), 'af_ch', afChannels(st).map(function (c, i) { return afOpt(c[0], c[1], i === 0); }).join('')) + '<div class="wsx-cform" id="af_chbox"></div>';
      dyn.innerHTML = h;
      q('af_ch').addEventListener('change', paintChannel);
      paintChannel();
      q('af_submit').disabled = false;
    }
    function loadArt() {
      var id = artId(); st = null; defs = []; q('af_submit').disabled = true; err();
      if (!id) { q('af_dyn').innerHTML = ''; return; }
      q('af_dyn').innerHTML = '<p class="wsx-field__note">' + esc(t('autof.loadingStatus')) + '</p>';
      var enc = encodeURIComponent(id);
      Promise.all([
        fetch('/v1/artifacts/' + enc + '/deliver', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
        isAlert ? fetch('/v1/metric-alerts/definitions?artifact_id=' + enc, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }) : null
      ]).then(function (res) {
        if (artId() !== id) return;
        if (!res[0]) { q('af_dyn').innerHTML = ''; err('autof.couldNotLoadArt'); return; }
        st = res[0]; defs = (res[1] && res[1].definitions) || [];
        paintDyn();
      }).catch(function () { err('autof.couldNotLoadArt'); });
    }
    function build() {
      var id = artId(); if (!id) return { err: 'autof.errArtifact' };
      var ch = q('af_ch') && q('af_ch').value; if (!ch) return { err: 'autof.errArtifact' };
      var config;
      if (ch === 'email') {
        var to = afRecipients(q('af_to').value); if (!to.length) return { err: 'autof.errRecipients' };
        config = { recipients: to, includeArtifactLink: true };
      } else if (ch === 'slack') {
        var cid = q('af_slack') && q('af_slack').value; if (!cid) return { err: 'autof.errChannel' };
        config = { connection: st.slack.connectionName, channelId: cid, includeArtifactLink: true };
      } else config = { includeArtifactLink: true };
      var c = afCron(q('af_freq').value, q('af_time').value, q('af_day').value, q('af_tz').value);
      if (c.err) return { err: c.err };
      if (!isAlert) return { url: '/v1/jobs', body: { artifact_id: id, action: ch, schedule: c.cron, config: config } };
      var metric = q('af_metric') && q('af_metric').value; if (!metric) return { err: 'autof.errMetric' };
      var v = parseFloat(q('af_val').value); if (!isFinite(v)) return { err: 'autof.errValue' };
      var label = defs.filter(function (d) { return d.metric_id === metric; }).map(function (d) { return d.label || d.metric_id; })[0] || metric;
      return { url: '/v1/metric-alerts', body: { artifact_id: id, metric_id: metric, name: label + ' \\u00B7 ' + artName(), condition: { op: q('af_op').value, value: v }, schedule: c.cron, destination: { kind: ch, config: config } } };
    }
    q('af_freq').addEventListener('change', syncFreq); syncFreq();
    q('af_cancel').addEventListener('click', modal.close);
    q('af_ai').addEventListener('click', function () {
      var n = artName(); modal.close();
      agentAsk(n ? t(isAlert ? 'inspector.askAlert' : 'inspector.askSchedule').replace('{name}', n) : t(isAlert ? 'alerts.prefillStep' : 'sched.prefillStep'));
    });
    q('af_submit').addEventListener('click', function () {
      var sub = this; err(); var b = build(); if (b.err) { err(b.err); return; }
      sub.disabled = true;
      fetch(b.url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b.body) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          sub.disabled = false;
          if (!res.ok) { err(null, (res.d && res.d.error) || t('autof.couldNotSave')); return; }
          modal.close(); wsxToast(t(isAlert ? 'autof.alertOk' : 'autof.scheduledOk'));
          if (isAlert ? loaded.alerts : loaded.schedules) { if (isAlert) loadAlerts(); else loadSchedules(); }
          if (onDone) onDone();
        })
        .catch(function () { sub.disabled = false; err('autof.couldNotSave'); });
    });
    if (preset && preset.id) { loadArt(); return modal; }
    q('af_art').addEventListener('change', loadArt);
    fetch('/v1/artifacts?limit=100' + (window.WSX_WS ? '&workspace_id=' + encodeURIComponent(window.WSX_WS) : ''), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var arts = (d && d.artifacts) || []; var s = q('af_art'); if (!s) return;
        arts.forEach(function (a) { names[a.id] = a.name; });
        s.innerHTML = afOpt('', t(arts.length ? 'autof.pickArtifact' : 'autof.noArtifacts'), true) + arts.map(function (a) { return afOpt(a.id, a.name); }).join('');
      }).catch(function () { err('autof.couldNotLoadArt'); });
    return modal;
  }
  // Pause / resume / delete on a schedule or alert card (the list only holds the caller's own).
  function wireAutoCardActions(m, kind) {
    m.querySelectorAll('[data-af-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var card = b.closest('[data-af-id]'); var id = card.getAttribute('data-af-id'); var act = b.getAttribute('data-af-act');
        var base = (kind === 'alert' ? '/v1/metric-alerts/' : '/v1/jobs/') + encodeURIComponent(id);
        var reload = kind === 'alert' ? loadAlerts : loadSchedules;
        if (act === 'toggle') {
          var on = card.getAttribute('data-af-on') === '1'; b.disabled = true;
          fetch(base, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) })
            .then(function (r) { if (!r.ok) throw new Error('failed'); reload(); })
            .catch(function () { b.disabled = false; wsxToast(t('autof.couldNotUpdate'), true); });
        } else if (act === 'del') {
          if (!window.confirm(t(kind === 'alert' ? 'autof.deleteAlertConfirm' : 'autof.deleteSchedConfirm'))) return;
          b.disabled = true;
          fetch(base, { method: 'DELETE', credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw new Error('failed'); card.remove(); })
            .catch(function () { b.disabled = false; wsxToast(t('autof.couldNotDelete'), true); });
        }
      });
    });
  }
  function autoCardButtons(enabled) {
    return '<button class="wsx-abtn" data-af-act="toggle" type="button">' + esc(t(enabled ? 'autof.pause' : 'autof.resume')) + '</button>'
      + '<button class="wsx-abtn danger" data-af-act="del" type="button">' + esc(t('autof.delete')) + '</button>';
  }
  // Top bar on the Schedules / Alerts lens: the form is the main path, chat is the alternative.
  function autoBar(kind) {
    return '<div class="wsx-auto-bar"><button class="wsx-abtn wsx-abtn--primary" data-autoform="' + kind + '" type="button">' + esc(t(kind === 'alert' ? 'autof.alertTitle' : 'autof.scheduleTitle')) + '</button>'
      + '<button class="wsx-abtn" data-newauto="' + esc(t(kind === 'alert' ? 'alerts.prefillChat' : 'sched.prefillChat')) + '" type="button">' + esc(t('autof.askAi')) + '</button></div>';
  }
  function wireAutoForm(root) {
    root.querySelectorAll('[data-autoform]').forEach(function (b) {
      b.addEventListener('click', function () { openAutoForm(b.getAttribute('data-autoform')); });
    });
  }
`;
