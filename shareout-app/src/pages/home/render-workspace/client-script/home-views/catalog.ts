/** Data Catalog lens — workspace data map (sources, datasets, pipelines, terms) with lineage. */
export const workspace_client_home_views_catalog_JS = `  // ----- Catalog — workspace data map (read-only browse + lineage) -----
  var catState = { entries: [], byId: {}, facets: { kind: [], domain: [], status: [] }, q: '', kind: '', domain: '', status: '', sort: 'title', asc: true };
  var catCurrentId = '', catReady = false, catPendingId = '';
  // Deep-link entry point — called by the hash router for #l/catalog/<id> (and '' = list).
  function catRoute(id) {
    id = id || '';
    if (!catReady) { catPendingId = id; return; }
    var m = document.getElementById('wsxCatMount'); if (!m) return;
    if (id && catState.byId[id]) catDetail(m, id);
    else if (catCurrentId) { catCurrentId = ''; catRenderList(m); }
  }

  function catBadge(s) {
    if (!s) return '';
    var cls = s === 'certified' ? 'ok' : s === 'deprecated' ? 'warn' : 'draft';
    var label = ({ certified: t('catalog.statusCertified'), deprecated: t('catalog.statusDeprecated'), draft: t('catalog.statusDraft') })[s] || s;
    return '<span class="wsx-sched__badge ' + cls + '">' + esc(label) + '</span>';
  }
  function catKindLabel(k) {
    return ({ source: t('catalog.kindSource'), event: t('catalog.kindEvent'), dataset: t('catalog.kindDataset'), table: t('catalog.kindTable'), view: t('catalog.kindView'), pipeline: t('catalog.kindPipeline'), dashboard: t('catalog.kindDashboard'), model: t('catalog.kindModel'), metric: t('catalog.kindMetric'), term: t('catalog.kindTerm') })[k] || k;
  }
  function catOrigin(e) {
    if (e.fqn) return esc((e.connection ? e.connection + ' \\u00B7 ' : '') + e.fqn);
    if (e.connection) return esc(e.connection);
    if (e.artifact) return esc(t('catalog.originArtifact')) + ' ' + esc(e.artifact) + (e.store ? ' \\u00B7 ' + esc(e.store) : '');
    return '';
  }

  function loadCatalog() {
    var m = document.getElementById('wsxCatMount'); if (needWs(m)) return;
    m.innerHTML = i18nLoad();
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/catalog', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { m.innerHTML = i18nError('catalog.couldNotLoad'); return; }
        if (d.enabled === false) { catRenderOnboard(m, 'off'); return; }
        catState.entries = d.entries || [];
        catState.byId = {};
        catState.entries.forEach(function (e) { catState.byId[e.id] = e; });
        if (!catState.entries.length) { catRenderOnboard(m, 'empty'); return; }
        catState.facets = d.facets || { kind: [], domain: [], status: [] };
        catReady = true;
        if (catPendingId && catState.byId[catPendingId]) { var pid = catPendingId; catPendingId = ''; catDetail(m, pid); }
        else { catPendingId = ''; catRenderList(m); }
      })
      .catch(function () { m.innerHTML = i18nError('catalog.couldNotLoad'); });
  }

  function catRenderOnboard(m, mode) {
    var admin = !!window.WSX_ADMIN;
    var msg = mode === 'off' ? t('catalog.offTitle') : t('catalog.emptyTitle');
    var sub = mode === 'off' ? t('catalog.offSub') : t('catalog.emptySub');
    var btn = '';
    if (admin) btn = mode === 'off'
      ? '<button class="so-c-btn so-c-btn--primary" id="catEnable" type="button">' + esc(t('catalog.enableCatalog')) + '</button>'
      : '<button class="so-c-btn so-c-btn--primary" id="catSeed" type="button">' + esc(t('catalog.seedConnectors')) + '</button>'
        + ' <a class="wsx-cat__hint" href="#l/connectors">' + esc(t('catalog.connectDataSource')) + '</a>';
    else btn = '<p class="wsx-cat__hint">' + esc(t('catalog.askAdmin')) + '</p>';
    m.innerHTML = '<div class="wsx-cat__onboard"><p>' + esc(msg) + '</p><p class="wsx-cat__hint">' + esc(sub) + '</p>' + btn + '</div>';
    var en = document.getElementById('catEnable');
    if (en) en.addEventListener('click', function () {
      en.disabled = true;
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/catalog/enable', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })
        .then(function () { loadCatalog(); });
    });
    var sd = document.getElementById('catSeed');
    if (sd) sd.addEventListener('click', function () {
      sd.disabled = true; sd.textContent = t('catalog.seeding');
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/catalog/seed', { method: 'POST', credentials: 'same-origin' })
        .then(function () { loadCatalog(); });
    });
  }

  function catKpiTiles() {
    var es = catState.entries, n = es.length, ev = 0, doc = 0, cert = 0, certifiable = 0, orph = 0;
    es.forEach(function (e) {
      if (e.kind === 'event') ev++;
      if (typeof e.body === 'string' && e.body.trim()) doc++;
      if (e.kind !== 'term') { certifiable++; if (e.status === 'certified') cert++; }
      if (e.kind !== 'term' && (!e.upstream || !e.upstream.length) && (!e.downstream || !e.downstream.length)) orph++;
    });
    function pc(a, b) { return b ? Math.round(a / b * 100) : 0; }
    var tiles = [[n.toLocaleString(), t('catalog.kpiEntries')], [ev.toLocaleString(), t('catalog.kpiEvents')], [pc(cert, certifiable) + '%', t('catalog.kpiCertified')], [pc(doc, n) + '%', t('catalog.kpiDocumented')], [String(orph), t('catalog.kpiNoLineage')]];
    return '<div class="wsx-an__cards wsx-cat__kpis">' + tiles.map(function (tile) {
      return '<div class="wsx-an__card"><div class="wsx-an__n">' + tile[0] + '</div><div class="wsx-an__l">' + esc(tile[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  function catSeg(vals) {
    var btns = '<button class="' + (catState.kind === '' ? 'is-on' : '') + '" data-cat-kind-seg="" type="button">' + esc(t('catalog.segAll')) + '</button>';
    btns += (vals || []).map(function (v) {
      return '<button class="' + (catState.kind === v.value ? 'is-on' : '') + '" data-cat-kind-seg="' + esc(v.value) + '" type="button">' + esc(catKindLabel(v.value)) + ' ' + v.count + '</button>';
    }).join('');
    return '<div class="wsx__modetog wsx-cat__seg">' + btns + '</div>';
  }

  function catSelect(id, labelKey, key, vals) {
    if (!vals || !vals.length) return '';
    var label = t(labelKey);
    var opts = '<option value="">' + esc(t('catalog.filterAll').replace('{label}', label)) + '</option>' + vals.map(function (v) {
      return '<option value="' + esc(v.value) + '"' + (catState[key] === v.value ? ' selected' : '') + '>' + esc(v.value) + ' (' + v.count + ')</option>';
    }).join('');
    return '<select class="wsx-admin__role wsx-cat__sel" id="' + id + '">' + opts + '</select>';
  }

  var CAT_COLS = [['title', 'catalog.colName', 1], ['kind', 'catalog.colKind', 1], ['domain', 'catalog.colDomain', 1], ['status', 'catalog.colStatus', 1], ['origin', 'catalog.colOrigin', 0], ['lineage', 'catalog.colLineage', 0]];

  function catRow(e) {
    var text = [e.id, e.title, e.domain || '', e.fqn || ''].concat(e.tags || []).join(' ').toLowerCase();
    var up = (e.upstream || []).length, down = (e.downstream || []).length;
    var lc = '<span class="wsx-cat__lc' + (up ? '' : ' z') + '">\\u2191' + up + '</span> <span class="wsx-cat__lc' + (down ? '' : ' z') + '">\\u2193' + down + '</span>';
    var origin = catOrigin(e);
    return '<tr class="wsx-cat__row" data-cat-id="' + esc(e.id) + '" data-cat-text="' + esc(text) + '"'
      + ' data-cat-kind="' + esc(e.kind) + '" data-cat-domain="' + esc(e.domain || '') + '" data-cat-status="' + esc(e.status || '') + '">'
      + '<td><span class="wsx-atbl__link">' + esc(e.title) + '</span></td>'
      + '<td><span class="wsx-atbl__type">' + esc(catKindLabel(e.kind)) + '</span></td>'
      + '<td class="wsx-cat__cdom">' + (e.domain ? esc(e.domain) : '\\u2014') + '</td>'
      + '<td>' + (catBadge(e.status) || '<span class="wsx-atbl__date">\\u2014</span>') + '</td>'
      + '<td class="wsx-cat__corigin" title="' + origin + '">' + (origin || '\\u2014') + '</td>'
      + '<td class="wsx-atbl__num wsx-cat__clin">' + lc + '</td></tr>';
  }

  function catArrow(k) { return catState.sort === k ? (catState.asc ? ' \\u25B2' : ' \\u25BC') : ''; }

  function catSortedEntries() {
    var k = catState.sort, asc = catState.asc;
    return catState.entries.slice().sort(function (a, b) {
      var av = String(k === 'title' ? (a.title || '') : (a[k] || '')).toLowerCase();
      var bv = String(k === 'title' ? (b.title || '') : (b[k] || '')).toLowerCase();
      var c = av < bv ? -1 : av > bv ? 1 : 0; return asc ? c : -c;
    });
  }

  function catRenderList(m) {
    catCurrentId = '';
    if (typeof syncHash === 'function') syncHash();
    var f = catState.facets;
    var heads = CAT_COLS.map(function (c) {
      if (!c[2]) return '<th>' + esc(t(c[1])) + '</th>';
      return '<th class="' + (catState.sort === c[0] ? 'is-sort' : '') + '" data-asort="' + c[0] + '">' + esc(t(c[1])) + catArrow(c[0]) + '</th>';
    }).join('');
    m.innerHTML = catKpiTiles()
      + '<div class="wsx-cat__controls"><div class="wsx-cat__bar">'
      + '<input class="wsx-cat__search" id="catSearch" type="search" placeholder="' + esc(t('catalog.searchPlaceholder')) + '" autocomplete="off">'
      + catSeg(f.kind) + catSelect('catDom', 'catalog.filterDomain', 'domain', f.domain) + catSelect('catStat', 'catalog.filterStatus', 'status', f.status)
      + '<span class="wsx-cat__count" id="catCount"></span>'
      + '</div></div>'
      + '<div class="wsx-atbl__wrap"><table class="wsx-atbl wsx-cat__table"><thead><tr>' + heads + '</tr></thead>'
      + '<tbody id="catList">' + catSortedEntries().map(catRow).join('') + '</tbody></table></div>'
      + '<div class="wsx-empty" id="catNone" style="display:none">' + esc(t('catalog.noMatch')) + '</div>';
    var s = document.getElementById('catSearch'); if (s) s.value = catState.q;
    catApplyFilter();
    catBindList(m);
  }

  function catBindList(m) {
    var s = document.getElementById('catSearch');
    if (s) s.addEventListener('input', function () { catState.q = s.value.trim().toLowerCase(); catApplyFilter(); });
    m.querySelectorAll('[data-cat-kind-seg]').forEach(function (b) {
      b.addEventListener('click', function () { catState.kind = b.getAttribute('data-cat-kind-seg'); catRenderList(m); });
    });
    var dom = document.getElementById('catDom'); if (dom) dom.addEventListener('change', function () { catState.domain = dom.value; catApplyFilter(); });
    var st = document.getElementById('catStat'); if (st) st.addEventListener('change', function () { catState.status = st.value; catApplyFilter(); });
    m.querySelectorAll('th[data-asort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-asort');
        if (catState.sort === k) catState.asc = !catState.asc; else { catState.sort = k; catState.asc = true; }
        catRenderList(m);
      });
    });
    m.querySelectorAll('[data-cat-id]').forEach(function (r) {
      r.addEventListener('click', function () { catDetail(m, r.getAttribute('data-cat-id')); });
    });
  }

  function catApplyFilter() {
    var list = document.getElementById('catList'); if (!list) return;
    var none = document.getElementById('catNone'), cnt = document.getElementById('catCount'), shown = 0;
    Array.prototype.forEach.call(list.children, function (c) {
      var ok = !catState.q || (c.getAttribute('data-cat-text') || '').indexOf(catState.q) >= 0;
      if (ok && catState.kind && c.getAttribute('data-cat-kind') !== catState.kind) ok = false;
      if (ok && catState.domain && c.getAttribute('data-cat-domain') !== catState.domain) ok = false;
      if (ok && catState.status && c.getAttribute('data-cat-status') !== catState.status) ok = false;
      c.style.display = ok ? '' : 'none'; if (ok) shown++;
    });
    if (none) none.style.display = shown ? 'none' : 'block';
    if (cnt) cnt.textContent = t(shown === 1 ? 'catalog.resultOne' : 'catalog.resultMany').replace('{n}', shown.toLocaleString());
  }

  function catLinTable(ids) {
    if (!ids || !ids.length) return '<div class="wsx-cat__linnone">' + esc(t('catalog.linNone')) + '</div>';
    var rows = ids.map(function (id) {
      var e = catState.byId[id];
      if (!e) return '<tr class="wsx-cat__linrow z"><td class="wsx-cat__corigin" colspan="4" title="' + esc(id) + '">' + esc(id) + ' <span class="wsx-cat__unc">' + esc(t('catalog.uncatalogued')) + '</span></td></tr>';
      return '<tr class="wsx-cat__linrow" data-cat-goto="' + esc(id) + '">'
        + '<td><span class="wsx-atbl__link">' + esc(e.title) + '</span></td>'
        + '<td><span class="wsx-atbl__type">' + esc(catKindLabel(e.kind)) + '</span></td>'
        + '<td class="wsx-cat__cdom">' + (e.domain ? esc(e.domain) : '\\u2014') + '</td>'
        + '<td>' + (catBadge(e.status) || '<span class="wsx-atbl__date">\\u2014</span>') + '</td></tr>';
    }).join('');
    return '<div class="wsx-atbl__wrap"><table class="wsx-atbl wsx-cat__lintable"><tbody>' + rows + '</tbody></table></div>';
  }

  function catDetail(m, id) {
    var e = catState.byId[id]; if (!e) { catCurrentId = ''; catRenderList(m); return; }
    catCurrentId = id;
    if (typeof syncHash === 'function') syncHash();
    var rows = [[esc(t('catalog.metaKind')), esc(catKindLabel(e.kind))]];
    if (e.domain) rows.push([esc(t('catalog.metaDomain')), esc(e.domain)]);
    if (e.owner) rows.push([esc(t('catalog.metaOwner')), esc(e.owner)]);
    if (e.fqn) rows.push([esc(t('catalog.metaFqn')), esc(e.fqn)]);
    if (e.connection) rows.push([esc(t('catalog.metaConnection')), esc(e.connection)]);
    if (e.artifact) rows.push([esc(t('catalog.metaArtifact')), esc(e.artifact)]);
    if (e.store) rows.push([esc(t('catalog.metaStore')), esc(e.store)]);
    if (e.tags && e.tags.length) rows.push([esc(t('catalog.metaTags')), e.tags.map(function (tag) { return '<span class="wsx-cat__tag">' + esc(tag) + '</span>'; }).join(' ')]);
    if (e.terms && e.terms.length) rows.push([esc(t('catalog.metaTerms')), e.terms.map(esc).join(', ')]);
    var meta = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    var up = e.upstream || [], down = e.downstream || [];
    m.innerHTML = '<button class="wsx-cat__back" id="catBack" type="button">' + esc(t('catalog.back')) + '</button>'
      + '<div class="wsx-cat__dhead"><span class="wsx-atbl__type">' + esc(catKindLabel(e.kind)) + '</span><h3>' + esc(e.title) + '</h3>' + catBadge(e.status) + '</div>'
      + '<div class="wsx-sched__meta">' + esc(e.id) + '</div>'
      + '<dl class="wsx-cat__meta">' + meta + '</dl>'
      + (e.body ? '<div class="wsx-cat__body">' + mdToHtml(e.body) + '</div>' : '')
      + '<div class="wsx-cat__lin">'
      + '<div class="wsx-cat__linhead">' + esc(t('catalog.linUpstream')) + ' <span class="wsx-cat__lcount">' + up.length + '</span><span class="wsx-cat__linhint">' + esc(t('catalog.linUpstreamHint')) + '</span></div>' + catLinTable(up)
      + '<div class="wsx-cat__linhead">' + esc(t('catalog.linDownstream')) + ' <span class="wsx-cat__lcount">' + down.length + '</span><span class="wsx-cat__linhint">' + esc(t('catalog.linDownstreamHint')) + '</span></div>' + catLinTable(down)
      + '</div>';
    document.getElementById('catBack').addEventListener('click', function () { catCurrentId = ''; catRenderList(m); });
    m.querySelectorAll('[data-cat-goto]').forEach(function (b) {
      b.addEventListener('click', function () { catDetail(m, b.getAttribute('data-cat-goto')); });
    });
  }

`;
