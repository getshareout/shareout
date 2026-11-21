/**
 * Details → More → ShareOut bar: the switch that hides the header above a published page
 * (the viewer's own Settings panel is gone). A lazy chunk (lazy-chunks.ts), fetched the
 * first time an editable Details panel shows the switch.
 */
export const workspace_client_inspector_viewbar_JS = `  // The ShareOut bar above the published page (the viewer header): on unless the owner
  // turned it off. Kept in the artifact's _viewer_config, which the viewer reads per view.
  var viewBarOn = {};
  function wireViewBar(art) {
    var inp = document.getElementById('wsxViewBar'); if (!inp || !art || !art.id) return;
    var url = '/v1/data/' + encodeURIComponent(art.id) + '/json/_viewer_config';
    function paint() { var on = viewBarOn[art.id]; if (typeof on === 'boolean') { inp.checked = on; inp.disabled = false; } }
    if (typeof viewBarOn[art.id] === 'boolean') paint();
    else {
      fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.status === 404 ? {} : r.ok ? r.json() : null; })
        .then(function (res) {
          if (!res) return;
          var cfg = (res.data && res.data.value) || res.value || {};
          viewBarOn[art.id] = cfg.hide_toolbar !== true;
          if (inp.isConnected) paint();
        })
        .catch(function () {});
    }
    inp.addEventListener('change', function () {
      var on = inp.checked;
      optimistic({
        key: 'viewbar:' + art.id,
        apply: function () { viewBarOn[art.id] = on; inp.checked = on; },
        rollback: function () { viewBarOn[art.id] = !on; inp.checked = !on; },
        request: function () { return fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hide_toolbar: !on }) }); },
        error: t('inspector.viewBarFailed'),
      });
    });
  }
`;
