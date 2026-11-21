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
  // Home "In your workspace": the aggregated pulse (publishes, runs, data updates, new
  // members), newest first. Waits for the feed so it never flashes its empty state.
  function renderActivity() {
    var host = document.getElementById('wsxPulse'); if (!host || !homeLoaded.feed) return;
    var groups = groupFeed(pulseEvents).slice(0, 6);
    host.innerHTML = groups.length
      ? groups.map(function (g) { return evRow(g, false); }).join('')
      : '<div class="wsx-empty wsx-empty--calm">' + esc(t('home.spaceEmpty')) + '</div>';
  }
  // Home "more" menu: customize, activity window, admin event visibility. Bound once.
  function wireActivityControls() {
    var btn = document.getElementById('wsxHomeMore'), menu = document.getElementById('wsxHomeMenu');
    if (!btn || !menu) return;
    function setOpen(o) { menu.hidden = !o; btn.setAttribute('aria-expanded', o ? 'true' : 'false'); }
    function syncWin() { menu.querySelectorAll('[data-win]').forEach(function (b) { var on = b.getAttribute('data-win') === WSX_WIN; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }); }
    syncWin();
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); if (menu.hidden) syncWin(); setOpen(menu.hidden); });
    document.addEventListener('click', function (ev) { if (!menu.hidden && !ev.target.closest('.wsx__more')) setOpen(false); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
    var custom = document.getElementById('wsxCustomize'), brief = document.getElementById('wsxBrief');
    if (custom && brief) custom.addEventListener('click', function () {
      var on = brief.classList.toggle('is-customizing');
      custom.textContent = t(on ? 'home.customizeDone' : 'home.customize'); setOpen(false);
    });
    menu.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-win]'); if (!b) return;
      WSX_WIN = b.getAttribute('data-win'); syncWin(); setOpen(false); loadFeed();
    });
    var gear = document.getElementById('wsxActGear');
    var panel = document.getElementById('wsxEvSettings');
    if (!gear || !panel) return;
    if (window.WSX_ADMIN && window.WSX_WS) gear.hidden = false;
    var AUD = [['self', t('inspector.audSelf')], ['members', t('inspector.audMembers')], ['admins', t('inspector.audAdmins')], ['off', t('inspector.audOff')]];
    gear.addEventListener('click', function () {
      setOpen(false);
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
            return '<div class="wsx__evrow"><span class="wsx__evtier">' + esc(tOr('evt.tier.' + k.tier, k.tier)) + '</span>'
              + '<span><b>' + esc(tOr('evt.' + k.kind, k.label)) + '</b><small>' + esc(tOr('evt.' + k.kind + '.hint', k.hint)) + '</small></span>'
              + '<select data-kind="' + esc(k.kind) + '" data-prev="' + esc(k.audience) + '"' + (d.canManage ? '' : ' disabled') + '>' + opts + '</select></div>';
          }).join('');
          var em = panel.querySelector('.wsx-empty'); if (em) em.outerHTML = rows;
          if (!d.canManage) return;
          panel.addEventListener('change', function (ev) {
            var sel = ev.target.closest('select[data-kind]'); if (!sel) return;
            var kind = sel.getAttribute('data-kind'), next = sel.value, prev = sel.getAttribute('data-prev') || '';
            // The select already shows the new audience; roll it back if the PUT fails.
            optimistic({
              apply: function () { sel.setAttribute('data-prev', next); },
              rollback: function () { sel.value = prev; sel.setAttribute('data-prev', prev); },
              request: function () {
                return fetch('/v1/home/event-visibility?workspace=' + encodeURIComponent(window.WSX_WS), {
                  method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ kind: kind, audience: next }),
                });
              },
              success: t('common.saved'),
              error: t('inspector.audienceFailed'),
              done: function () { loadFeed(); },
            });
          });
        })
        .catch(function () { panel.innerHTML = i18nEmpty('inspector.couldNotSettings'); });
    });
  }
`;
