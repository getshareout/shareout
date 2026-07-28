// Split out of inspector.ts (client-script size cap): the Activity-feed renderers.
// Concatenated into the same IIFE right before inspector.ts, so these hoisted
// function declarations share its scope (esc, timeAgo, t, i18nEmpty, loadFeed,
// needsEvents/pulseEvents, GEAR_SVG, WSX_WIN, window.WSX_*).
export const workspace_client_inspector_activity_JS = `
  // Feed summaries may contain canonical entity tokens from comments; show the label.
  function feedText(s) { return esc(String(s || '').replace(/\\[\\[[as]:[^|\\]]+\\|([^\\]]+)\\]\\]/g, '$1')); }
  function groupFeed(events) {
    var order = [], map = {};
    events.forEach(function (e) {
      var k = e.kind + '|' + (e.artifact_id || e.slug) + '|' + (e.actor || '');
      var g = map[k];
      if (g) { g.count++; g.ids.push(e.id); if (e.ts > g.ts) g.ts = e.ts; }
      else { map[k] = { e: e, count: 1, ts: e.ts, ids: [e.id] }; order.push(map[k]); }
    });
    order.sort(function (a, b) { return b.ts - a.ts; });
    return order;
  }
  function tlRow(g) {
    var e = g.e;
    var title = e.actor ? esc(e.actor) : esc(e.artifact_name);
    var detail;
    if (e.kind === 'view') detail = g.count > 1 ? 'viewed ' + g.count + ' times' : feedText(e.summary);
    else { detail = feedText(e.summary); if (e.actor) detail += ' \\u00B7 ' + esc(e.artifact_name); if (g.count > 1) detail += ' \\u00B7 ' + g.count + '\\u00D7'; }
    var dot = e.actor_picture ? '<img class="wsx-tl__av" src="' + esc(e.actor_picture) + '" alt="">' : '<span class="wsx-tl__dot k-' + esc(e.kind) + '"></span>';
    var x = '<button class="wsx-tl__x" data-eids="' + esc(g.ids.join(',')) + '" type="button" title="Dismiss" aria-label="Dismiss">\\u00D7</button>';
    return '<a class="wsx-tl" data-kind="' + esc(e.kind) + '" data-name="' + esc(e.artifact_name) + '" data-id="' + esc(e.artifact_id) + '" href="/a/' + encodeURIComponent(e.slug) + '/">'
      + '<span class="wsx-tl__rail">' + dot + '</span>'
      + '<span class="wsx-tl__main"><span class="wsx-tl__top">' + title + '</span><span class="wsx-tl__sum">' + detail + '</span></span>'
      + '<span class="wsx-tl__time">' + timeAgo(g.ts) + '</span>' + x + '</a>';
  }
  // Aggregated Pulse row: server already collapsed it to a count, so don't re-group.
  function pulseTlRow(e) {
    var title = e.artifact_name ? esc(e.artifact_name) : feedText(e.summary);
    var detail = e.artifact_name ? feedText(e.summary) : '';
    var dot = '<span class="wsx-tl__dot k-' + esc(e.kind) + '"></span>';
    var tail = e.count > 1 ? '<span class="wsx-ev__cnt">' + e.count + '</span>' : '<span class="wsx-tl__time">' + timeAgo(e.ts) + '</span>';
    var inner = '<span class="wsx-tl__rail">' + dot + '</span>'
      + '<span class="wsx-tl__main"><span class="wsx-tl__top">' + title + '</span><span class="wsx-tl__sum">' + detail + '</span></span>' + tail;
    return e.slug
      ? '<a class="wsx-tl wsx-ev--pulse" data-kind="' + esc(e.kind) + '" data-name="' + esc(e.artifact_name || '') + '" data-id="' + esc(e.artifact_id || '') + '" href="/a/' + encodeURIComponent(e.slug) + '/">' + inner + '</a>'
      : '<div class="wsx-tl wsx-ev--pulse" data-kind="' + esc(e.kind) + '">' + inner + '</div>';
  }
  function renderActivity() {
    var host0 = document.getElementById('wsxActBody'); if (!host0) return;
    var wdg = document.getElementById('wsxActWidget');
    if (wdg) wdg.classList.toggle('is-empty-hidden', !(needsEvents.length || pulseEvents.length));
    var gear = (window.WSX_ADMIN && window.WSX_WS) ? '<button class="wsx__actgear" id="wsxActGear" type="button" title="' + esc(t('inspector.activityVisibility')) + '">' + GEAR_SVG + '</button>' : '';
    host0.innerHTML = '<div class="wsx__actbar"><div class="wsx__winseg" id="wsxWin">'
      + '<button data-win="today" type="button"' + (WSX_WIN === 'today' ? ' class="is-on"' : '') + '>' + esc(t('inspector.today')) + '</button>'
      + '<button data-win="7d" type="button"' + (WSX_WIN === '7d' ? ' class="is-on"' : '') + '>' + esc(t('inspector.win7d')) + '</button>'
      + '<button data-win="30d" type="button"' + (WSX_WIN === '30d' ? ' class="is-on"' : '') + '>' + esc(t('inspector.win30d')) + '</button>'
      + '</div>' + gear + '</div>'
      + '<div class="wsx-tl-wrap" id="wsxActivity"></div>'
      + '<div class="wsx__evsettings" id="wsxEvSettings" hidden></div>';
    var host = document.getElementById('wsxActivity');
    var html = needsEvents.length ? groupFeed(needsEvents).map(tlRow).join('') : '';
    if (pulseEvents.length) html += '<div class="wsx__pulsehead">' + esc(t('inspector.pulse')) + '</div>' + pulseEvents.map(pulseTlRow).join('');
    host.innerHTML = html || i18nEmpty('inspector.quiet');
    wireActivityControls();
  }
  // Bind window segments + admin gear (re-run after each renderActivity innerHTML swap).
  function wireActivityControls() {
    var winEl = document.getElementById('wsxWin');
    if (winEl) winEl.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-win]'); if (!b) return;
      WSX_WIN = b.getAttribute('data-win'); loadFeed();
    });
    var gear = document.getElementById('wsxActGear');
    var panel = document.getElementById('wsxEvSettings');
    if (!gear || !panel) return;
    var AUD = [['self', t('inspector.audSelf')], ['members', t('inspector.audMembers')], ['admins', t('inspector.audAdmins')], ['off', t('inspector.audOff')]];
    gear.addEventListener('click', function () {
      if (!panel.hidden) { panel.hidden = true; return; }
      panel.hidden = false;
      panel.innerHTML = '<div class="wsx__evhead"><b>' + esc(t('inspector.whoSees')) + '</b><button class="wsx__evclose" id="wsxEvClose" type="button">\\u2715</button></div>' + i18nLoad();
      document.getElementById('wsxEvClose').addEventListener('click', function () { panel.hidden = true; });
      fetch('/v1/home/event-visibility?workspace=' + encodeURIComponent(window.WSX_WS), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var kinds = (d && d.kinds) || [];
          var rows = kinds.map(function (k) {
            var opts = AUD.map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === k.audience ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('');
            return '<div class="wsx__evrow"><span class="wsx__evtier">' + esc(k.tier) + '</span>'
              + '<span><b>' + esc(k.label) + '</b><small>' + esc(k.hint) + '</small></span>'
              + '<select data-kind="' + esc(k.kind) + '"' + (d.canManage ? '' : ' disabled') + '>' + opts + '</select></div>';
          }).join('');
          var em = panel.querySelector('.wsx-empty'); if (em) em.outerHTML = rows;
          if (!d.canManage) return;
          panel.addEventListener('change', function (ev) {
            var sel = ev.target.closest('select[data-kind]'); if (!sel) return;
            fetch('/v1/home/event-visibility?workspace=' + encodeURIComponent(window.WSX_WS), {
              method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: sel.getAttribute('data-kind'), audience: sel.value }),
            }).then(function () { loadFeed(); }).catch(function () {});
          });
        })
        .catch(function () { panel.innerHTML = i18nEmpty('inspector.couldNotSettings'); });
    });
  }
`;
