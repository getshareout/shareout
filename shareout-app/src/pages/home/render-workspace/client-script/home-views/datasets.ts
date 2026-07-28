/** Workspace shared tables catalogue (read-only). */
export const workspace_client_home_views_datasets_JS = `  // ----- Datasets — workspace shared tables (read-only catalogue) -----
  function loadDatasets() {
    var m = document.getElementById('wsxDatasetMount'); if (needWs(m)) return;
    m.innerHTML = i18nLoad();
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/shared-tables', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var tables = (d && d.sharedTables) || [];
        if (!tables.length) { m.innerHTML = i18nEmpty('datasets.empty'); return; }
        m.innerHTML = tables.map(function (x) {
          var acc = x.access === 'readwrite' ? t('datasets.accessRw') : t('datasets.accessRo');
          var owner = x.ownerName ? (x.ownerSlug ? '<a href="/a/' + encodeURIComponent(x.ownerSlug) + '/" data-name="' + esc(x.ownerName) + '">' + esc(x.ownerName) + '</a>' : esc(x.ownerName)) : '';
          return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + isvg(DB_SVG) + ' <code>' + esc(x.sharedName) + '</code></div><span class="wsx-sched__badge ' + (x.access === 'readwrite' ? 'ok' : '') + '">' + esc(acc) + '</span></div>'
            + '<div class="wsx-sched__meta">' + (owner ? '<span>' + esc(t('datasets.from')) + ' ' + owner + '</span>' : '') + (x.createdAt ? '<span>' + esc(t('datasets.shared')) + ' ' + esc(whenAgo(x.createdAt)) + '</span>' : '') + '</div></div>';
        }).join('');
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

`;
