/** Envíos tab: send-now / schedule delivery + metric monitoring (lazy chunk; inspector IIFE scope). */
export const workspace_client_inspector_deliver_JS = `  // Deliver → destination tiles + a per-destination body (recipient/send, or a Connect prompt).
  function deliverHtml() {
    return '<div class="wsx-det__dests" role="radiogroup" aria-label="' + esc(t('inspector.deliver')) + '">'
      + '<button class="wsx-det__dest" data-dest="Slack" role="radio" aria-checked="false" type="button"><img class="wsx-det__destlogo" src="/brand/slack-icon.png" alt="" width="22" height="22" decoding="async">Slack</button>'
      + '<button class="wsx-det__dest" data-dest="Telegram" role="radio" aria-checked="false" type="button"><img class="wsx-det__destlogo" src="/brand/telegram-icon.png" alt="" width="22" height="22" decoding="async">Telegram</button>'
      + '<button class="wsx-det__dest" data-dest="Email" role="radio" aria-checked="false" type="button">' + isvg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>') + 'Email</button>'
      + '</div>'
      + '<div class="wsx-det__delbody" id="wsxDelBody"></div>';
  }

  function renderDeliver(art, root) {
    root.innerHTML = deliverHtml();
    // Pick a destination; unconnected channels offer Connect, else recipient + Send now / Schedule.
    var dest = null, delStatus = null;
    var delBody = root.querySelector('#wsxDelBody');
    var recipPh = { Slack: t('inspector.deliverToSlack'), Telegram: t('inspector.deliverToTelegram'), Email: t('inspector.deliverToEmail') };
    var CRON = { Daily: '0 9 * * *', Weekly: '0 9 * * 1', Monthly: '0 9 1 * *' };
    function deliverConfig() {
      var inp = delBody && delBody.querySelector('#wsxRecip'); var r = inp && inp.value.trim();
      if (dest === 'Email') return { recipients: r ? [r] : [], includeArtifactLink: true };
      if (dest === 'Telegram') return r ? { chatId: r, includeArtifactLink: true } : { includeArtifactLink: true };
      return { connection: delStatus && delStatus.slack ? delStatus.slack.connectionName : undefined, channelId: r || undefined, includeArtifactLink: true }; // Slack
    }
    function actionRowHtml(ctl) {
      return ctl
        + '<div class="wsx-det__delact"><button class="wsx-abtn wsx-abtn--primary wsx-det__send" data-dsend="now" type="button">' + esc(t(dest === 'Slack' ? 'inspector.postToSlack' : 'inspector.sendNow')) + '</button>'
        + '<button class="wsx-abtn wsx-det__sched" data-dsend="schedule" type="button">' + esc(t('inspector.schedule')) + '</button></div>'
        + '<div class="wsx-det__freq" id="wsxFreq" hidden>' + ['Daily', 'Weekly', 'Monthly'].map(function (f) { return '<button class="wsx-abtn wsx-det__freqbtn" data-freq="' + f + '" type="button">' + esc(t('inspector.freq' + f)) + '</button>'; }).join('') + '</div>';
    }
    function recipControlHtml() {
      if (dest === 'Slack') return '<select class="wsx-share__search wsx-det__recip" id="wsxRecip"><option value="">' + esc(t('inspector.loadingChannels')) + '</option></select>';
      return '<input class="wsx-share__search wsx-det__recip" id="wsxRecip" autocomplete="off" placeholder="' + esc(recipPh[dest] || '') + '">';
    }
    function loadSlackChannels() {
      var sel = delBody.querySelector('#wsxRecip'); if (!sel) return;
      fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/deliver/slack-channels', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ch = (j && j.channels) || [];
          if (!ch.length) { sel.innerHTML = '<option value="">' + esc(t('inspector.noChannels')) + '</option>'; return; }
          sel.innerHTML = '<option value="">' + esc(t('inspector.pickChannel')) + '</option>' + ch.map(function (c) { return '<option value="' + esc(c.id) + '">#' + esc(c.name) + '</option>'; }).join('');
        })
        .catch(function () { sel.innerHTML = '<option value="">' + esc(t('inspector.noChannels')) + '</option>'; });
    }
    function connectRowHtml(url, label, hint) {
      return '<div class="wsx-det__connect"><div class="wsx-det__connhint">' + esc(hint) + '</div>'
        + '<div class="wsx-det__delact"><a class="wsx-abtn wsx-abtn--primary wsx-det__send" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + '</a>'
        + '<button class="wsx-abtn" data-recheck="1" type="button">' + esc(t('inspector.checkAgain')) + '</button></div></div>';
    }
    function renderDelBody() {
      if (!delBody || !dest) return;
      var s = delStatus || {};
      if (dest === 'Telegram' && s.telegram && !s.telegram.linked) delBody.innerHTML = connectRowHtml(s.telegram.connectUrl, t('inspector.connectTelegram'), t('inspector.telegramHint'));
      else if (dest === 'Slack' && s.slack && !s.slack.available) delBody.innerHTML = '<div class="wsx-det__connhint">' + esc(t('inspector.slackNeedsWs')) + '</div>';
      else if (dest === 'Slack' && s.slack && !s.slack.connected) delBody.innerHTML = connectRowHtml(s.slack.connectUrl, t('inspector.connectSlack'), t('inspector.slackHint'));
      else delBody.innerHTML = actionRowHtml(recipControlHtml());
      wireDelBody();
      if (dest === 'Slack' && s.slack && s.slack.connected) loadSlackChannels();
    }
    function wireDelBody() {
      var recheck = delBody.querySelector('[data-recheck]');
      if (recheck) recheck.addEventListener('click', function () { loadStatus(); });
      var freqRow = delBody.querySelector('#wsxFreq');
      delBody.querySelectorAll('[data-dsend]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-dsend') === 'schedule') { if (freqRow) freqRow.hidden = !freqRow.hidden; return; }
          var label = b.textContent; b.disabled = true; b.textContent = t('inspector.deliverSending');
          // Slack "Post to Slack" sends the rich preview card (TL;DR, image, owner, updated).
          var cfg = deliverConfig(), slack = dest === 'Slack';
          fetch('/v1/artifacts/' + encodeURIComponent(art.id) + (slack ? '/share/slack' : '/deliver'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slack ? { connection: cfg.connection, channelId: cfg.channelId, preview: true } : { action: dest.toLowerCase(), config: cfg }) })
            .then(okOr)
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) { b.disabled = false; b.textContent = label; if (j && (j.success || j.delivered)) wsxToast(t('inspector.deliverSent').replace('{dest}', dest)); else wsxToast((j && j.error) || t('inspector.deliverFailed'), true); })
            .catch(function (e) { b.disabled = false; b.textContent = label; failToast(e, t('inspector.deliverFailed')); });
        });
      });
      delBody.querySelectorAll('[data-freq]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = b.getAttribute('data-freq'), d = dest, cfg = deliverConfig();
          optimistic({
            key: 'sched:' + art.id,
            apply: function () { if (freqRow) freqRow.hidden = true; },
            rollback: function () { if (freqRow) freqRow.hidden = false; },
            request: function () {
              return fetch('/v1/jobs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifact_id: art.id, action: d.toLowerCase(), config: cfg, schedule: CRON[f] }) })
                .then(okOr)
                .then(function (r) { return r.json().catch(function () { return null; }); })
                .then(function (j) { if (j && (j.id || j.job || j.success)) return j; var e = new Error('schedule'); e.userMessage = j && j.error; throw e; });
            },
            success: t('inspector.scheduled').replace('{freq}', t('inspector.freq' + f)).replace('{dest}', d),
            error: function (e) { return (e && e.userMessage) || t('inspector.deliverFailed'); },
          });
        });
      });
    }
    function loadStatus() {
      fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/deliver', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { delStatus = j; renderDelBody(); })
        .catch(function () {});
    }
    root.querySelectorAll('[data-dest]').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-dest]').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('is-on'); b.setAttribute('aria-checked', 'true');
        dest = b.getAttribute('data-dest'); renderDelBody();
      });
    });
    loadStatus();
  }
  // ----- Watches (metric_watches via /v1/metric-watch). No table-list plumbing —
  // table is free text; a bad table/column name surfaces as a toast from the API. -----
  function watchMetricLabel(w) { return w.metric_kind === 'sum' ? 'sum(' + w.column_name + ')' : (w.metric_kind === 'last' ? w.column_name : t('inspector.watchKind.count')); }
  function watchRow(w) {
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(w.table_name) + ' \\u00B7 ' + esc(watchMetricLabel(w)) + '</div><div class="wsx-row__sub">' + esc(t('inspector.watchThreshold').replace('{n}', w.threshold_pct)) + '</div></div>'
      + '<button class="wsx-det__icon is-danger" data-wdel="' + esc(w.id) + '" type="button" data-tip="' + esc(t('inspector.act.trash')) + '" aria-label="' + esc(t('inspector.act.trash')) + '">' + isvg(SVG_TRASH) + '</button></div>';
  }
  function watchFormHtml() {
    var kinds = ['count', 'sum', 'last'].map(function (k) { return '<option value="' + k + '">' + esc(t('inspector.watchKind.' + k)) + '</option>'; }).join('');
    return '<div class="wsx-list" id="wsxWForm">'
      + '<input class="wsx-share__search" id="wsxWTable" placeholder="' + esc(t('inspector.watchTablePh')) + '" autocomplete="off">'
      + '<select class="wsx-share__search" id="wsxWKind">' + kinds + '</select>'
      + '<input class="wsx-share__search" id="wsxWColumn" placeholder="' + esc(t('inspector.watchColumnPh')) + '" autocomplete="off" hidden>'
      + '<input class="wsx-share__search" id="wsxWThreshold" type="number" min="1" placeholder="20">'
      + '<button class="wsx-abtn wsx-abtn--block" id="wsxWAdd" type="button">' + esc(t('inspector.watchAdd')) + '</button>'
      + '</div>';
  }
  function loadWatches(art, box) {
    fetch('/v1/metric-watch?artifact_id=' + encodeURIComponent(art.id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { paintWatches(art, box, (d && d.watches) || []); })
      .catch(function () { paintWatches(art, box, []); });
  }
  function paintWatches(art, box, watches) {
    var listH = watches.length ? '<div class="wsx-list">' + watches.map(watchRow).join('') + '</div>' : '<div class="wsx-tests__off">' + esc(t('inspector.watchesEmpty')) + '</div>';
    box.innerHTML = listH + watchFormHtml();
    box.querySelectorAll('[data-wdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var wid = b.getAttribute('data-wdel'), row = b.closest('.wsx-row'), leaving = null;
        optimistic({
          key: 'watch:del:' + wid,
          undo: true,
          apply: function () { leaving = window.soOptimistic.leave(row); },
          rollback: function () { if (leaving) leaving.restore(); },
          request: function () {
            return fetch('/v1/metric-watch/' + encodeURIComponent(wid), { method: 'DELETE', credentials: 'same-origin', keepalive: true })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (j) { if (!j || !j.success) throw new Error('watch'); });
          },
          success: t('inspector.watchRemoved'),
          error: t('inspector.watchDeleteFailed'),
          done: function () { if (leaving) leaving.commit(); },
        });
      });
    });
    var kindSel = box.querySelector('#wsxWKind'), colInp = box.querySelector('#wsxWColumn');
    function syncCol() { colInp.hidden = kindSel.value === 'count'; }
    kindSel.addEventListener('change', syncCol); syncCol();
    box.querySelector('#wsxWAdd').addEventListener('click', function () {
      var btn = box.querySelector('#wsxWAdd');
      var table = box.querySelector('#wsxWTable').value.trim();
      var column = colInp.value.trim();
      var threshold = box.querySelector('#wsxWThreshold').value.trim();
      if (!table) { try { wsxToast(t('inspector.watchTableRequired'), true); } catch (e) {} return; }
      var body = { artifact_id: art.id, table: table, kind: kindSel.value };
      if (column) body.column = column;
      if (threshold) body.threshold_pct = Number(threshold);
      // Exception to optimistic: the server validates the table/column and returns the new
      // watch id the row's delete needs — keep a busy button until it answers.
      var btnLabel = btn.textContent;
      btn.disabled = true; btn.textContent = t('common.saving');
      fetch('/v1/metric-watch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (!res.ok || !res.j || !res.j.watch) { btn.disabled = false; btn.textContent = btnLabel; wsxToast((res.j && res.j.error) || t('inspector.watchAddFailed'), true); return; } loadWatches(art, box); })
        .catch(function () { btn.disabled = false; btn.textContent = btnLabel; wsxToast(t('inspector.watchAddFailed'), true); });
    });
  }
  function renderWatches(art) {
    var box = rbodyEl.querySelector('#wsxWatches'); if (!box || !art.id) return;
    box.innerHTML = i18nLoad();
    loadWatches(art, box);
  }

`;
