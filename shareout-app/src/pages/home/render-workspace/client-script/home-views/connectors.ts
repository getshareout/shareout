/** Provider catalog and existing workspace connections. */
export const workspace_client_home_views_connectors_JS = `  // ----- Connectors — provider catalog grouped by category + existing connections -----
  function connCats() {
    return [['warehouse', 'conn.cat.warehouse'], ['analytics', 'conn.cat.analytics'], ['ads', 'conn.cat.ads'], ['storage', 'conn.cat.storage'], ['ecommerce', 'conn.cat.ecommerce'], ['productivity', 'conn.cat.productivity'], ['messaging', 'conn.cat.messaging'], ['other', 'conn.cat.other'], ['custom', 'conn.cat.custom']];
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
          html += '<div class="wsx-conn__cat">' + esc(t(pair[1])) + '</div><div class="wsx-conn__grid">' + ps.map(function (p) { return connCard(p, !!d.canManage); }).join('') + '</div>';
        });
        m.innerHTML = html;
        if (!d.canManage) return;
        wireConn(m);
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function connTag(p) {
    var k = 'conn.tag.' + p.id, v = t(k);
    return v === k ? (p.tagline || '') : v;
  }
  // Adding/removing workspace connections is an owner/admin action (server: canManage);
  // members see what is connected and who to ask.
  // Connections removed optimistically whose DELETE hasn't landed — a reload keeps them out.
  var pendingConnDeletes = {};
  function connCard(p, canManage) {
    var conns = (p.connections || []).filter(function (c) { return !pendingConnDeletes[c.id]; });
    var ico = '<span class="wsx-conn__ic" style="color:' + esc(p.color || 'var(--color-primary)') + '">' + isvg(p.iconSvg || SCHED_ICON.db) + '</span>';
    var insts = conns.map(function (c) {
      return '<div class="wsx-conn__inst" data-conn="' + esc(c.id) + '"><span class="wsx-conn__instname">' + esc(c.name) + '</span>'
        + '<label class="wsx-conn__ai" title="' + esc(t('connectors.aiTitle')) + '"><input type="checkbox" data-conn-ai="' + esc(c.id) + '"' + (c.agentQueryEnabled ? ' checked' : '') + (canManage ? '' : ' disabled') + '> ' + esc(t('connectors.ai')) + '</label>'
        + (canManage ? '<button class="wsx-conn__del" data-conn-del="' + esc(c.id) + '" title="' + esc(t('connectors.remove')) + '" type="button">\\u00D7</button>' : '') + '</div>';
    }).join('');
    return '<div class="wsx-conn__card">'
      + '<div class="wsx-conn__top">' + ico + '<div class="wsx-conn__meta"><div class="wsx-conn__name">' + esc(p.label || p.id) + (conns.length ? ' <span class="wsx-conn__on">' + esc(t('connectors.connected')) + '</span>' : '') + '</div><div class="wsx-conn__tag">' + esc(connTag(p)) + '</div></div></div>'
      + (insts ? '<div class="wsx-conn__insts">' + insts + '</div>' : '')
      + (canManage
        ? '<button class="wsx-abtn wsx-conn__add" data-conn-add="' + esc(p.id) + '" type="button">' + esc(conns.length ? t('connectors.addAnother') : t('connectors.connect')) + '</button>'
        : (conns.length ? '' : '<div class="wsx-conn__tag">' + esc(t('connectors.askAdmin').replace('{name}', p.label || p.id)) + '</div>'))
      + '</div>';
  }
  function wireConn(root) {
    root.querySelectorAll('[data-conn-add]').forEach(function (b) { b.addEventListener('click', function () { openConnectModal(b.getAttribute('data-conn-add')); }); });
    root.querySelectorAll('[data-conn-ai]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-conn-ai'), on = cb.checked;
        optimistic({
          key: 'conn:ai:' + id,
          apply: function () { cb.checked = on; },
          rollback: function () { cb.checked = !on; },
          request: function () { return fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/connections/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_query_enabled: on }) }); },
          error: t('connectors.updateAiError'),
        });
      });
    });
    root.querySelectorAll('[data-conn-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm(t('connectors.removeConfirm'))) return;
        var id = b.getAttribute('data-conn-del'), gone = null;
        optimistic({
          key: 'conn:del:' + id,
          undo: true,
          apply: function () { pendingConnDeletes[id] = true; gone = window.soOptimistic.leave(root.querySelector('[data-conn="' + CSS.escape(id) + '"]')); },
          rollback: function () { delete pendingConnDeletes[id]; if (gone) gone.restore(); },
          request: function () { return fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/connections/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', keepalive: true }); },
          success: t('connectors.removed'),
          error: t('connectors.removeError'),
          done: function () { delete pendingConnDeletes[id]; if (gone) gone.commit(); },
        });
      });
    });
  }

`;
