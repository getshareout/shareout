/** Knowledge map — the Map option of the Knowledge lens. Three columns: finder
 *  (search + type chips + most-mentioned), a focused neighbourhood graph (concentric
 *  layout, no simulation — the same entity always looks the same) and an evidence
 *  panel (facts with quotes, connections grouped by relation, mentions). Design note:
 *  docs/knowledge-map.md. Shares the knowledge.ts shell (KPIs, Train, view toggle). */
export const workspace_client_home_views_knowledgeMap_JS = `  // ----- Knowledge map — focused neighbourhood graph + evidence panel -----
  var kmState = { focus: '', depth: 1, type: '', q: '', types: [], counts: {}, top: [], hits: null, names: {}, gcache: {}, dcache: {}, trail: [], lay: null, vb: null, active: -1 };
  // Validated categorical palette (dataviz skill, light surface): fixed order by type name, never cycled.
  var KM_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  var kmSearchTimer = null, kmReq = 0;

  function kmTypeLabel(ty) { var k = 'kmap.type.' + ty, v = t(k); return v === k ? String(ty || '') : v; }
  function kmRelLabel(ty) { var k = 'kmap.rel.' + ty, v = t(k); return v === k ? String(ty || '').replace(/_/g, ' ') : v; }
  function kmHuman(s) { return String(s || '').replace(/_/g, ' '); }
  function kmColor(ty) { var i = kmState.types.indexOf(ty); return i >= 0 && i < KM_PALETTE.length ? KM_PALETTE[i] : 'var(--color-text-tertiary)'; }
  function kmDot(ty) { return '<span class="km__dot" style="background:' + kmColor(ty) + '"></span>'; }
  function kmTrunc(s, n) { s = String(s || ''); n = n || 26; return s.length > n ? s.slice(0, n - 1) + '\\u2026' : s; }
  function kmMentions(n) { n = Number(n || 0); return n === 1 ? t('kmap.mentionsOne') : t('kmap.mentionsCount').replace('{n}', n.toLocaleString()); }
  function kmName(id) { return kmState.names[id] || id; }
  function kmEntityTotal() { var n = 0; for (var k in kmState.counts) if (kmState.counts.hasOwnProperty(k)) n += Number(kmState.counts[k] || 0); return n; }
  function kmRemember(list) { (list || []).forEach(function (n) { if (n && n.id && n.name) kmState.names[n.id] = n.name; }); }

  // Switching the shared Tree|Table|Map toggle: the hash carries map/<id> only while the map is up.
  function kmOnViewSwitch(from, to) {
    if (to === 'map') knCurrentPath = kmState.focus ? 'map/' + kmState.focus : '';
    else if (from === 'map') knCurrentPath = '';
  }

  // ---- Layout: focus in the middle, direct neighbours on ring 1 (grouped by type),
  // second-degree on ring 2 next to their ring-1 parent. Pure: fixture-testable. ----
  function kmLayout(graph, focus, typeFilter) {
    var nodes = graph.nodes || [], edges = graph.edges || [], byId = {}, keep = {}, hidden = 0, adj = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    nodes.forEach(function (n) { if (!typeFilter || n.type === typeFilter || n.id === focus) keep[n.id] = true; else hidden++; });
    edges.forEach(function (e) {
      if (!keep[e.from] || !keep[e.to] || e.from === e.to) return;
      (adj[e.from] = adj[e.from] || []).push(e.to); (adj[e.to] = adj[e.to] || []).push(e.from);
    });
    var typeOf = function (id) { return byId[id] ? byId[id].type : ''; };
    var ment = function (id) { return byId[id] ? Number(byId[id].mentions || 0) : 0; };
    var ring = {}, pos = {}, r1 = [], r2 = [], dense = false;
    if (byId[focus]) { ring[focus] = 0; pos[focus] = { x: 0, y: 0 }; }
    (adj[focus] || []).forEach(function (id) { if (ring[id] == null) { ring[id] = 1; r1.push(id); } });
    nodes.forEach(function (n) { if (keep[n.id] && ring[n.id] == null) { ring[n.id] = 2; r2.push(n.id); } });
    r1.sort(function (a, b) { var ta = typeOf(a), tb = typeOf(b); if (ta !== tb) return ta < tb ? -1 : 1; return ment(b) - ment(a); });
    var R1 = Math.max(140, r1.length * 44 / (2 * Math.PI)), ang1 = {};
    r1.forEach(function (id, i) { var a = -Math.PI / 2 + (i / r1.length) * 2 * Math.PI; ang1[id] = a; pos[id] = { x: Math.cos(a) * R1, y: Math.sin(a) * R1 }; });
    if (r2.length) {
      var R2 = Math.max(R1 + 170, r2.length * 38 / (2 * Math.PI)), gap = 118 / R2;
      dense = r2.length * 118 > 2 * Math.PI * R2 * 0.92;
      // Children fan out centred on their first ring-1 parent; orphans (no visible parent) fill the rest.
      var byParent = {}, orphans = [];
      r2.forEach(function (id) {
        var ps = (adj[id] || []).filter(function (p) { return ring[p] === 1; });
        if (!ps.length) { orphans.push(id); return; }
        (byParent[ps[0]] = byParent[ps[0]] || []).push(id);
      });
      var want = [];
      Object.keys(byParent).forEach(function (p) {
        var kids = byParent[p].sort(function (a, b) { return ment(b) - ment(a); });
        kids.forEach(function (id, i) { want.push({ id: id, a: ang1[p] + (i - (kids.length - 1) / 2) * gap }); });
      });
      want.sort(function (x, y) { return x.a - y.a; });
      var angs = want.map(function (w) { return w.a; });
      for (var i = 1; i < angs.length; i++) if (angs[i] < angs[i - 1] + gap) angs[i] = angs[i - 1] + gap;
      var span = angs.length ? angs[angs.length - 1] - angs[0] : 0, maxSpan = 2 * Math.PI - gap * (orphans.length + 1);
      if (span > maxSpan && span > 0) { var k = maxSpan / span; for (var j = 0; j < angs.length; j++) angs[j] = angs[0] + (angs[j] - angs[0]) * k; }
      want.forEach(function (w, i) { pos[w.id] = { x: Math.cos(angs[i]) * R2, y: Math.sin(angs[i]) * R2 }; });
      var start = angs.length ? angs[angs.length - 1] + gap : -Math.PI / 2;
      var step = angs.length ? gap : 2 * Math.PI / orphans.length;
      orphans.forEach(function (id, i) { var a = start + i * step; pos[id] = { x: Math.cos(a) * R2, y: Math.sin(a) * R2 }; });
    }
    var out = [];
    nodes.forEach(function (n) {
      if (!pos[n.id]) return;
      var r = n.id === focus ? 20 : Math.min(15, 6 + Math.sqrt(ment(n.id)) * 1.5);
      out.push({ id: n.id, x: pos[n.id].x, y: pos[n.id].y, r: r, ring: ring[n.id], n: n });
    });
    return { nodes: out, edges: edges.filter(function (e) { return pos[e.from] && pos[e.to] && e.from !== e.to; }), hidden: hidden, ring1: r1.length, dense: dense };
  }

  function kmSvgInner(lay) {
    var P = {}, focus = kmState.focus, out = [];
    lay.nodes.forEach(function (n) { P[n.id] = n; });
    out.push('<g class="km__edges">');
    lay.edges.forEach(function (e) {
      var a = P[e.from], b = P[e.to], primary = e.from === focus || e.to === focus;
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      out.push('<g class="km__e' + (primary ? ' is-primary' : '') + '" data-km-from="' + esc(e.from) + '" data-km-to="' + esc(e.to) + '">'
        + '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '"/>'
        + '<text class="km__elbl" x="' + mx.toFixed(1) + '" y="' + (my - 4).toFixed(1) + '" text-anchor="middle">' + esc(kmRelLabel(e.type)) + '</text></g>');
    });
    out.push('</g><g class="km__nodes">');
    lay.nodes.forEach(function (n) {
      var c = kmColor(n.n.type), isF = n.id === focus;
      var anchor = isF ? 'middle' : (n.x >= 0 ? 'start' : 'end');
      var lx = isF ? n.x : n.x + (n.x >= 0 ? n.r + 7 : -(n.r + 7)), ly = isF ? n.y + n.r + 17 : n.y + 4;
      out.push('<g class="km__node' + (isF ? ' is-focus' : '') + ' km__ring' + n.ring + '" data-km-node="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(n.n.name) + '">'
        + (isF ? '<circle class="km__halo" cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + (n.r + 6) + '" style="stroke:' + c + '"/>' : '')
        + '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + n.r.toFixed(1) + '" style="fill:' + (isF ? c : 'color-mix(in srgb, ' + c + ' 18%, var(--color-bg-elevated))') + ';stroke:' + c + '"/>'
        + '<text class="km__lbl" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(kmTrunc(n.n.name)) + '</text></g>');
    });
    out.push('</g>');
    return out.join('');
  }

  function kmFitBox(lay) {
    if (!lay.nodes.length) return { x: -200, y: -150, w: 400, h: 300 };
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    lay.nodes.forEach(function (n) {
      var lw = Math.min(26, String(n.n.name || '').length) * 7 + 14;
      minX = Math.min(minX, n.x - n.r - (n.x < 0 ? lw : 8)); maxX = Math.max(maxX, n.x + n.r + (n.x >= 0 ? lw : 8));
      minY = Math.min(minY, n.y - n.r - 12); maxY = Math.max(maxY, n.y + n.r + 24);
    });
    var pad = 24, w = Math.max(360, maxX - minX + pad * 2), h = Math.max(260, maxY - minY + pad * 2);
    return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w: w, h: h };
  }
  function kmApplyVb() { var s = document.getElementById('kmSvg'), v = kmState.vb; if (s && v) s.setAttribute('viewBox', v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ' ' + v.w.toFixed(1) + ' ' + v.h.toFixed(1)); }
  function kmFit() { if (kmState.lay) { kmState.vb = kmFitBox(kmState.lay); kmApplyVb(); } }

  function kmPaintCanvas() {
    var host = document.getElementById('kmCanvas'); if (!host) return;
    var g = kmState.gcache[kmState.focus + '|' + kmState.depth]; if (!g) return;
    var lay = kmLayout(g, kmState.focus, kmState.type);
    kmState.lay = lay; kmState.vb = kmFitBox(lay);
    var trail = '<div class="km__trail">'
      + '<button class="km__crumb" data-km-crumb="-1" type="button">' + esc(t('kmap.trailRoot')) + '</button>'
      + kmState.trail.map(function (id, i) { var cur = i === kmState.trail.length - 1; return '<span class="km__sep">\\u203A</span><button class="km__crumb' + (cur ? ' is-cur' : '') + '" data-km-crumb="' + i + '" type="button"' + (cur ? ' aria-current="page"' : '') + '>' + esc(kmTrunc(kmName(id), 22)) + '</button>'; }).join('')
      + '</div>';
    var tools = '<div class="km__tools"><div class="wsx__modetog km__depth">'
      + '<button class="' + (kmState.depth === 1 ? 'is-on' : '') + '" data-km-depth="1" type="button">' + esc(t('kmap.depth1')) + '</button>'
      + '<button class="' + (kmState.depth === 2 ? 'is-on' : '') + '" data-km-depth="2" type="button">' + esc(t('kmap.depth2')) + '</button></div>'
      + '<button class="so-c-btn so-c-btn--sm" data-km-fit type="button">' + esc(t('kmap.fit')) + '</button></div>';
    var note = '';
    if (!lay.edges.length) note = '<div class="km__note">' + esc(t('kmap.noConnections')) + '</div>';
    else if (lay.hidden) note = '<div class="km__note">' + esc(t('kmap.hiddenByFilter').replace('{n}', lay.hidden.toLocaleString())) + '</div>';
    host.innerHTML = '<div class="km__head">' + trail + tools + '</div>'
      + '<svg class="km__svg' + (lay.ring1 <= 10 ? ' km--labels' : '') + (lay.dense ? ' km--dense' : '') + '" id="kmSvg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img">' + kmSvgInner(lay) + '</svg>' + note;
    kmApplyVb();
    kmBindCanvas(host);
  }

  function kmBindCanvas(host) {
    var svg = document.getElementById('kmSvg'); if (!svg) return;
    host.querySelectorAll('[data-km-depth]').forEach(function (b) {
      b.addEventListener('click', function () { var d = Number(b.getAttribute('data-km-depth')); if (d !== kmState.depth) { kmState.depth = d; kmLoadGraph(); } });
    });
    var fit = host.querySelector('[data-km-fit]'); if (fit) fit.addEventListener('click', kmFit);
    host.querySelectorAll('[data-km-crumb]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-km-crumb'));
        if (i < 0) { kmGo(kmState.top[0] ? kmState.top[0].id : kmState.focus, 'reset'); return; }
        kmState.trail = kmState.trail.slice(0, i + 1); kmGo(kmState.trail[i], 'none');
      });
    });
    // Hover: the node and its edges stay sharp, the rest recedes; edge labels appear.
    var hot = function (id) {
      svg.classList.toggle('km--hover', !!id);
      svg.querySelectorAll('.km__e').forEach(function (e) { e.classList.toggle('is-hot', !!id && (e.getAttribute('data-km-from') === id || e.getAttribute('data-km-to') === id)); });
      var near = {}; if (id) { near[id] = true; svg.querySelectorAll('.km__e.is-hot').forEach(function (e) { near[e.getAttribute('data-km-from')] = true; near[e.getAttribute('data-km-to')] = true; }); }
      svg.querySelectorAll('.km__node').forEach(function (n) { n.classList.toggle('is-hot', !!near[n.getAttribute('data-km-node')]); });
    };
    svg.addEventListener('mouseover', function (ev) { var n = ev.target.closest && ev.target.closest('[data-km-node]'); if (n) hot(n.getAttribute('data-km-node')); });
    svg.addEventListener('mouseout', function (ev) { var n = ev.target.closest && ev.target.closest('[data-km-node]'); if (n) hot(''); });
    svg.addEventListener('focusin', function (ev) { var n = ev.target.closest && ev.target.closest('[data-km-node]'); if (n) hot(n.getAttribute('data-km-node')); });
    svg.addEventListener('focusout', function () { hot(''); });
    svg.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var n = ev.target.closest && ev.target.closest('[data-km-node]'); if (!n) return;
      ev.preventDefault(); kmGo(n.getAttribute('data-km-node'), 'push');
    });
    // Drag to pan, wheel to zoom around the cursor; a click (< 4px of movement) on a node refocuses.
    var drag = null;
    var pt = function (ev) { var r = svg.getBoundingClientRect(), v = kmState.vb; return { x: v.x + (ev.clientX - r.left) / r.width * v.w, y: v.y + (ev.clientY - r.top) / r.height * v.h, r: r }; };
    svg.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var n = ev.target.closest && ev.target.closest('[data-km-node]');
      drag = { sx: ev.clientX, sy: ev.clientY, vx: kmState.vb.x, vy: kmState.vb.y, moved: false, node: n ? n.getAttribute('data-km-node') : '' };
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var r = svg.getBoundingClientRect(), dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      kmState.vb.x = drag.vx - dx / r.width * kmState.vb.w; kmState.vb.y = drag.vy - dy / r.height * kmState.vb.h; kmApplyVb();
      svg.classList.add('is-dragging');
    });
    svg.addEventListener('pointerup', function () {
      var was = drag; drag = null; svg.classList.remove('is-dragging');
      if (!was || was.moved || !was.node || was.node === kmState.focus) return;
      kmGo(was.node, 'push');
    });
    svg.addEventListener('pointercancel', function () { drag = null; svg.classList.remove('is-dragging'); });
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = pt(ev), v = kmState.vb, k = ev.deltaY > 0 ? 1.12 : 1 / 1.12;
      var nw = Math.min(4000, Math.max(240, v.w * k)), nh = v.h * (nw / v.w);
      v.x = p.x - (p.x - v.x) * (nw / v.w); v.y = p.y - (p.y - v.y) * (nh / v.h); v.w = nw; v.h = nh; kmApplyVb();
    }, { passive: false });
  }

  // ---- Finder: search (server-side, debounced), type chips, most-mentioned list ----
  function kmPaintFinder() {
    var host = document.getElementById('kmFinder'); if (!host) return;
    var chips = '<button class="km__chip' + (kmState.type ? '' : ' is-on') + '" data-km-type="" type="button">' + esc(t('kmap.allTypes')) + '</button>'
      + kmState.types.map(function (ty) {
        return '<button class="km__chip' + (kmState.type === ty ? ' is-on' : '') + '" data-km-type="' + esc(ty) + '" type="button">' + kmDot(ty) + esc(kmTypeLabel(ty)) + '<span class="km__cnt">' + Number(kmState.counts[ty] || 0).toLocaleString() + '</span></button>';
      }).join('');
    var list = (kmState.hits || kmState.top).filter(function (e) { return !kmState.type || e.type === kmState.type; });
    var items = list.length ? list.map(function (e, i) {
      return '<button class="km__item' + (e.id === kmState.focus ? ' is-on' : '') + (i === kmState.active ? ' is-active' : '') + '" data-km-go="' + esc(e.id) + '" type="button">'
        + kmDot(e.type) + '<span class="km__iname">' + esc(e.name) + '</span><span class="km__itype">' + esc(kmTypeLabel(e.type)) + '</span></button>';
    }).join('') : '<div class="km__none">' + esc(t('kmap.noResults')) + '</div>';
    var had = document.getElementById('kmSearch'), hadFocus = had && document.activeElement === had, sel = had ? [had.selectionStart, had.selectionEnd] : null;
    host.innerHTML = '<input class="wsx-cat__search km__search" id="kmSearch" type="search" placeholder="' + esc(t('kmap.searchPlaceholder')) + '" autocomplete="off" value="' + esc(kmState.q) + '">'
      + '<div class="km__chips">' + chips + '</div>'
      + '<div class="km__lh">' + esc(t(kmState.hits ? 'kmap.results' : 'kmap.mostMentioned')) + '</div>'
      + '<div class="km__list" id="kmList">' + items + '</div>';
    var s = document.getElementById('kmSearch');
    if (hadFocus) { s.focus(); try { s.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    s.addEventListener('input', function () {
      kmState.q = s.value.trim(); kmState.active = -1;
      if (kmSearchTimer) clearTimeout(kmSearchTimer);
      if (!kmState.q) { kmState.hits = null; kmPaintFinder(); return; }
      kmSearchTimer = setTimeout(kmSearch, 180);
    });
    s.addEventListener('keydown', function (ev) {
      var list = (kmState.hits || kmState.top).filter(function (e) { return !kmState.type || e.type === kmState.type; });
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        var n = list.length; if (!n) return;
        kmState.active = ev.key === 'ArrowDown' ? (kmState.active + 1) % n : (kmState.active - 1 + n) % n;
        kmPaintFinder();
      } else if (ev.key === 'Enter') {
        var pick = list[kmState.active >= 0 ? kmState.active : 0]; if (pick) kmGo(pick.id, 'reset');
      } else if (ev.key === 'Escape') { s.value = ''; kmState.q = ''; kmState.hits = null; kmState.active = -1; kmPaintFinder(); }
    });
    host.querySelectorAll('[data-km-type]').forEach(function (b) {
      b.addEventListener('click', function () { kmState.type = b.getAttribute('data-km-type'); kmState.active = -1; kmPaintFinder(); kmPaintCanvas(); });
    });
    host.querySelectorAll('[data-km-go]').forEach(function (b) { b.addEventListener('click', function () { kmGo(b.getAttribute('data-km-go'), 'reset'); }); });
  }

  function kmSearch() {
    var q = kmState.q, my = ++kmReq;
    fetch(knBase() + '/entities?limit=30&q=' + encodeURIComponent(q), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (my !== kmReq || kmState.q !== q) return; kmState.hits = (d && d.entities) || []; kmRemember(kmState.hits); kmPaintFinder(); })
      .catch(function () {});
  }

  function kmLoadTypes(cb) {
    fetch(knBase() + '/entities?limit=40', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { cb(false); return; }
        kmState.counts = {};
        (d.types || []).forEach(function (x) { kmState.counts[x.type] = x.count; });
        kmState.types = Object.keys(kmState.counts).sort();
        kmState.top = d.entities || []; kmRemember(kmState.top);
        var kpi = document.querySelector('.wsx-cat__kpis'); if (kpi) kpi.outerHTML = knKpiTiles();
        cb(true);
      })
      .catch(function () { cb(false); });
  }

  // ---- Focus: the hash, the trail, then graph + detail (cached per session) ----
  function kmGo(id, mode) {
    if (!id) return;
    if (mode === 'push') { kmState.trail = kmState.trail.filter(function (x) { return x !== id; }).concat([id]).slice(-6); }
    else if (mode === 'reset') { kmState.trail = [id]; }
    kmState.focus = id; knCurrentPath = 'map/' + id;
    if (typeof syncHash === 'function') syncHash();
    kmPaintFinder(); kmLoadGraph(); kmLoadDetail();
  }

  function kmLoadGraph() {
    var key = kmState.focus + '|' + kmState.depth, host = document.getElementById('kmCanvas');
    if (kmState.gcache[key]) { kmPaintCanvas(); return; }
    if (host) host.innerHTML = i18nLoad();
    var my = ++kmReq;
    fetch(knBase() + '/graph?focus=' + encodeURIComponent(kmState.focus) + '&depth=' + kmState.depth + '&limit=' + (kmState.depth === 1 ? 60 : 120), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (g) {
        if (!g) throw new Error('graph');
        kmRemember(g.nodes); kmState.gcache[key] = g;
        if (my === kmReq || key === kmState.focus + '|' + kmState.depth) kmPaintCanvas();
      })
      .catch(function () { var h = document.getElementById('kmCanvas'); if (h) h.innerHTML = i18nError('knowledge.couldNotLoad'); });
  }

  function kmLoadDetail() {
    var id = kmState.focus, host = document.getElementById('kmPanel');
    if (kmState.dcache[id]) { kmPaintPanel(kmState.dcache[id]); return; }
    if (host) host.innerHTML = i18nLoad();
    fetch(knBase() + '/entities/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) throw new Error('entity');
        kmState.dcache[id] = d; if (d.entity) kmRemember([d.entity]);
        if (id === kmState.focus) kmPaintPanel(d);
      })
      .catch(function () { var h = document.getElementById('kmPanel'); if (h) h.innerHTML = i18nError('knowledge.couldNotLoad'); });
  }

  // ---- Evidence panel ----
  function kmSrc(src) {
    if (!src) return '';
    var m = src.url ? /\\/a\\/([^/?#]+)/.exec(String(src.url)) : null;
    if (src.kind === 'page' && m) {
      return '<button class="km__src" type="button" data-km-open-slug="' + esc(m[1]) + '" data-km-open-id="' + esc(src.id) + '" data-km-open-title="' + esc(src.title) + '" title="' + esc(t('kmap.openPage')) + '">' + esc(src.title) + ' <span class="km__ext">\\u2197</span></button>';
    }
    return '<span class="km__src km__src--file"><span class="so-c-badge wsx-kn__bdg">' + esc(t('kmap.file')) + '</span>' + esc(src.title) + '</span>';
  }
  function kmSection(title, count, body) {
    return '<section class="km__sec"><h4 class="km__h4">' + esc(title) + '<span class="km__cnt">' + Number(count || 0).toLocaleString() + '</span></h4>' + body + '</section>';
  }
  function kmPaintPanel(d) {
    var host = document.getElementById('kmPanel'); if (!host) return;
    var e = d.entity || {}, aliases = (e.aliases || []).filter(function (a) { return a && a !== e.name; });
    var head = '<div class="km__phead">' + kmDot(e.type) + '<span class="wsx-atbl__type">' + esc(kmTypeLabel(e.type)) + '</span><span class="km__pm">' + esc(kmMentions(e.mentions)) + '</span></div>'
      + '<h3 class="km__pname">' + esc(e.name || '') + '</h3>'
      + (aliases.length ? '<div class="km__aka">' + esc(t('kmap.alsoKnownAs')) + ' ' + esc(aliases.slice(0, 6).join(', ')) + '</div>' : '');
    var facts = (d.facts || []);
    var fbody = facts.length ? facts.map(function (f) {
      var since = f.validFrom ? '<span class="km__since">' + esc(t('kmap.since').replace('{d}', fmtDay(f.validFrom, true) || f.validFrom)) + '</span>' : '';
      return '<div class="km__fact"><div class="km__fk">' + esc(kmHuman(f.predicate)) + '</div>'
        + '<div class="km__fv">' + esc(f.value) + (f.unit ? ' <span class="km__unit">' + esc(f.unit) + '</span>' : '') + since + '</div>'
        + (f.quote ? '<blockquote class="km__q">\\u201C' + esc(f.quote) + '\\u201D</blockquote>' : '') + kmSrc(f.source) + '</div>';
    }).join('') : '<div class="km__none">' + esc(t('kmap.noFacts')) + '</div>';
    var groups = {}, order = [];
    (d.relations || []).forEach(function (r) {
      var k = r.direction + ':' + r.type; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r);
    });
    var cbody = order.length ? order.map(function (k) {
      var rs = groups[k], first = rs[0], inn = first.direction === 'in';
      return '<div class="km__group"><div class="km__gh" title="' + esc(t(inn ? 'kmap.incoming' : 'kmap.outgoing')) + '"><span class="km__arrow">' + (inn ? '\\u2190' : '\\u2192') + '</span>' + esc(kmRelLabel(first.type)) + '<span class="km__cnt">' + rs.length + '</span></div>'
        + rs.map(function (r) {
          return '<button class="km__item" type="button" data-km-go="' + esc(r.other.id) + '">' + kmDot(r.other.type) + '<span class="km__iname">' + esc(r.other.name) + '</span><span class="km__itype">' + esc(kmTypeLabel(r.other.type)) + '</span></button>';
        }).join('') + '</div>';
    }).join('') : '<div class="km__none">' + esc(t('kmap.noConnections')) + '</div>';
    var ms = (d.mentions || []), LIMIT = 6;
    var mrow = function (m) { return '<div class="km__mention"><blockquote class="km__q">\\u201C' + esc(m.quote) + '\\u201D</blockquote><div class="km__cite">' + kmSrc(m.source) + (m.locator ? '<span class="km__loc">' + esc(m.locator) + '</span>' : '') + '</div></div>'; };
    var mbody = ms.length ? ms.slice(0, LIMIT).map(mrow).join('')
      + (ms.length > LIMIT ? '<div class="km__more" id="kmMore">' + ms.slice(LIMIT).map(mrow).join('') + '</div><button class="wsx-link km__morebtn" id="kmMoreBtn" type="button">' + esc(t('kmap.showMore').replace('{n}', (ms.length - LIMIT).toLocaleString())) + '</button>' : '')
      : '<div class="km__none">' + esc(t('kmap.noMentions')) + '</div>';
    host.innerHTML = head + kmSection(t('kmap.facts'), facts.length, fbody) + kmSection(t('kmap.connections'), (d.relations || []).length, cbody) + kmSection(t('kmap.mentions'), ms.length, mbody);
    host.scrollTop = 0;
    host.querySelectorAll('[data-km-go]').forEach(function (b) { b.addEventListener('click', function () { kmGo(b.getAttribute('data-km-go'), 'push'); }); });
    host.querySelectorAll('[data-km-open-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (typeof openArtifact !== 'function') return;
        openArtifact(b.getAttribute('data-km-open-slug') || '', b.getAttribute('data-km-open-title') || '', b.getAttribute('data-km-open-id') || '');
      });
    });
    var more = document.getElementById('kmMoreBtn');
    if (more) more.addEventListener('click', function () { var x = document.getElementById('kmMore'); if (x) x.classList.add('is-open'); more.remove(); });
  }

  // ---- Shell: called by knRenderShell when the view toggle is on Map ----
  function kmRender(m, topHtml) {
    m.innerHTML = topHtml + '<div class="km" id="kmRoot"><aside class="km__finder" id="kmFinder"></aside>'
      + '<section class="km__canvas" id="kmCanvas">' + i18nLoad() + '</section><aside class="km__panel" id="kmPanel"></aside></div>';
    knBindShell(m);
    var start = function (ok) {
      if (!ok) { var c = document.getElementById('kmCanvas'); if (c) c.innerHTML = i18nError('knowledge.couldNotLoad'); return; }
      if (!kmState.top.length) {
        var root = document.getElementById('kmRoot');
        if (root) root.innerHTML = '<div class="wsx-kn2__empty km__empty"><p>' + esc(t('kmap.empty')) + '</p><p>' + esc(t('kmap.emptyHint')) + '</p></div>';
        return;
      }
      kmPaintFinder();
      if (kmState.focus) { if (!kmState.trail.length) kmState.trail = [kmState.focus]; kmGo(kmState.focus, 'none'); return; }
      kmDefaultFocus(function (id) { kmState.trail = [id]; kmGo(id, 'none'); });
    };
    if (kmState.types.length) start(true); else kmLoadTypes(start);
  }

  // First open: the best-connected entity among the most mentioned (ties → more mentions).
  function kmDefaultFocus(cb) {
    fetch(knBase() + '/graph?limit=80', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (g) {
        if (!g || !g.nodes || !g.nodes.length) { cb(kmState.top[0].id); return; }
        kmRemember(g.nodes);
        var deg = {}; (g.edges || []).forEach(function (e) { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
        var best = g.nodes.slice().sort(function (a, b) { return (deg[b.id] || 0) - (deg[a.id] || 0) || Number(b.mentions || 0) - Number(a.mentions || 0); })[0];
        cb(best.id);
      })
      .catch(function () { cb(kmState.top[0].id); });
  }
`;
