/** Sent delivery links: list, copy, revoke. */
export const workspace_client_home_views_deliveries_JS = `  // ----- sent deliveries: list links, copy, revoke -----
  function delivStatus(l) { return l.revoked ? [t('deliveries.statusRevoked'), 'rv'] : l.expired ? [t('deliveries.statusExpired'), 'ex'] : [t('deliveries.statusActive'), 'ok']; }
  function delivGate(g) { return g === 'password' ? t('deliveries.gatePassword') : g === 'domain' ? t('deliveries.gateDomain') : t('deliveries.gateOpen'); }
  function renderDeliveries(links) {
    if (!links.length) return '<p class="wsx-field__note">' + esc(t('deliveries.empty')) + '</p>';
    return '<div class="wsx-deliv">' + links.map(function (l) {
      var st = delivStatus(l);
      var filesLbl = l.fileCount === 1 ? t('deliveries.files') : t('deliveries.filesPlural');
      var opensLbl = l.viewCount === 1 ? t('deliveries.opens') : t('deliveries.opensPlural');
      var meta = l.fileCount + ' ' + filesLbl + ' \\u00b7 ' + delivGate(l.gate) + ' \\u00b7 ' + l.viewCount + ' ' + opensLbl + (l.expiresAt ? ' \\u00b7 ' + t('deliveries.until') + ' ' + esc(new Date(l.expiresAt).toLocaleDateString(locTag())) : '');
      return '<div class="wsx-deliv__row" data-link="' + esc(l.id) + '">'
        + '<div class="wsx-deliv__main"><div class="wsx-deliv__name">' + esc(l.collectionName) + '</div><div class="wsx-deliv__meta">' + meta + '</div></div>'
        + '<span class="wsx-deliv__st ' + st[1] + '">' + esc(st[0]) + '</span>'
        + '<div class="wsx-deliv__acts">' + (l.revoked ? '' : '<button class="wsx-abtn" data-deliv-act="copy" type="button">' + esc(t('deliveries.copy')) + '</button><button class="wsx-abtn danger" data-deliv-act="revoke" type="button">' + esc(t('deliveries.revoke')) + '</button>') + '</div>'
        + '</div>';
    }).join('') + '</div>';
  }
  function openDeliveries() {
    wsxModal(t('deliveries.title'), '<div class="wsx-cform"><div id="wsxDelivBody">' + i18nLoad() + '</div></div>');
    function load() {
      fetch(assetApiBase() + '/links', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var bodyEl = document.getElementById('wsxDelivBody'); if (!bodyEl) return;
          var links = (d && d.links) || []; bodyEl.innerHTML = renderDeliveries(links);
          bodyEl.querySelectorAll('[data-deliv-act]').forEach(function (b) {
            b.addEventListener('click', function () {
              var row = b.closest('[data-link]'); var id = row.getAttribute('data-link'); var act = b.getAttribute('data-deliv-act');
              var l = links.filter(function (x) { return x.id === id; })[0];
              if (act === 'copy') { if (l) copyText(l.url, b); }
              else if (act === 'revoke') {
                if (!window.confirm(t('deliveries.revokeConfirm'))) return;
                // Shows as revoked at once; the revoke waits out the Undo toast.
                var stEl = row.querySelector('.wsx-deliv__st'), acts = row.querySelector('.wsx-deliv__acts');
                var was = { t: stEl.textContent, c: stEl.className };
                optimistic({
                  key: 'deliv-revoke:' + id, undo: true,
                  apply: function () { stEl.textContent = t('deliveries.statusRevoked'); stEl.className = 'wsx-deliv__st rv'; acts.hidden = true; },
                  rollback: function () { stEl.textContent = was.t; stEl.className = was.c; acts.hidden = false; },
                  request: function () { return fetch(assetApiBase() + '/links/' + encodeURIComponent(id) + '/revoke', { method: 'POST', credentials: 'same-origin', keepalive: true }); },
                  success: t('deliveries.revoked'),
                  error: t('deliveries.couldNotRevoke'),
                  done: function () { if (document.getElementById('wsxDelivBody')) load(); },
                });
              }
            });
          });
        }).catch(function () { var bodyEl = document.getElementById('wsxDelivBody'); if (bodyEl) bodyEl.innerHTML = i18nEmpty('common.couldNotLoad'); });
    }
    load();
  }
  function wireAssets() {
    if (assetsWired) return; assetsWired = true;
    var dv = document.getElementById('wsxAssetDeliveries'); if (dv) dv.addEventListener('click', openDeliveries);
    var btn = document.getElementById('wsxAssetUpload'); var inp = document.getElementById('wsxAssetFile');
    if (btn && inp) {
      btn.addEventListener('click', function () { inp.click(); });
      inp.addEventListener('change', function () { var files = Array.prototype.slice.call(inp.files || []); inp.value = ''; askUploadVisibility(files); });
    }
    ws.querySelectorAll('[data-asset-filter]').forEach(function (c) {
      c.addEventListener('click', function () {
        ws.querySelectorAll('[data-asset-filter]').forEach(function (x) { x.classList.remove('is-on'); });
        c.classList.add('is-on'); assetFilter = c.getAttribute('data-asset-filter'); renderAssets();
      });
    });
  }
  function loadAssets() { wireAssets(); fetchAssets(); }

`;
