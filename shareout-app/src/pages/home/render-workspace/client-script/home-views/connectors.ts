/** Provider catalog and existing workspace connections. */
export const workspace_client_home_views_connectors_JS = `  // ----- Connectors — provider catalog grouped by category + existing connections -----
  function connCats() {
    return [['warehouse', 'conn.cat.warehouse'], ['analytics', 'conn.cat.analytics'], ['ads', 'conn.cat.ads'], ['ecommerce', 'conn.cat.ecommerce'], ['productivity', 'conn.cat.productivity'], ['messaging', 'conn.cat.messaging'], ['other', 'conn.cat.other'], ['custom', 'conn.cat.custom']];
  }
  function loadConnectors() {
    var m = document.getElementById('wsxConnMount'); if (needWs(m)) return;
    m.innerHTML = i18nLoad();
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/connections/catalog', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var cat = (d && d.catalog) || [];
        connCatMap = {}; cat.forEach(function (p) { connCatMap[p.id] = p; });
        if (!cat.length) { m.innerHTML = i18nEmpty('connectors.empty'); return; }
        var byCat = {}; cat.forEach(function (p) { var c = p.category || 'other'; (byCat[c] = byCat[c] || []).push(p); });
        var html = '';
        connCats().forEach(function (pair) {
          var ps = byCat[pair[0]]; if (!ps || !ps.length) return;
          html += '<div class="wsx-conn__cat">' + esc(t(pair[1])) + '</div><div class="wsx-conn__grid">' + ps.map(connCard).join('') + '</div>';
        });
        m.innerHTML = html;
        wireConn(m);
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function connCard(p) {
    var conns = p.connections || [];
    var ico = '<span class="wsx-conn__ic" style="color:' + esc(p.color || 'var(--color-primary)') + '">' + isvg(p.iconSvg || SCHED_ICON.db) + '</span>';
    var insts = conns.map(function (c) {
      return '<div class="wsx-conn__inst" data-conn="' + esc(c.id) + '"><span class="wsx-conn__instname">' + esc(c.name) + '</span>'
        + '<label class="wsx-conn__ai" title="' + esc(t('connectors.aiTitle')) + '"><input type="checkbox" data-conn-ai="' + esc(c.id) + '"' + (c.agentQueryEnabled ? ' checked' : '') + '> ' + esc(t('connectors.ai')) + '</label>'
        + '<button class="wsx-conn__del" data-conn-del="' + esc(c.id) + '" title="' + esc(t('connectors.remove')) + '" type="button">\\u00D7</button></div>';
    }).join('');
    return '<div class="wsx-conn__card">'
      + '<div class="wsx-conn__top">' + ico + '<div class="wsx-conn__meta"><div class="wsx-conn__name">' + esc(p.label || p.id) + (conns.length ? ' <span class="wsx-conn__on">' + esc(t('connectors.connected')) + '</span>' : '') + '</div><div class="wsx-conn__tag">' + esc(p.tagline || '') + '</div></div></div>'
      + (insts ? '<div class="wsx-conn__insts">' + insts + '</div>' : '')
      + '<button class="wsx-abtn wsx-conn__add" data-conn-add="' + esc(p.id) + '" type="button">' + esc(conns.length ? t('connectors.addAnother') : t('connectors.connect')) + '</button>'
      + '</div>';
  }
  function wireConn(root) {
    root.querySelectorAll('[data-conn-add]').forEach(function (b) { b.addEventListener('click', function () { openConnectModal(b.getAttribute('data-conn-add')); }); });
    root.querySelectorAll('[data-conn-ai]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/connections/' + encodeURIComponent(cb.getAttribute('data-conn-ai')), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_query_enabled: cb.checked }) }).then(function (r) { if (!r.ok) throw new Error('failed'); }).catch(function () { cb.checked = !cb.checked; showToast(t('connectors.updateAiError'), 'error'); });
      });
    });
    root.querySelectorAll('[data-conn-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm(t('connectors.removeConfirm'))) return;
        var id = b.getAttribute('data-conn-del');
        fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/connections/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('failed'); var el = root.querySelector('[data-conn="' + id + '"]'); if (el) el.remove(); }).catch(function () { showToast(t('connectors.removeError'), 'error'); });
      });
    });
  }

`;
