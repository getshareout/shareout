/** Right rail Inspector panels. */
export const workspace_client_inspector_JS = `  // ===== right rail = the working Inspector (Activity on Home; Details/Comments/Automate on a doc) =====
  var needsEvents = [], pulseEvents = [], WSX_WIN = '7d';
  var GEAR_SVG = isvg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
  var rtabsEl = document.getElementById('wsxRtabs');
  var rbodyEl = document.getElementById('wsxRbody');
  var rActive = 'activity';
  // Per-artifact caches so switching tabs doesn't refetch / flash a loader.
  var metaCache = {}, statsCache = {}, cmtCache = {}, autoCache = {};
  function isvg(p) { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var SVG_OPEN = '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>';
  var SVG_EDIT = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>';
  var SVG_COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>';
  var SVG_STAR = '<path d="M12 17.3l-5.5 3.3 1.5-6.3-4.9-4.2 6.4-.5L12 3.5l2.5 5.9 6.4.5-4.9 4.2 1.5 6.3z"/>';
  var SVG_TRASH = '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>';
  var SVG_EMOJI = '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><line x1="9" y1="9.2" x2="9.01" y2="9.2"/><line x1="15" y1="9.2" x2="15.01" y2="9.2"/>';
  var SVG_SEND = '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>';
  var EMOJI_SET = ['\\uD83D\\uDC4D','\\u2764\\uFE0F','\\uD83D\\uDE04','\\uD83C\\uDF89','\\uD83D\\uDC40','\\uD83D\\uDE4F','\\uD83D\\uDD25','\\u2705','\\u26A0\\uFE0F','\\uD83D\\uDE80','\\uD83D\\uDCA1','\\uD83D\\uDC4F','\\uD83E\\uDD14','\\uD83D\\uDE0D','\\uD83D\\uDE05','\\uD83D\\uDE0E','\\uD83D\\uDCAF','\\uD83D\\uDE4C','\\uD83D\\uDC4C','\\uD83D\\uDE2C'];

  document.addEventListener('click', function () { var m = rbodyEl.querySelector('.wsx__deliver-menu'); if (m) m.hidden = true; });

  // Activity-feed renderers (feedText, groupFeed, tlRow, pulseTlRow, renderActivity,
  // wireActivityControls) live in inspector-activity.ts — same IIFE scope, concatenated
  // just before this module (split out for the client-script size cap).
  function renderRTabs(items) {
    rtabsEl.innerHTML = items.map(function (t) {
      return '<button class="wsx__rtab' + (t.key === rActive ? ' is-active' : '') + '" data-rtab="' + t.key + '" type="button">' + (t.dot ? '<span class="wsx__live-dot"></span>' : '') + esc(t.label) + '</button>';
    }).join('');
    rtabsEl.querySelectorAll('[data-rtab]').forEach(function (b) { b.addEventListener('click', function () { rActive = b.getAttribute('data-rtab'); paintRail(); }); });
  }
  function paintRail() {
    if (!activeArt) {
      // Home: nothing to inspect — hide the right rail; Activity lives in a canvas widget.
      ws.classList.add('is-home');
      return;
    }
    ws.classList.remove('is-home');
    if (panes[activeKey] && panes[activeKey].mode === 'edit') {
      rActive = 'edit';
      renderRTabs([{ key: 'edit', label: t('inspector.editing') }]);
      renderEditPanel(panes[activeKey]);
    } else {
      if (['details', 'comments', 'automate'].indexOf(rActive) < 0) rActive = 'details';
      renderRTabs([{ key: 'details', label: t('inspector.details') }, { key: 'comments', label: t('inspector.comments') }, { key: 'automate', label: t('inspector.automate') }]);
      if (rActive === 'comments') renderComments(activeArt);
      else if (rActive === 'automate') renderAutomate(activeArt);
      else renderDetails(activeArt);
    }
  }

  function patchArtifact(id, body, cb) {
    fetch('/v1/artifacts/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
      .then(function (j) { if (cb) cb(j); }).catch(function () { if (cb) cb(null); });
  }
  function setTabLabel(key, label) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) { tabs[i].label = label; }
    renderTabs(); saveTabs();
  }

  // ----- Details -----
  function renderDetails(art) {
    if (!art.id) { paintDetails(art, null); return; }
    if (metaCache[art.id] !== undefined) { paintDetails(art, metaCache[art.id]); return; }
    rbodyEl.innerHTML = '<div class="wsx__details">' + i18nLoad() + '</div>';
    fetch('/v1/artifacts/' + encodeURIComponent(art.id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { metaCache[art.id] = d; paintDetails(art, d); })
      .catch(function () { paintDetails(art, null); });
  }
  function iconBtn(act, title, path, extra) {
    return '<button class="wsx-det__icon ' + (extra || '') + '" data-iact="' + act + '" type="button" data-tip="' + esc(title) + '" aria-label="' + esc(title) + '">' + isvg(path) + '</button>';
  }
  function fmtDate(s) { if (!s) return '\\u2014'; var ts = Date.parse(s); if (!ts) return '\\u2014'; var d = new Date(ts); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  function visName(k) { return t('inspector.visName.' + k); }
  function visCaption(k) { return t('inspector.visCaption.' + k); }
  // Open visibility restricts external CDNs (CSP allowlist); nudge private+collaborators to lift it.
  function visSub(k) { var c = visCaption(k); return k === 'public' ? c + ' ' + t('inspector.visCdnHint') : c; }
  // "Shared with" empty-state title tracks visibility so it never contradicts the badge (Public but "only you see").
  function shareEmptyTitle(v) { return v === 'private' ? t('inspector.onlyYouSee') : visCaption(v === 'unlisted' ? 'public' : v); }
  // Details helpers (GRIP_SVG, loadSecOrder/saveSecOrder, sec, aboutHtml, deliverHtml,
  // wsxToast, bgAgent, wireSecDnd) live in inspector-details.ts — same IIFE scope.
  function paintDetails(art, meta) {
    var editable = !!meta;
    var name = (meta && meta.name) || art.name || t('inspector.artifact');
    var desc = (meta && meta.description) || '';
    var vis = (meta && meta.visibility) || '';
    var slug = (meta && meta.slug) || art.slug;
    var type = (meta && meta.artifact_type) || art.type || '';
    var openUrl = '/a/' + encodeURIComponent(slug) + '/';
    var fullUrl = (meta && meta.url) || (location.origin + openUrl);
    var fav = meta && meta.is_favorite;
    var ce = editable ? ' contenteditable="true" spellcheck="false"' : '';
    var hasWs = !!(meta && meta.workspace_id);
    var visOpts = ['private'].concat(hasWs ? ['workspace'] : [], ['public']);
    var visCur = (vis === 'unlisted' ? 'public' : vis) || 'private';

    // Header: name + star (banner removed to reclaim vertical space).
    var favTip = fav ? t('inspector.favRemove') : t('inspector.favAdd');
    var star = editable ? '<button class="wsx-det__star' + (fav ? ' is-on' : '') + '" data-iact="fav" type="button" data-tip="' + esc(favTip) + '" aria-label="' + esc(favTip) + '">' + isvg(SVG_STAR) + '</button>' : '';
    var visBlock = editable
      ? '<div class="wsx-vis-seg" id="wsxVisSeg" role="radiogroup" aria-label="' + esc(t('inspector.visibility')) + '">'
        + visOpts.map(function (o) { return '<button data-vis="' + o + '" role="radio" aria-checked="' + (o === visCur ? 'true' : 'false') + '" type="button" class="' + (o === visCur ? 'is-sel vk-' + o : '') + '"><span class="dot"></span>' + esc(visName(o)) + '</button>'; }).join('')
        + '</div><div class="wsx-vis-seg__sub" id="wsxVisSub">' + esc(visSub(visCur)) + '</div>'
      : '<span class="wsx-det__type">' + esc(visName(visCur)) + '</span>';

    var h = '<div class="wsx__details">';
    h += '<div class="wsx-det__hrow"><div class="wsx-det__name"' + ce + ' data-edit="name">' + esc(name) + '</div>' + star + '</div>';
    h += visBlock;
    // Persistent held banner (Workstream C): meta.moderation is present only to the
    // owner/admin of a held page (GET detail, Workstream B). Reason + the standard
    // pending/blocked message, so the hold isn't a silent dead end.
    if (meta && meta.moderation) {
      var mod = meta.moderation;
      var modTint = mod.status === 'blocked' ? 'var(--color-error)' : 'var(--color-warning)';
      var modLabel = mod.status === 'blocked' ? 'Blocked by review' : 'Under review';
      h += '<div class="wsx-det__modnote" style="margin:8px 0 4px;padding:10px 12px;border-radius:8px;font-size:12.5px;line-height:1.45;background:color-mix(in srgb,' + modTint + ' 12%,transparent);color:var(--color-text-secondary);border:1px solid color-mix(in srgb,' + modTint + ' 30%,transparent)">'
        + '<strong style="color:' + modTint + '">' + esc(modLabel) + '</strong>'
        + (mod.reason ? ' \\u00B7 ' + esc(mod.reason) : '')
        + '<div style="margin-top:4px">' + esc(mod.message) + '</div></div>';
    }
    h += '<div class="wsx-det__actions2">'
      + '<button class="wsx-abtn wsx-det__act" data-iact="open" type="button">' + isvg(SVG_OPEN) + esc(t('inspector.openLabel')) + '</button>'
      + '<button class="wsx-abtn wsx-det__act" data-iact="edit" type="button">' + isvg(SVG_EDIT) + esc(t('inspector.editLabel')) + '</button>'
      + iconBtn('copy', t('inspector.act.copy'), SVG_COPY)
      + iconBtn('trash', t('inspector.act.trash'), SVG_TRASH, 'is-danger')
      + '</div>';

    // Section bodies, keyed; rendered in the user's saved order.
    var secBody = {
      share: '<div class="wsx-det__chips wsx-det__sharecard" id="wsxShare"></div>',
      deliver: deliverHtml(),
      about: meta ? aboutHtml(meta, type, vis) : '',
      description: '<div class="wsx-det__desc"' + ce + ' data-edit="description">' + esc(desc) + '</div>',
      tags: '<div class="wsx-det__chips" id="wsxTags"></div>',
      folder: '<div id="wsxFolder"></div>',
      tests: '<div id="wsxTests"></div>',
      analytics: '<div id="wsxDetStats" class="wsx-det__stats"></div>',
      watches: '<div id="wsxWatches"></div>'
    };
    var secMeta = {
      share: [t('inspector.sharedWith'), t('inspector.sharedWithHelp')],
      deliver: [t('inspector.deliver'), t('inspector.deliverHelp')],
      about: [t('inspector.about'), t('inspector.aboutHelp')],
      description: [t('inspector.description'), t('inspector.descriptionHelp')],
      tags: [t('inspector.tags'), t('inspector.tagsHelp')],
      folder: [t('inspector.folder'), t('inspector.folderHelp')],
      tests: [t('inspector.tests'), t('inspector.testsHelp')],
      analytics: [t('inspector.analytics'), t('inspector.analyticsHelp')],
      watches: [t('inspector.watches'), t('inspector.watchesHelp')]
    };
    var order = editable ? loadSecOrder() : ['description'];
    h += '<div class="wsx-det__secs" id="wsxSecs">' + order.map(function (k) {
      if (!secBody[k]) return '';
      return sec(k, secMeta[k][0], secMeta[k][1], secBody[k], editable);
    }).join('') + '</div>';
    h += '</div>';
    rbodyEl.innerHTML = h;
    var root = rbodyEl.querySelector('.wsx__details');

    // inline edits — click to type, Enter to save, blur to autosave
    var enterSaves = function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } }); };
    var nameEl = root.querySelector('[data-edit="name"]');
    if (nameEl && editable) {
      nameEl.addEventListener('blur', function () {
        var v = nameEl.textContent.trim(); if (!v || v === name) return; var prevName = name; name = v;
        art.name = v; if (metaCache[art.id]) metaCache[art.id].name = v; if (panes[art.key]) panes[art.key].art.name = v; setTabLabel(art.key, v);
        patchArtifact(art.id, { name: v }, function (j) {
          if (j) return; // roll back an unsaved rename instead of showing false success
          name = prevName; art.name = prevName; if (metaCache[art.id]) metaCache[art.id].name = prevName; if (panes[art.key]) panes[art.key].art.name = prevName; setTabLabel(art.key, prevName); nameEl.textContent = prevName;
          try { wsxToast('Couldn\\u2019t save name', true); } catch (e) {}
        });
      });
      enterSaves(nameEl);
    }
    var descEl = root.querySelector('[data-edit="description"]');
    if (descEl && editable) {
      descEl.addEventListener('blur', function () {
        var v = descEl.textContent.trim(); if (v === desc) return; var prevDesc = desc; desc = v; if (metaCache[art.id]) metaCache[art.id].description = v;
        patchArtifact(art.id, { description: v }, function (j) {
          if (j) return;
          desc = prevDesc; if (metaCache[art.id]) metaCache[art.id].description = prevDesc; descEl.textContent = prevDesc;
          try { wsxToast('Couldn\\u2019t save description', true); } catch (e) {}
        });
      });
      enterSaves(descEl);
    }

    // icon actions
    root.querySelectorAll('[data-iact]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-iact');
        if (act === 'open') { window.open(openUrl, '_blank', 'noopener'); }
        else if (act === 'edit') { window.open(openUrl + 'edit', '_blank', 'noopener'); }
        else if (act === 'copy') { copyText(fullUrl, b); }
        else if (act === 'fav') { toggleFav(art.id, b); var ft = b.classList.contains('is-on') ? t('inspector.favRemove') : t('inspector.favAdd'); b.setAttribute('data-tip', ft); b.setAttribute('aria-label', ft); }
        else if (act === 'trash') { trashArtifact(art); }
      });
    });

    // visibility — single-select segmented control; optimistic PATCH + rollback + moderation override.
    var seg = root.querySelector('#wsxVisSeg');
    if (seg) {
      var subEl = root.querySelector('#wsxVisSub');
      var applyVis = function (v) {
        seg.querySelectorAll('[data-vis]').forEach(function (b) { var o = b.getAttribute('data-vis'), on = o === v; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.className = on ? 'is-sel vk-' + o : ''; });
        if (subEl) subEl.textContent = visSub(v);
        var etEl = root.querySelector('#wsxShareEmptyT');
        if (etEl) etEl.textContent = shareEmptyTitle(v);
        if (metaCache[art.id]) metaCache[art.id].visibility = v;
      };
      seg.querySelectorAll('[data-vis]').forEach(function (b) {
        b.addEventListener('click', function () {
          var next = b.getAttribute('data-vis'), prev = visCur;
          seg.querySelectorAll('[data-vis]').forEach(function (x) { if (x.classList.contains('is-sel')) prev = x.getAttribute('data-vis'); });
          if (next === prev) return;
          applyVis(next); // optimistic
          patchArtifact(art.id, { visibility: next }, function (j) {
            if (!j) { applyVis(prev); try { wsxToast('Couldn\\u2019t change visibility', true); } catch (e) {} return; } // failed — roll back
            var applied = j.visibility || next;
            if (j.message) { try { wsxToast(j.message, true); } catch (e) {} }
            if (applied !== next) applyVis(applied); // server overrode (moderation)
          });
        });
      });
    }

    // deliver — pick destination; if the channel isn't connected, offer a Connect button,
    // otherwise recipient + Send now (direct API) / Schedule (POST /v1/jobs). No agent turn.
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
        + '<div class="wsx-det__delact"><button class="wsx-abtn wsx-abtn--primary wsx-det__send" data-dsend="now" type="button">' + esc(t('inspector.sendNow')) + '</button>'
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
          fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/deliver', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: dest.toLowerCase(), config: deliverConfig() }) })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) { b.disabled = false; b.textContent = label; if (j && j.success) wsxToast(t('inspector.deliverSent').replace('{dest}', dest)); else wsxToast((j && j.error) || t('inspector.deliverFailed'), true); })
            .catch(function () { b.disabled = false; b.textContent = label; wsxToast(t('inspector.deliverFailed'), true); });
        });
      });
      delBody.querySelectorAll('[data-freq]').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = b.getAttribute('data-freq');
          fetch('/v1/jobs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifact_id: art.id, action: dest.toLowerCase(), config: deliverConfig(), schedule: CRON[f] }) })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) { if (freqRow) freqRow.hidden = true; if (j && (j.id || j.job || j.success)) wsxToast(t('inspector.scheduled').replace('{freq}', t('inspector.freq' + f)).replace('{dest}', dest)); else wsxToast((j && j.error) || t('inspector.deliverFailed'), true); })
            .catch(function () { wsxToast(t('inspector.deliverFailed'), true); });
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
    if (editable && art.id) loadStatus(); // prefetch connection status

    if (editable) wireSecDnd(root); // drag-reorder sections; persisted per user

    renderShare(art, meta, editable);
    if (editable) { renderTags(art, (meta.tags || []).slice()); renderFolder(art, meta); renderTests(art); renderWatches(art); }
    if (art.id) loadAnalytics(art.id, root.querySelector('#wsxDetStats'));
  }
  // Share-with: role-aware collaborators + always-visible workspace-member search (multi-add).
  var memberCache = {};
  var PEOPLE_SVG = '<svg class="wsx-share__emptyic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  function renderShare(art, meta, editable) {
    var box = rbodyEl.querySelector('#wsxShare'); if (!box) return;
    var wsId = (meta && meta.workspace_id) || '';
    var list = [];          // [{email, role}]
    var role = 'viewer';    // role for the next add

    function loadMembers(cb) {
      if (memberCache[wsId] !== undefined) { cb(memberCache[wsId]); return; }
      if (!wsId) { memberCache[wsId] = []; cb([]); return; }
      fetch('/v1/workspaces/' + encodeURIComponent(wsId) + '/members', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { memberCache[wsId] = (d && d.members) || []; cb(memberCache[wsId]); })
        .catch(function () { memberCache[wsId] = []; cb([]); });
    }
    function addEmails(emails) {
      if (!emails.length) return;
      var last = emails[emails.length - 1];
      fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: emails, role: role }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) { wsxToast(t('inspector.inviteFailed'), true); return; }
          if (d.collaborators) list = d.collaborators;
          else emails.forEach(function (em) { if (!list.some(function (c) { return c.email === em; })) list.push({ email: em, role: role }); });
          metaCache[art.id] = undefined; paint();
          wsxToast(t('inspector.inviteSent').replace('{email}', last));
        })
        .catch(function () { wsxToast(t('inspector.inviteFailed'), true); });
    }
    function paint() {
      var count = list.length;
      var countTxt = count === 0 ? '' : (count === 1 ? t('inspector.onePerson') : t('inspector.peopleCount').replace('{n}', count));
      var head = editable
        ? '<div class="wsx-share__head"><span class="wsx-share__count">' + esc(countTxt) + '</span>'
          + '<div class="wsx-share__roletog"><button data-role="viewer" type="button" class="' + (role === 'viewer' ? 'is-on' : '') + '">' + esc(t('inspector.viewer')) + '</button><button data-role="editor" type="button" class="' + (role === 'editor' ? 'is-on' : '') + '">' + esc(t('inspector.editor')) + '</button></div></div>'
        : '';
      var curVis = (metaCache[art.id] && metaCache[art.id].visibility) || (meta && meta.visibility) || 'private';
      var emptyState = (!count && editable)
        ? '<div class="wsx-share__empty">' + PEOPLE_SVG + '<div><div class="wsx-share__emptyt" id="wsxShareEmptyT">' + esc(shareEmptyTitle(curVis)) + '</div><div class="wsx-share__emptys">' + esc(t('inspector.addTeammates')) + '</div></div></div>'
        : '';
      var input = editable
        ? '<input class="wsx-share__search" id="wsxShareSearch" placeholder="' + esc(t('inspector.shareAddPeople')) + '" autocomplete="off"><div class="wsx-share__drop" id="wsxShareDrop"></div>'
        : '';
      var chips = list.map(function (c) {
        var ini = (c.email[0] || '?').toUpperCase();
        return '<span class="wsx-det__who"><span class="av">' + esc(ini) + '</span>' + esc(c.email) + ' <span class="role">' + esc(c.role || t('inspector.viewer')) + '</span>' + (editable ? '<button data-rm="' + esc(c.email) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button>' : '') + '</span>';
      }).join('');
      if (!count && !editable) chips = '<span class="wsx-share__note">' + esc(t('inspector.privateToYou')) + '</span>';
      var chipWrap = chips ? '<div class="wsx-share__chips">' + chips + '</div>' : '';
      box.innerHTML = head + emptyState + input + chipWrap;
      box.querySelectorAll('[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          var em = b.getAttribute('data-rm');
          fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators/' + encodeURIComponent(em), { method: 'DELETE', credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw new Error('failed'); list = list.filter(function (c) { return c.email !== em; }); metaCache[art.id] = undefined; paint(); })
            .catch(function () { try { wsxToast('Couldn\\u2019t remove collaborator', true); } catch (e) {} });
        });
      });
      box.querySelectorAll('[data-role]').forEach(function (b) {
        b.addEventListener('click', function () { role = b.getAttribute('data-role'); box.querySelectorAll('[data-role]').forEach(function (x) { x.classList.toggle('is-on', x === b); }); });
      });
      if (editable) wireSearch();
    }
    function wireSearch() {
      var search = box.querySelector('#wsxShareSearch'), drop = box.querySelector('#wsxShareDrop'); if (!search) return;
      function renderDrop(q) {
        loadMembers(function (members) {
          var taken = {}; list.forEach(function (c) { taken[c.email] = 1; });
          var ql = (q || '').toLowerCase();
          var matches = members.filter(function (m) {
            if (taken[m.email]) return false;
            if (!ql) return true;
            return (m.email || '').toLowerCase().indexOf(ql) >= 0 || (m.name || '').toLowerCase().indexOf(ql) >= 0;
          }).slice(0, 8);
          var h = matches.map(function (m) {
            return '<button class="wsx-share__opt" data-add="' + esc(m.email) + '" type="button"><span class="wsx-cm__av">' + esc((m.name || m.email)[0].toUpperCase()) + '</span>' + esc(m.name || m.email) + '<small>' + esc(m.email) + '</small></button>';
          }).join('');
          var raw = (q || '').trim();
          if (raw && raw.indexOf('@') > 0 && !taken[raw] && !matches.some(function (m) { return m.email === raw; })) {
            h += '<button class="wsx-share__opt" data-add="' + esc(raw) + '" type="button"><span class="wsx-cm__av">+</span>' + esc(t('inspector.invite')) + ' ' + esc(raw) + '<kbd class="wsx-share__kbd">' + esc(t('inspector.enterHint')) + '</kbd></button>';
          }
          drop.innerHTML = h;
          drop.querySelectorAll('[data-add]').forEach(function (b) {
            b.addEventListener('click', function () { addEmails([b.getAttribute('data-add')]); search.value = ''; renderDrop(''); search.focus(); });
          });
        });
      }
      search.addEventListener('input', function () { renderDrop(search.value); });
      search.addEventListener('focus', function () { renderDrop(search.value); });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var v = search.value.trim(); if (v.indexOf('@') > 0) { addEmails([v]); search.value = ''; renderDrop(''); } }
      });
    }

    box.innerHTML = i18nLoad();
    fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { list = (d && d.collaborators) || []; paint(); })
      .catch(function () { paint(); });
  }

  // ----- Tags (artifact_tags via /v1/artifacts/:id/tags) -----
  function renderTags(art, tags) {
    var box = rbodyEl.querySelector('#wsxTags'); if (!box) return;
    function sync() { if (metaCache[art.id]) metaCache[art.id].tags = tags.slice(); }
    function paint() {
      var h = tags.map(function (tg) {
        return '<span class="wsx-det__who"><span class="av">#</span>' + esc(tg) + '<button data-rmtag="' + esc(tg) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button></span>';
      }).join('');
      h += '<button class="wsx-det__add" id="wsxTagAdd" title="' + esc(t('inspector.addTag')) + '" type="button">+</button>';
      box.innerHTML = h;
      box.querySelectorAll('[data-rmtag]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = b.getAttribute('data-rmtag'), idx = tags.indexOf(t);
          tags = tags.filter(function (x) { return x !== t; }); sync(); paint(); // optimistic
          fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/tags/' + encodeURIComponent(t), { method: 'DELETE', credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw 0; })
            .catch(function () { if (tags.indexOf(t) < 0) tags.splice(idx < 0 ? tags.length : idx, 0, t); sync(); paint(); try { wsxToast('Couldn\\u2019t remove tag', true); } catch (e) {} }); // roll back
        });
      });
      var add = box.querySelector('#wsxTagAdd');
      add.addEventListener('click', function () {
        var inp = document.createElement('input'); inp.className = 'wsx-det__addin'; inp.placeholder = t('inspector.tagPlaceholder');
        add.replaceWith(inp); inp.focus();
        function commit() {
          var t = inp.value.trim().replace(/^#/, ''); if (!t) { paint(); return; }
          var added = tags.indexOf(t) < 0; if (added) tags.push(t); sync(); paint(); // optimistic
          fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/tags', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: t }) })
            .then(function (r) { if (!r.ok) throw 0; })
            .catch(function () { if (added) tags = tags.filter(function (x) { return x !== t; }); sync(); paint(); try { wsxToast('Couldn\\u2019t add tag', true); } catch (e) {} }); // roll back
        }
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        inp.addEventListener('blur', commit);
      });
    }
    paint();
  }

  // ----- Folder (breadcrumb trigger + nested tree popover; move via personal or workspace API) -----
  var folderCache = null;
  var FOLDER_SVG = isvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
  var CHECK_SVG = isvg('<path d="M20 6 9 17l-5-5"/>');
  var CHEVD_SVG = isvg('<path d="M6 9l6 6 6-6"/>');
  function foldersUrl(wsId) { return wsId ? '/v1/workspaces/' + encodeURIComponent(wsId) + '/folders?all=1' : '/v1/folders'; }
  function folderPath(folders, id) {
    var byId = {}; folders.forEach(function (f) { byId[f.id] = f; });
    var parts = [], cur = byId[id], guard = 0;
    while (cur && guard++ < 20) { parts.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null; }
    return parts;
  }
  function folderTree(folders) {
    var byParent = {}; folders.forEach(function (f) { var p = f.parent_id || ''; (byParent[p] = byParent[p] || []).push(f); });
    var rows = [];
    (function walk(pid, depth) {
      (byParent[pid] || []).forEach(function (f) { rows.push({ f: f, depth: depth }); walk(f.id, depth + 1); });
    })('', 0);
    return rows;
  }
  function renderFolder(art, meta) {
    var box = rbodyEl.querySelector('#wsxFolder'); if (!box) return;
    var wsId = meta.workspace_id || '';
    var open = false;
    function move(fid, folders) {
      var prev = meta.folder_id || '';
      meta.folder_id = fid; if (metaCache[art.id]) metaCache[art.id].folder_id = fid; // optimistic
      paint(folders);
      var url = wsId ? '/v1/workspaces/' + encodeURIComponent(wsId) + '/artifacts/' + encodeURIComponent(art.id) + '/move' : '/v1/artifacts/' + encodeURIComponent(art.id) + '/folder';
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: fid || null }) })
        .then(function (r) { if (!r.ok) throw 0; })
        .catch(function () { meta.folder_id = prev; if (metaCache[art.id]) metaCache[art.id].folder_id = prev; paint(folders); try { wsxToast('Couldn\\u2019t move page', true); } catch (e) {} }); // roll back
    }
    function paint(folders) {
      var cur = meta.folder_id || '';
      var path = cur ? folderPath(folders, cur) : [];
      var label = path.length
        ? path.map(function (p, i) { return '<span class="wsx-folder__seg' + (i === path.length - 1 ? ' is-leaf' : '') + '">' + esc(p) + '</span>'; }).join('<span class="wsx-folder__sep">/</span>')
        : '<span class="wsx-folder__none">' + esc(t('inspector.noFolder')) + '</span>';
      var rows = '<button class="wsx-folder__opt' + (!cur ? ' is-sel' : '') + '" data-fid="" type="button">' + FOLDER_SVG + '<span class="wsx-folder__optt">' + esc(t('inspector.noFolder')) + '</span>' + (!cur ? CHECK_SVG : '') + '</button>'
        + folderTree(folders).map(function (r) {
          return '<button class="wsx-folder__opt' + (r.f.id === cur ? ' is-sel' : '') + '" data-fid="' + esc(r.f.id) + '" data-depth="' + r.depth + '" type="button">' + FOLDER_SVG + '<span class="wsx-folder__optt">' + esc(r.f.name) + '</span>' + (r.f.id === cur ? CHECK_SVG : '') + '</button>';
        }).join('');
      box.innerHTML = '<div class="wsx-folder">'
        + '<button class="wsx-abtn wsx-folder__btn" id="wsxFolderBtn" type="button" aria-haspopup="listbox" aria-expanded="' + (open ? 'true' : 'false') + '">' + FOLDER_SVG + '<span class="wsx-folder__path">' + label + '</span>' + CHEVD_SVG + '</button>'
        + '<div class="wsx-folder__menu" role="listbox"' + (open ? '' : ' hidden') + '>' + rows + '</div></div>';
      var btn = box.querySelector('#wsxFolderBtn'), menu = box.querySelector('.wsx-folder__menu');
      btn.addEventListener('click', function (e) { e.stopPropagation(); open = !open; menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      menu.querySelectorAll('[data-fid]').forEach(function (o) { o.addEventListener('click', function () { open = false; move(o.getAttribute('data-fid'), folders); }); });
    }
    document.addEventListener('click', function () { if (!open) return; open = false; var m = box.querySelector('.wsx-folder__menu'); if (m) m.hidden = true; var b = box.querySelector('#wsxFolderBtn'); if (b) b.setAttribute('aria-expanded', 'false'); });
    if (folderCache) { paint(folderCache); return; }
    box.innerHTML = i18nLoad();
    fetch(foldersUrl(wsId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { folderCache = (d && (d.folders || d.items || d)) || []; if (!Array.isArray(folderCache)) folderCache = []; paint(folderCache); })
      .catch(function () { box.innerHTML = i18nEmpty('inspector.couldNotFolders'); });
  }

  // ----- Tests (artifact_tests via /v1/artifacts/:id/tests) -----
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
        .then(function (j) { if (j && j.run) paintTests(art, box, { config: cfg, latest: j.run }); else { b.disabled = false; b.textContent = t('inspector.runTestsNow'); try { wsxToast('Couldn\\u2019t start test run', true); } catch (e) {} } })
        .catch(function () { b.disabled = false; b.textContent = t('inspector.runTestsNow'); try { wsxToast('Couldn\\u2019t start test run', true); } catch (e) {} });
    });
  }

  // ----- Comments (full thread + composer; cached) -----
  function renderComments(art) {
    if (!art.id) { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.openPageToComment') + '</div>'; return; }
    if (cmtCache[art.id] !== undefined) { paintComments(art, cmtCache[art.id]); return; }
    rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
    fetch('/v1/home/comments?artifactId=' + encodeURIComponent(art.id) + '&limit=200', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { cmtCache[art.id] = (d && d.comments) || []; paintComments(art, cmtCache[art.id]); })
      .catch(function () { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.couldNotComments') + '</div>'; });
  }
  function cmAvatar(name) { return '<span class="wsx-cm__av">' + esc((name || '?').charAt(0).toUpperCase()) + '</span>'; }
  var ART_SVG = isvg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>');
  var SRC_SVG = isvg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>');
  // Mentions render as class-distinct chips: @user, artifacts/sources via the
  // self-describing [[a:slug|Label]] / [[s:id|Label]] tokens, and #tags.
  function cmBody(text) {
    return esc(text)
      .replace(/\\[\\[a:([^|\\]]+)\\|([^\\]]+)\\]\\]/g, function (_m, slug, label) { return '<a class="wsx-cm__ent is-artifact" href="/a/' + slug + '/" data-name="' + label + '" title="Open ' + label + '">' + ART_SVG + '<span>' + label + '</span></a>'; })
      .replace(/\\[\\[s:([^|\\]]+)\\|([^\\]]+)\\]\\]/g, function (_m, _id, label) { return '<span class="wsx-cm__ent is-source" title="Data source">' + SRC_SVG + '<span>' + label + '</span></span>'; })
      .replace(/@([A-Za-z0-9._-]+)/g, '<span class="wsx-cm__ent is-user">@$1</span>')
      .replace(/#([A-Za-z0-9_-]+)/g, '<span class="wsx-cm__ent is-tag">#$1</span>');
  }
  function pinSelector(c) {
    if (!c.position) return '';
    try { var p = typeof c.position === 'string' ? JSON.parse(c.position) : c.position; return (p && p.selector) || ''; } catch (e) { return ''; }
  }
  function cmNode(c, byParent) {
    var who = c.author_name || (c.author_type === 'agent' ? t('inspector.agent') : t('inspector.someone'));
    var agent = c.author_type === 'agent' ? '<span class="wsx-cm__agent">AI</span>' : '';
    var done = c.resolved ? '<div class="wsx-cm__done">' + esc(t('inspector.resolved')) + '</div>' : '';
    var ts = c.created_at ? (Date.parse(c.created_at) || Date.now()) : Date.now();
    var sel = pinSelector(c);
    var pin = (sel || c.position) ? '<button class="wsx-cm__pin" data-pin="' + esc(sel) + '" type="button" title="' + esc(t('inspector.pinnedTo')) + '">' + isvg('<path d="M9 4v6l-2 4h10l-2-4V4"/><path d="M12 14v6"/><path d="M8 4h8"/>') + (sel ? '<span>' + esc(sel) + '</span>' : '<span>' + esc(t('inspector.pinned')) + '</span>') + '</button>' : '';
    var kids = (byParent[c.id] || []).map(function (k) { return cmNode(k, byParent); }).join('');
    return '<div class="wsx-cm__row">'
      + '<div class="wsx-cm__top">' + cmAvatar(who) + '<span class="wsx-cm__who">' + esc(who) + '</span>' + agent + '<span class="wsx-cm__ago">' + timeAgo(ts) + '</span></div>'
      + pin
      + '<div class="wsx-cm__body">' + cmBody(c.content) + '</div>' + done
      + '<button class="wsx-cm__reply" data-reply="' + esc(c.id) + '" type="button">' + esc(t('inspector.reply')) + '</button>'
      + (kids ? '<div class="wsx-cm__kids">' + kids + '</div>' : '')
      + '</div>';
  }
  // Mention sources: people (members ∪ collaborators), other artifacts, data-source
  // connections, and the artifact's tags. Cached per artifact, fetched in parallel.
  var cmDataCache = {};
  function getCmData(art, cb) {
    if (cmDataCache[art.id]) { cb(cmDataCache[art.id]); return; }
    var wsId = metaCache[art.id] && metaCache[art.id].workspace_id;
    var jget = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    var calls = [
      jget('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators'),
      jget('/v1/artifacts?limit=50' + (wsId ? '&workspace_id=' + encodeURIComponent(wsId) : '')),
      wsId ? jget('/v1/workspaces/' + encodeURIComponent(wsId) + '/members') : Promise.resolve(null),
      wsId ? jget('/v1/workspaces/' + encodeURIComponent(wsId) + '/connections') : Promise.resolve(null)
    ];
    Promise.all(calls).then(function (res) {
      var seen = {}, people = [];
      ((res[0] && res[0].collaborators) || []).forEach(function (c) { if (c.email && !seen[c.email]) { seen[c.email] = 1; people.push({ email: c.email, name: c.email }); } });
      if (res[2] && res[2].members) res[2].members.forEach(function (m) { if (m.email && !seen[m.email]) { seen[m.email] = 1; people.push({ email: m.email, name: m.name || m.email }); } });
      var artifacts = ((res[1] && res[1].artifacts) || []).filter(function (a) { return a.id !== art.id && a.slug; }).map(function (a) { return { slug: a.slug, name: a.name || a.slug }; });
      var sources = ((res[3] && res[3].connections) || []).map(function (c) { return { id: c.id, name: c.name || c.provider, provider: c.provider }; });
      var tags = (metaCache[art.id] && metaCache[art.id].tags) || [];
      cmDataCache[art.id] = { people: people, artifacts: artifacts, sources: sources, tags: tags };
      cb(cmDataCache[art.id]);
    });
  }
  // One premium composer markup, reused for the top-level box and inline replies.
  function composerHTML(reply) {
    return '<div class="wsx-cc' + (reply ? ' wsx-cc--reply' : '') + '">'
      + '<div class="wsx-cm__mentions" hidden></div>'
      + '<div class="wsx-cc__emoji" hidden>' + EMOJI_SET.map(function (e) { return '<button class="wsx-cc__emojibtn" type="button" data-emoji="' + e + '">' + e + '</button>'; }).join('') + '</div>'
      + '<div class="wsx-cc__field">'
      +   '<textarea class="wsx-cc__ta" rows="1" placeholder="' + esc(reply ? t('inspector.replyPlaceholder') : t('inspector.writeComment')) + '"></textarea>'
      +   '<div class="wsx-cc__bar">'
      +     '<button class="wsx-cc__tool js-at" type="button" title="' + esc(t('inspector.mentionTitle')) + '" aria-label="' + esc(t('inspector.mention')) + '">@</button>'
      +     '<button class="wsx-cc__tool js-hash" type="button" title="' + esc(t('inspector.tagTool')) + '" aria-label="' + esc(t('inspector.tagTool')) + '">#</button>'
      +     '<button class="wsx-cc__tool js-emojibtn" type="button" title="' + esc(t('inspector.emoji')) + '" aria-label="' + esc(t('inspector.addEmoji')) + '">' + isvg(SVG_EMOJI) + '</button>'
      +     '<span class="wsx-cc__grow"></span>'
      +     '<button class="wsx-cc__send js-send" type="button" title="' + esc(t('inspector.send')) + '" aria-label="' + esc(t('inspector.send')) + '" disabled>' + isvg(SVG_SEND) + '</button>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }
  function insertAtCursor(ta, str) { var s = ta.selectionStart || 0, e = ta.selectionEnd || s; ta.value = ta.value.slice(0, s) + str + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + str.length; }
  function insertTrigger(ta, ch) { var s = ta.selectionStart || 0, pre = ta.value.slice(0, s); insertAtCursor(ta, (pre && !/\\s$/.test(pre) ? ' ' : '') + ch); ta.dispatchEvent(new Event('input')); }
  function wireComposer(art, cc, opts) {
    var ta = cc.querySelector('.wsx-cc__ta');
    var send = cc.querySelector('.js-send');
    var emoji = cc.querySelector('.wsx-cc__emoji');
    var menu = cc.querySelector('.wsx-cm__mentions');
    function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }
    function refreshSend() { send.disabled = !ta.value.trim(); }
    ta.addEventListener('input', function () { autosize(); refreshSend(); });
    cc.querySelector('.js-emojibtn').addEventListener('click', function (e) { e.stopPropagation(); emoji.hidden = !emoji.hidden; });
    emoji.addEventListener('click', function (e) { var b = e.target.closest('[data-emoji]'); if (!b) return; insertAtCursor(ta, b.getAttribute('data-emoji')); emoji.hidden = true; autosize(); refreshSend(); });
    cc.querySelector('.js-at').addEventListener('click', function () { insertTrigger(ta, '@'); });
    cc.querySelector('.js-hash').addEventListener('click', function () { insertTrigger(ta, '#'); });
    document.addEventListener('click', function () { if (!emoji.hidden) emoji.hidden = true; });
    function submit() { postComment(art, ta.value, opts.parentId || null, send, ta); }
    send.addEventListener('click', submit);
    wireMentions(art, ta, menu, submit);
    if (opts.focus) ta.focus();
    return ta;
  }
  // Autocomplete for @ (people + artifacts + sources) and # (tags), with class-typed rows.
  function wireMentions(art, ta, menu, onSubmit) {
    var data = { people: [], artifacts: [], sources: [], tags: [] };
    var matches = [], active = 0, trigger = '';
    getCmData(art, function (d) { data = d; });
    function close() { menu.hidden = true; matches = []; }
    function rowHTML(it, i) {
      var ic, sub = '';
      if (it.kind === 'user') { ic = '<span class="wsx-cm__av">' + esc((it.label || it.email || '?').charAt(0).toUpperCase()) + '</span>'; sub = esc(it.email || ''); }
      else if (it.kind === 'artifact') { ic = '<span class="wsx-cm__mic is-artifact">' + ART_SVG + '</span>'; sub = t('inspector.page'); }
      else if (it.kind === 'source') { ic = '<span class="wsx-cm__mic is-source">' + SRC_SVG + '</span>'; sub = esc(it.provider || t('inspector.dataSource')); }
      else { ic = '<span class="wsx-cm__mic is-tag">#</span>'; sub = t('inspector.tagTool'); }
      return '<div class="wsx-cm__mention' + (i === active ? ' is-active' : '') + '" data-mi="' + i + '">' + ic + '<span class="wsx-cm__mtxt">' + esc(it.label) + '</span><small>' + sub + '</small></div>';
    }
    function render() {
      if (!matches.length) { close(); return; }
      menu.hidden = false;
      menu.innerHTML = matches.map(rowHTML).join('');
      menu.querySelectorAll('[data-mi]').forEach(function (el) { el.addEventListener('mousedown', function (e) { e.preventDefault(); pick(parseInt(el.getAttribute('data-mi'), 10)); }); });
    }
    function tokenize(label) { return (label || '').replace(/[\\[\\]|@#]/g, '').replace(/\\s+/g, '-'); }
    function pick(i) {
      var it = matches[i]; if (!it) return;
      if (trigger === '#') {
        var tag = tokenize(it.label);
        ta.value = ta.value.replace(/#(\\S*)$/, '#' + tag + ' ');
      } else {
        var token = tokenize(it.label) || (it.email || 'x');
        ta._refs = ta._refs || {};
        if (it.kind === 'user') ta._refs[token.toLowerCase()] = { type: 'u', email: it.email };
        else if (it.kind === 'artifact') ta._refs[token.toLowerCase()] = { type: 'a', slug: it.slug, label: it.label };
        else if (it.kind === 'source') ta._refs[token.toLowerCase()] = { type: 's', id: it.id, label: it.label };
        ta.value = ta.value.replace(/@(\\S*)$/, '@' + token + ' ');
      }
      close(); ta.focus(); ta.dispatchEvent(new Event('input'));
    }
    function matchFor(q) {
      var ql = q.toLowerCase(), out = [];
      function hit(s) { return (s || '').toLowerCase().indexOf(ql) >= 0; }
      data.people.forEach(function (p) { if (hit(p.name) || hit(p.email)) out.push({ kind: 'user', label: p.name || p.email, email: p.email }); });
      data.artifacts.forEach(function (a) { if (hit(a.name) || hit(a.slug)) out.push({ kind: 'artifact', label: a.name, slug: a.slug }); });
      data.sources.forEach(function (s) { if (hit(s.name) || hit(s.provider)) out.push({ kind: 'source', label: s.name, id: s.id, provider: s.provider }); });
      return out.slice(0, 8);
    }
    ta.addEventListener('input', function () {
      var before = ta.value.slice(0, ta.selectionStart);
      var m = before.match(/([@#])(\\S*)$/);
      if (!m) { close(); return; }
      trigger = m[1];
      if (trigger === '#') matches = data.tags.filter(function (t) { return t.toLowerCase().indexOf(m[2].toLowerCase()) >= 0; }).map(function (t) { return { kind: 'tag', label: t }; }).slice(0, 8);
      else matches = matchFor(m[2]);
      active = 0; render();
    });
    ta.addEventListener('keydown', function (e) {
      if (!menu.hidden && matches.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; render(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; render(); return; }
        if (e.key === 'Enter') { e.preventDefault(); pick(active); return; }
        if (e.key === 'Escape') { close(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
    });
  }
  function paintComments(art, comments) {
    var byParent = {};
    comments.forEach(function (c) { if (c.parent_id) { (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c); } });
    var roots = comments.filter(function (c) { return !c.parent_id; });
    var listH = roots.length ? roots.map(function (c) { return cmNode(c, byParent); }).join('') : '<div class="wsx-cm__empty">' + esc(t('inspector.noComments')) + '</div>';
    rbodyEl.innerHTML = '<div class="wsx-cm"><div class="wsx-cm__list" id="wsxCmList">' + listH + '</div>' + composerHTML(false) + '</div>';
    var listEl = document.getElementById('wsxCmList'); if (listEl) listEl.scrollTop = listEl.scrollHeight;
    getCmData(art, function () {}); // warm mention cache
    var mainCc = rbodyEl.querySelector('.wsx-cm > .wsx-cc');
    if (mainCc) wireComposer(art, mainCc, { parentId: null });
    rbodyEl.querySelectorAll('[data-pin]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sel = b.getAttribute('data-pin'); if (!sel || !activeArt || !activeArt.iframe) return;
        try { activeArt.iframe.contentWindow.postMessage({ source: 'shareout-inspector', type: 'scrollToSelector', selector: sel }, '*'); } catch (e) {}
      });
    });
    rbodyEl.querySelectorAll('[data-reply]').forEach(function (b) {
      b.addEventListener('click', function () {
        var nxt = b.nextSibling;
        if (nxt && nxt.classList && nxt.classList.contains('wsx-cc')) { nxt.remove(); return; }
        var wrap = document.createElement('div'); wrap.innerHTML = composerHTML(true);
        var cc = wrap.firstChild; b.parentNode.insertBefore(cc, b.nextSibling);
        wireComposer(art, cc, { parentId: b.getAttribute('data-reply'), focus: true });
      });
    });
  }
  // Canonicalize @tokens → self-describing entity refs (artifacts/sources) and
  // collect person emails for notifications; tags stay as #plain text.
  function postComment(art, content, parentId, btn, ta) {
    var raw = (content || '').trim(); if (!raw) return;
    var refs = (ta && ta._refs) || {}, mentions = [];
    var text = raw.replace(/@([A-Za-z0-9._-]+)/g, function (m, tok) {
      var r = refs[tok.toLowerCase()]; if (!r) return m;
      if (r.type === 'u') { if (r.email && mentions.indexOf(r.email) < 0) mentions.push(r.email); return m; }
      if (r.type === 'a') return '[[a:' + r.slug + '|' + r.label + ']]';
      if (r.type === 's') return '[[s:' + r.id + '|' + r.label + ']]';
      return m;
    });
    btn.disabled = true;
    fetch('/v1/home/comments', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: art.id, content: text, parentId: parentId || undefined, mentions: mentions.length ? mentions : undefined }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        btn.disabled = false;
        if (!j || !j.comment) { ta.value = ''; ta.placeholder = t('inspector.couldNotPost'); return; }
        (cmtCache[art.id] = cmtCache[art.id] || []).push(j.comment);
        paintComments(art, cmtCache[art.id]);
      })
      .catch(function () { btn.disabled = false; });
  }

  // ----- Automate (per-artifact schedules + alerts) -----
  function autoJobRow(j) {
    var st = j.last_status || ''; var cls = st === 'success' ? ' ok' : st === 'failed' ? ' fail' : '';
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(j.title || j.action || 'Job') + '</div><div class="wsx-row__sub">' + esc(j.schedule || '') + (j.action ? ' \\u00B7 ' + esc(j.action) : '') + '</div></div>' + (st ? '<span class="wsx-row__badge' + cls + '">' + esc(st) + '</span>' : '') + '</div>';
  }
  function autoAlertRow(a) {
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(a.name || a.metric_id || 'Alert') + '</div><div class="wsx-row__sub">' + esc(a.schedule || '') + '</div></div>' + (a.enabled ? '<span class="wsx-row__badge ok">on</span>' : '<span class="wsx-row__badge">off</span>') + '</div>';
  }
  function renderAutomate(art) {
    if (autoCache[art.id] !== undefined) { paintAutomate(art, autoCache[art.id]); return; }
    rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
    Promise.all([
      fetch('/v1/jobs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/v1/metric-alerts', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
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
        var n = art.name || 'this page'; var k = b.getAttribute('data-aauto');
        if (k === 'schedule') agentAsk('Schedule a weekly send of "' + n + '" \\u2014 ');
        else if (k === 'alert') agentAsk('Set an alert on "' + n + '" when ');
        else if (k === 'crew') agentAsk('Set up a crew for "' + n + '" that ');
        else agentAsk('For "' + n + '": ');
      });
    });
  }
  var HOUSE_SVG = isvg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/>');
  function renderTabs() {
    tabsEl.innerHTML = tabs.map(function (tab) {
      var dirty = !tab.home && panes[tab.key] && panes[tab.key].dirty;
      return '<div class="wsx-tab' + (tab.key === activeKey ? ' is-active' : '') + (tab.home ? ' wsx-tab--home' : '') + '" data-tab="' + esc(tab.key) + '"' + (tab.home ? '' : ' draggable="true"') + '>'
        + (dirty ? '<span class="wsx-tab__dot" title="' + esc(t('inspector.unsavedDot')) + '"></span>' : '')
        + (tab.home ? '<span class="wsx-tab__ic">' + HOUSE_SVG + '</span>' : '')
        + '<span class="wsx-tab__label">' + esc(tab.label) + '</span>'
        + (tab.home ? '' : '<button class="wsx-tab__x" data-close="' + esc(tab.key) + '" aria-label="' + esc(t('inspector.closeTab')) + '">\\u00D7</button>')
        + '</div>';
    }).join('');
    tabsEl.querySelectorAll('[data-tab]').forEach(function (el) {
      el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) return; activateTab(el.getAttribute('data-tab')); });
    });
    tabsEl.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); closeTab(b.getAttribute('data-close')); });
    });
    wireTabDrag();
  }
  // Drag-to-reorder open artifact tabs. Home tab (index 0) is pinned and never a drop target.
  // The dragged tab is NOT moved mid-drag; a vertical bar marks the drop slot and the
  // reorder happens once on drop (preventDefault suppresses the browser's snap-back animation).
  var dragKey = null, dropBar = null, dropIdx = -1;
  function keyIndex(key) { for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) return i; return -1; }
  function clearDropBar() { if (dropBar) { dropBar.remove(); dropBar = null; } dropIdx = -1; }
  // Place the indicator at the left edge of slot idx (or the right edge of the last tab).
  function paintDropBar(idx) {
    if (!dropBar) { dropBar = document.createElement('div'); dropBar.className = 'wsx-tab-drop'; tabsEl.appendChild(dropBar); }
    var els = tabsEl.querySelectorAll('[data-tab]');
    var cont = tabsEl.getBoundingClientRect(), x;
    if (idx < els.length) x = els[idx].getBoundingClientRect().left - cont.left + tabsEl.scrollLeft;
    else { var last = els[els.length - 1].getBoundingClientRect(); x = last.right - cont.left + tabsEl.scrollLeft; }
    dropBar.style.transform = 'translateX(' + (x - 1) + 'px)';
  }
  function wireTabDrag() {
    tabsEl.querySelectorAll('[data-tab][draggable="true"]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        dragKey = el.getAttribute('data-tab');
        el.classList.add('is-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey); } catch (err) {}
      });
      el.addEventListener('dragend', function () { el.classList.remove('is-dragging'); dragKey = null; clearDropBar(); });
    });
  }
  // Container-level listeners — bound once; survive renderTabs() innerHTML rebuilds.
  tabsEl.addEventListener('dragover', function (e) {
    if (dragKey == null) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    var els = tabsEl.querySelectorAll('[data-tab]'), idx = els.length;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { idx = i; break; }
    }
    if (idx < 1) idx = 1; // never before the pinned Home tab
    dropIdx = idx; paintDropBar(idx);
  });
  tabsEl.addEventListener('drop', function (e) {
    if (dragKey == null) return;
    e.preventDefault();
    var from = keyIndex(dragKey), to = dropIdx;
    if (from > 0 && to >= 1) {
      var item = tabs.splice(from, 1)[0];
      if (to > from) to--;
      if (to < 1) to = 1;
      tabs.splice(to, 0, item);
      saveTabs(); renderTabs();
    }
    clearDropBar();
  });
  function activateTab(key) {
    activeKey = key;
    homePane.classList.toggle('is-active', key === 'home');
    Object.keys(panes).forEach(function (k) { panes[k].pane.classList.toggle('is-active', k === key); });
    activeArt = key === 'home' ? null : { key: key, id: panes[key].art.id, slug: panes[key].art.slug, name: panes[key].art.name, iframe: panes[key].iframe };
    paintRail();
    renderTabs();
    syncTabMode();
    if (typeof syncHash === 'function') syncHash();
  }
  function closeTab(key) {
    var idx = -1; for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) idx = i;
    if (idx <= 0) return;
    if (panes[key] && panes[key].dirty && !window.confirm(t('inspector.closeTabConfirm'))) return;
    if (panes[key]) { panes[key].pane.remove(); delete panes[key]; }
    tabs.splice(idx, 1);
    saveTabs();
    if (activeKey === key) activateTab(tabs[Math.max(0, idx - 1)].key);
    else renderTabs();
  }
  function makeTab(key, art) {
    var made = makeArtifactPane(art);
    panes[key] = made; panesEl.appendChild(made.pane); tabs.push({ key: key, label: art.name });
  }
  function openArtifact(slug, name, id) {
    var key = id || slug;
    if (!panes[key]) {
      makeTab(key, { key: key, id: id || '', slug: slug, name: name || t('inspector.artifact') });
      saveTabs();
      if (id) fetch('/v1/home/viewed', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: id }) }).catch(function () {});
    }
    rActive = 'details';
    activateTab(key);
  }
  // Persist open artifact tabs so they reopen next session.
  function saveTabs() {
    try {
      var open = tabs.filter(function (t) { return !t.home && panes[t.key]; }).map(function (t) { return { key: t.key, label: t.label, id: panes[t.key].art.id, slug: panes[t.key].art.slug }; });
      localStorage.setItem(LS.tabs, JSON.stringify(open));
    } catch (e) {}
  }
  function restoreTabs() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(LS.tabs) || '[]'); } catch (e) { saved = []; }
    if (!saved || !saved.length) return;
    saved.forEach(function (tab) {
      if (!tab || !tab.slug || panes[tab.key]) return;
      makeTab(tab.key, { key: tab.key, id: tab.id || '', slug: tab.slug, name: tab.label || t('inspector.artifact') });
    });
    renderTabs();
  }
  renderTabs();
  restoreTabs();
  paintRail();
  // Cmd/Ctrl shortcuts when focus is outside the edit iframe (Esc + edit-doc keys handled inside).
  document.addEventListener('keydown', function (e) {
    var rec = panes[activeKey]; if (!rec || rec.mode !== 'edit') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    editKeydown(rec, e);
  });
  window.addEventListener('beforeunload', function (e) {
    var dirty = Object.keys(panes).some(function (k) { return panes[k] && panes[k].dirty; });
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

`;
