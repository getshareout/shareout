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
  // One "Recent" list: artifacts I opened + activity pulse (incl. runs), newest first.
  var SOFT_KINDS = { viewed: 1, create: 1, view: 1, publish: 1 };
  function recentLabel(k) {
    if (k === 'viewed') return t('recent.t.viewed');
    if (k === 'run') return t('recent.t.run');
    if (k === 'create' || k === 'publish') return t('recent.t.new');
    if (k === 'comment' || k === 'reply') return t('recent.t.comment');
    return t('recent.t.update');
  }
  function recentRows() {
    var rows = [], seen = {};
    function ms(ts) { return ts < 1e12 ? ts * 1000 : ts; }
    recentItems.forEach(function (it) { rows.push({ kind: 'viewed', id: it.id, slug: it.slug, name: it.name, ts: it.ts ? Date.parse(it.ts) : 0, sum: '', count: 1 }); });
    pulseEvents.forEach(function (e) { rows.push({ kind: e.kind, id: e.artifact_id, slug: e.slug, name: e.artifact_name, ts: ms(e.ts), sum: e.summary, count: e.count || 1 }); });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    return rows.filter(function (r) {
      var k = (SOFT_KINDS[r.kind] ? 'soft|' : r.kind + '|') + (r.id || r.sum);
      if (seen[k]) return false; seen[k] = 1; return true;
    }).slice(0, 10);
  }
  function recentRow(r) {
    var title = r.name ? esc(r.name) : feedText(r.sum);
    var detail = (!SOFT_KINDS[r.kind] && r.name && r.sum) ? '<span class="wsx-rc__sum">' + feedText(r.sum) + (r.count > 1 ? ' \\u00B7 ' + r.count + '\\u00D7' : '') + '</span>' : '';
    var inner = '<span class="wsx-rc__main"><span class="wsx-rc__name">' + title + '</span>' + detail + '</span>'
      + '<span class="wsx-rc__tag">' + esc(recentLabel(r.kind)) + '</span><span class="wsx-rc__time">' + (r.ts ? timeAgo(r.ts) : '') + '</span>';
    return r.slug
      ? '<a class="wsx-rc" data-kind="' + esc(r.kind) + '" data-name="' + esc(r.name || '') + '" data-id="' + esc(r.id || '') + '" href="/a/' + encodeURIComponent(r.slug) + '/">' + inner + '</a>'
      : '<div class="wsx-rc" data-kind="' + esc(r.kind) + '">' + inner + '</div>';
  }
  function renderActivity() {
    var host = document.getElementById('wsxRecentW'); if (!host) return;
    var rows = recentRows();
    var wdg = host.closest('.wsx-widget'); if (wdg) wdg.classList.toggle('is-empty-hidden', !rows.length);
    host.innerHTML = rows.map(recentRow).join('');
    if (typeof syncHomeEmpty === 'function') syncHomeEmpty();
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
