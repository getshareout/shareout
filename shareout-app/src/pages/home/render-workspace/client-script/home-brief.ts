/**
 * Home brief: greeting, the ask-or-make box, Your artifacts tabs, This week, What's new in
 * ShareOut and All your artifacts. Needs you and In your workspace are painted by
 * activity-feed.ts / inspector-activity.ts from the same feed response.
 * Shares the WORKSPACE_CLIENT IIFE scope (t, esc, locTag, ART_DATA, renderArtView, send, …).
 */
export const workspace_client_home_brief_JS = `  // ===== Home brief =====
  // Greeting by the local hour; the server rendered an English fallback.
  (function () {
    var el = document.getElementById('wsxHello'); if (!el) return;
    var h = new Date().getHours();
    var k = h < 12 ? 'home.hello.morning' : h < 20 ? 'home.hello.afternoon' : 'home.hello.evening';
    var nm = el.getAttribute('data-name') || '';
    el.textContent = nm ? t(k).replace('{name}', nm) : t(k).replace(/,?\\s*\\{name\\}/, '');
  })();
  // "Friday, November 21 · 2 things need you" under the greeting (n = fresh Needs you rows).
  function renderBriefLine(n) {
    var el = document.getElementById('wsxNarration'); if (!el) return;
    var d = new Date().toLocaleDateString(locTag(), { weekday: 'long', day: 'numeric', month: 'long' });
    d = d.charAt(0).toUpperCase() + d.slice(1);
    el.innerHTML = esc(d) + ' \\u00B7 ' + (n
      ? '<b>' + esc(t(n === 1 ? 'home.waitingOne' : 'home.waiting').replace('{n}', String(n))) + '</b>'
      : '<span class="muted">' + esc(t('home.allClear')) + '</span>');
  }

  // Ask or make: the box sends into the same chat as the composer; the chips are New's actions.
  (function () {
    var hero = document.getElementById('wsxHero'), inp = document.getElementById('wsxHeroAsk');
    if (!hero || !inp) return;
    hero.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = inp.value.trim();
      if (!v || sending) { if (v) setAsk(v); inp.value = ''; openComposer(); return; }
      inp.value = '';
      if (typeof exitCreate === 'function') exitCreate();
      send(v);
    });
    hero.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('[data-hero]'); if (!c) return;
      e.preventDefault();
      var act = c.getAttribute('data-hero');
      if (act === 'chat') openComposer(); else if (act === 'table') newTable(); else newUpload();
    });
  })();

  // Card header links: open a lens (See all, Analytics) or the notifications panel.
  ws.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-go-lens], [data-open-notifs]'); if (!g) return;
    e.preventDefault();
    if (g.hasAttribute('data-open-notifs')) { var nb = document.getElementById('wsxNotifBtn'); if (nb) nb.click(); return; }
    var k = g.getAttribute('data-go-lens'), b = ws.querySelector('.wsx-lens[data-lens="' + k + '"]');
    if (b) b.click(); else if (typeof openView === 'function') openView(k);
  });

  // ----- Your artifacts: Recent · For you · Favorites · Shared with me (small tiles or table) -----
  var ARTS_TAB = { recent: 'wsxRecentArts', foryou: 'wsxForYou', favorites: 'wsxFavArts', shared: 'wsxSharedArts' };
  var ARTS_LS = 'wsx_arts_tab:' + (window.WSX_WS || '');
  var artsPicked = false;
  try { artsPicked = !!ARTS_TAB[localStorage.getItem(ARTS_LS)]; } catch (e) {}
  function setArtsTab(k, byUser) {
    if (!ARTS_TAB[k]) return;
    document.querySelectorAll('[data-arts-tab]').forEach(function (b) {
      var on = b.getAttribute('data-arts-tab') === k;
      b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(ARTS_TAB).forEach(function (x) { var p = document.getElementById(ARTS_TAB[x]); if (p) p.hidden = x !== k; });
    if (byUser) { artsPicked = true; try { localStorage.setItem(ARTS_LS, k); } catch (e) {} }
    if ((k === 'favorites' || k === 'shared') && !ART_DATA[ARTS_TAB[k]]) loadArtsScope(k);
  }
  function loadArtsScope(k) {
    var id = ARTS_TAB[k], el = document.getElementById(id); if (!el) return;
    ART_DATA[id] = { miniHtml: '', rowsHtml: '', count: 0, empty: t('common.loading') };
    renderArtView(id);
    fetch('/v1/home/browser?scope=' + k + '&mini=1' + homeWsq, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        ART_DATA[id] = { miniHtml: (d && d.miniHtml) || '', rowsHtml: (d && d.rowsHtml) || '', count: (d && d.miniHtml) ? 1 : 0, empty: t(k === 'favorites' ? 'home.noFavorites' : 'home.noShared') };
        renderArtView(id);
      })
      .catch(function () { delete ART_DATA[id]; el.innerHTML = '<div class="wsx-empty">' + esc(t('common.actionFailed')) + '</div>'; });
  }
  document.querySelectorAll('[data-arts-tab]').forEach(function (b) {
    b.addEventListener('click', function () { setArtsTab(b.getAttribute('data-arts-tab'), true); });
  });
  // First visit: Recent, or For you when nothing was opened yet. Afterwards, the last tab picked.
  function briefArtsDefault(recentCount) {
    var saved = null; try { saved = localStorage.getItem(ARTS_LS); } catch (e) {}
    if (artsPicked && ARTS_TAB[saved]) setArtsTab(saved);
    else if (!recentCount) setArtsTab('foryou');
  }

  // ----- This week: views of what you made, by day, against last week -----
  function renderWeek(d) {
    var el = document.getElementById('wsxWeek'); if (!el) return;
    var tot = (d && d.totals) || { views: 0, uniques: 0, activeArtifacts: 0 }, prev = (d && d.prev) || { views: 0 };
    if (!tot.views && !prev.views) { el.innerHTML = '<div class="wsx-empty wsx-empty--calm">' + esc(t('home.weekEmpty')) + '</div>'; return; }
    var pct = prev.views ? Math.round((tot.views - prev.views) / prev.views * 100) : null;
    var delta = pct == null ? '' : '<span class="wsx-week__delta' + (pct < 0 ? ' is-down' : '') + '">' + esc(t('home.weekVsPrev').replace('{pct}', (pct > 0 ? '+' : '') + pct + '%')) + '</span>';
    var byDay = {}; ((d && d.series) || []).forEach(function (s) { byDay[s.date] = s.views || 0; });
    var days = [], max = 1;
    for (var i = 6; i >= 0; i--) {
      var dt = new Date(Date.now() - i * 864e5), key = dt.toISOString().slice(0, 10), v = byDay[key] || 0;
      days.push({ v: v, l: dt.toLocaleDateString(locTag(), { weekday: 'narrow' }), today: i === 0 }); if (v > max) max = v;
    }
    var bars = days.map(function (x) { return '<span class="wsx-week__bar' + (x.today ? ' is-today' : '') + '" style="--h:' + Math.max(4, Math.round(x.v / max * 100)) + '%" title="' + x.v + '"><i>' + esc(x.l) + '</i></span>'; }).join('');
    var top = (d && d.topArtifacts && d.topArtifacts[0]) || null;
    el.innerHTML = '<div class="wsx-week">'
      + '<div class="wsx-week__big"><b>' + esc(String(tot.views)) + '</b><span>' + esc(t('home.weekViews')) + '</span>' + delta + '</div>'
      + '<div class="wsx-week__bars" aria-hidden="true">' + bars + '</div></div>'
      + '<div class="wsx-week__facts"><div><b>' + esc(String(tot.uniques || 0)) + '</b><span>' + esc(t('home.weekPeople')) + '</span></div>'
      + '<div><b>' + esc(String(tot.activeArtifacts || 0)) + '</b><span>' + esc(t('home.weekArts')) + '</span></div></div>'
      + (top && top.slug ? '<a class="wsx-week__top" href="/a/' + encodeURIComponent(top.slug) + '/" data-id="' + esc(top.artifact_id) + '" data-name="' + esc(top.name) + '">' + esc(t('home.weekTop')) + ' <b>' + esc(top.name) + '</b> \\u00B7 ' + esc(String(top.views)) + '</a>' : '');
  }
  function loadWeek() {
    if (!document.getElementById('wsxWeek')) return;
    fetch('/v1/home/analytics?range=7' + homeWsq, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(renderWeek)
      .catch(function () { renderWeek(null); });
  }

  // ----- What's new in ShareOut: the latest release notes, linked to their entry -----
  (function () {
    var el = document.getElementById('wsxNews'); if (!el) return;
    var items = []; try { items = JSON.parse(el.getAttribute('data-news') || '[]'); } catch (e) {}
    var es = locTag() === 'es-AR', base = t('foot.whatsNewUrl');
    el.innerHTML = items.length ? items.map(function (n) {
      var dt = new Date(n.date + 'T12:00:00Z');
      var fresh = Date.now() - dt.getTime() < 14 * 864e5;
      return '<a class="wsx-news" href="' + esc(base + '#' + n.anchor) + '" target="_blank" rel="noopener">'
        + '<span class="wsx-news__d"><b>' + dt.getUTCDate() + '</b>' + esc(dt.toLocaleDateString(locTag(), { month: 'short', timeZone: 'UTC' }).replace('.', '')) + '</span>'
        + '<span class="wsx-news__t">' + (fresh ? '<span class="wsx-news__new">' + esc(t('home.newsNew')) + '</span>' : '') + esc(es ? n.es : n.en) + '</span></a>';
    }).join('') : '<div class="wsx-empty">' + esc(t('common.nothingHere')) + '</div>';
  })();

  // ----- All your artifacts: below the fold, loaded when it scrolls into view -----
  var ALL_SHOWN = 10;
  function renderAllArts() {
    var el = document.getElementById('wsxAllArts'); if (!el || typeof artCache === 'undefined') return;
    var d = artCache[artKey('recent', '')];
    if (!d || !d.rowsHtml) { el.innerHTML = '<div class="wsx-empty">' + esc(t('common.nothingHere')) + '</div>'; return; }
    el.innerHTML = '<div class="wsx-tbl wsx-tbl--art">' + tblHead() + d.rowsHtml + '</div>';
    localizeFragment(el); hidePendingArts(el);
    var rows = el.querySelectorAll('.wsx-tr');
    for (var i = ALL_SHOWN; i < rows.length; i++) rows[i].hidden = true;
    var total = d.total || rows.length;
    if (total > ALL_SHOWN) el.insertAdjacentHTML('beforeend', '<button type="button" class="wsx-card__all" data-go-lens="artifacts">' + esc(t('home.allMore').replace('{n}', String(total))) + '</button>');
  }
  function loadAllArts() {
    var el = document.getElementById('wsxAllArts'); if (!el || el.getAttribute('data-asked')) return;
    el.setAttribute('data-asked', '1');
    if (typeof fetchArt !== 'function') return;
    fetchArt('recent', renderAllArts, '');
  }
  (function () {
    var card = document.querySelector('[data-wid="wsxAllW"]'); if (!card) return;
    if (!('IntersectionObserver' in window)) { card.addEventListener('pointerenter', loadAllArts, { once: true }); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); loadAllArts(); } }, { rootMargin: '200px' });
    io.observe(card);
  })();

  if (window.requestIdleCallback) requestIdleCallback(loadWeek, { timeout: 2000 }); else setTimeout(loadWeek, 400);

`;
