/** URL deep-linking: reflect the active lens / artifact tab in location.hash so views
 *  are linkable and back/forward works. Hash scheme: #l/<lens> · #a/<slug>[/<page>]. */
export const workspace_client_routing_JS = `  // ===== deep-link routing (hash) =====
  var routeApplying = false;     // true while applyHash drives state (suppresses writes)
  var routeLastHash = null;      // hash we wrote via fallback assignment (skip echo)
  function routeFromState() {
    if (activeKey !== 'home' && panes[activeKey]) { var pr = panes[activeKey]; return 'a/' + encodeURIComponent(pr.art.slug) + (pr.page ? '/' + encPage(pr.page) : ''); }
    var on = ws.querySelector('[data-lens].is-active');
    var lens = on ? on.getAttribute('data-lens') : 'brief';
    if (lens === 'catalog' && typeof catCurrentId === 'string' && catCurrentId) return 'l/catalog/' + encodeURIComponent(catCurrentId);
    if (lens === 'artifacts' && typeof curFolder === 'string' && curFolder) return 'l/artifacts/' + encodeURIComponent(curFolder);
    if (lens === 'knowledge' && typeof knCurrentPath === 'string' && knCurrentPath) return 'l/knowledge/' + encodeURIComponent(knCurrentPath);
    return 'l/' + lens;
  }
  function syncHash() {
    if (routeApplying) return;
    var h = '#' + routeFromState();
    if (location.hash === h) return;
    routeLastHash = h;
    try { history.pushState(null, '', h); } catch (e) { location.hash = h; }
  }
  function applyHash(boot) {
    var raw = (location.hash || '').replace(/^#\\/?/, '');
    routeApplying = true;
    try {
      if (raw.indexOf('a/') === 0) {
        var aRest = raw.slice(2), aCut = aRest.indexOf('/'), slug = '', page = '';
        try { slug = decodeURIComponent(aCut >= 0 ? aRest.slice(0, aCut) : aRest); page = aCut >= 0 ? decodeURIComponent(aRest.slice(aCut + 1)) : ''; } catch (e) {}
        if (!slug) return;
        // A shared link lands on an artifact: the rail shows Artifacts, not Home.
        var onLens = ws.querySelector('[data-lens].is-active');
        if (boot && (!onLens || onLens.getAttribute('data-lens') === 'brief') && ws.querySelector('[data-lens="artifacts"]')) {
          lenses.forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-lens') === 'artifacts'); });
          openView('artifacts');
        }
        openArtifactPage(slug, page);
        return;
      }
      // lens route (or empty hash → Home/Brief). A lens may carry a sub-path,
      // e.g. #l/catalog/<entry-id> deep-links a catalog entry.
      var lensFull = raw.indexOf('l/') === 0 ? (raw.slice(2) || 'brief') : 'brief';
      var sl = lensFull.indexOf('/');
      var lens = sl >= 0 ? lensFull.slice(0, sl) : lensFull;
      var sub = sl >= 0 ? lensFull.slice(sl + 1) : '';
      var lb = ws.querySelector('[data-lens="' + lens + '"]');
      if (!lb) { lens = 'brief'; sub = ''; }
      lenses.forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-lens') === lens); });
      if (typeof exitCreate === 'function') exitCreate();
      if (lens === 'artifacts' && typeof artRoute === 'function') artRoute(decodeURIComponent(sub));
      openView(lens);
      if (lens === 'catalog' && typeof catRoute === 'function') catRoute(decodeURIComponent(sub));
      if (lens === 'knowledge' && typeof knRoute === 'function') knRoute(decodeURIComponent(sub));
    } finally { routeApplying = false; }
  }
  window.addEventListener('popstate', function () { applyHash(); });
  window.addEventListener('hashchange', function () { if (location.hash === routeLastHash) return; applyHash(); });
  if (location.hash) applyHash(true);
  else {
    // Query deep link (/home?view=connect&tab=code) — what emails and docs link to.
    var qp = new URLSearchParams(location.search), qv = qp.get('view') || '', qt = qp.get('tab') || '';
    var qb = /^[a-z]+$/.test(qv) ? ws.querySelector('[data-lens="' + qv + '"]') : null;
    if (qb) {
      if (qv === 'connect' && /^(claude|chatgpt|code)$/.test(qt)) cnTab = qt;
      qb.click();
    }
  }

`;
