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
        wireMcpConnect(m);
        if (!d.canManage) return;
        wireConn(m);
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function connTag(p) {
    if (p.id === 'mcp') return t('mcp.tagline');
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
    var isMcp = p.id === 'mcp';
    var insts = conns.map(function (c) {
      return '<div class="wsx-conn__inst" data-conn="' + esc(c.id) + '"><span class="wsx-conn__instname">' + esc(c.name) + '</span>'
        + (isMcp ? mcpMemberState(c) : '<label class="wsx-conn__ai" title="' + esc(t('connectors.aiTitle')) + '"><input type="checkbox" data-conn-ai="' + esc(c.id) + '"' + (c.agentQueryEnabled ? ' checked' : '') + (canManage ? '' : ' disabled') + '> ' + esc(t('connectors.ai')) + '</label>')
        + (canManage ? '<button class="wsx-conn__del" data-conn-del="' + esc(c.id) + '" title="' + esc(t('connectors.remove')) + '" type="button">\\u00D7</button>' : '') + '</div>';
    }).join('');
    return '<div class="wsx-conn__card">'
      + '<div class="wsx-conn__top">' + ico + '<div class="wsx-conn__meta"><div class="wsx-conn__name">' + esc(isMcp ? t('mcp.label') : (p.label || p.id)) + (conns.length ? ' <span class="wsx-conn__on">' + esc(t('connectors.connected')) + '</span>' : '') + '</div><div class="wsx-conn__tag">' + esc(connTag(p)) + '</div></div></div>'
      + (insts ? '<div class="wsx-conn__insts">' + insts + '</div>' : '')
      + (canManage
        ? '<button class="wsx-abtn wsx-conn__add" data-conn-add="' + esc(p.id) + '" type="button">' + esc(isMcp ? t('mcp.add') : (conns.length ? t('connectors.addAnother') : t('connectors.connect'))) + '</button>'
        : (conns.length ? '' : '<div class="wsx-conn__tag">' + esc(t('connectors.askAdmin').replace('{name}', p.label || p.id)) + '</div>'))
      + '</div>';
  }
  // MCP servers: every member signs in with their own account (per-user credentials).
  function mcpMemberState(c) {
    if (c.auth === 'none') return '<span class="wsx-conn__tag">' + esc(t('mcp.noSignIn')) + '</span>';
    if (c.hasMyCredentials) return '<span class="wsx-conn__tag">' + esc(t('mcp.mine')) + '</span> <button class="wsx-abtn" data-mcp-connect="' + esc(c.id) + '" type="button">' + esc(t('mcp.reconnectMine')) + '</button>';
    return '<button class="wsx-abtn wsx-abtn--primary" data-mcp-connect="' + esc(c.id) + '" type="button">' + esc(t('mcp.connectMine')) + '</button>';
  }
  function wireMcpConnect(root) {
    root.querySelectorAll('[data-mcp-connect]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-mcp-connect');
        // Open synchronously inside the click so popup blockers allow it; point it at
        // the provider once the server hands back the sign-in URL.
        var pop = window.open('about:blank', 'so_mcp_' + id, 'width=640,height=760');
        b.disabled = true;
        function failed(msg) { b.disabled = false; try { if (pop) pop.close(); } catch (_) {} window.showToast(msg || t('mcp.connectFailed'), 'error'); }
        fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/connections/' + encodeURIComponent(id) + '/mcp/connect', { credentials: 'same-origin' })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok || !res.d || !res.d.authUrl) { failed(res.d && res.d.error); return; }
            if (!pop) { window.location.href = res.d.authUrl; return; }
            pop.location.href = res.d.authUrl;
            function onMsg(ev) {
              if (ev.source !== pop || !ev.data || !ev.data.type) return;
              if (ev.data.type === 'shareout:workspace:connection:connected') {
                window.removeEventListener('message', onMsg);
                loaded.connectors = 0;
                loadConnectors();
              } else if (ev.data.type === 'shareout:workspace:connection:error') {
                window.removeEventListener('message', onMsg);
                failed(ev.data.message);
              }
            }
            window.addEventListener('message', onMsg);
          })
          .catch(function () { failed(); });
      });
    });
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
