/** Admin → Custom domain (add, DNS records, refresh, primary, remove). Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminDomains_JS = `  // Custom domains: add a hostname, show the DNS records to set, refresh status, set primary, remove.
  function adDomains() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    function cdReq(suffix, init) {
      return fetch(wsUrl('/domains' + suffix), Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, init || {}))
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error('x'); e.userMessage = (j && (j.error + (j.hint ? ' ' + j.hint : ''))) || t('admin.saveFailed'); throw e; } return j; }); });
    }
    function badge(st) {
      var cls = st === 'active' ? 'is-on' : st === 'failed' ? 'is-off' : 'is-trial';
      return '<span class="wsx-admin__rolebadge ' + cls + '">' + esc(t('admin.cdStatus_' + st)) + '</span>';
    }
    function paint(res) {
      res = res || {};
      var list = res.domains || [];
      if (res.enabled === false) {
        m.innerHTML = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.cdTitle')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.cdDisabled')) + '</p></div>';
        return;
      }
      var rows = list.map(function (d) {
        var dns = (d.dns || []).map(function (r) {
          return '<div class="wsx-admin__row"><span class="wsx-admin__rolebadge">' + esc(r.type) + '</span>'
            + '<div class="wsx-admin__who"><code class="wsx-admin__inboxaddr">' + esc(r.name) + '</code><span class="wsx-admin__sub">→ <code>' + esc(r.value) + '</code></span></div>'
            + '<button class="wsx-abtn" data-cd-copy="' + esc(r.value) + '" type="button">' + esc(t('admin.copyAddress')) + '</button></div>';
        }).join('');
        var steps = d.status === 'active' ? '' : '<ol class="wsx-lens__intro">' + (d.instructions || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' + dns;
        return '<div class="wsx-admin__settings-section" data-cd="' + esc(d.id) + '">'
          + '<div class="wsx-admin__row"><div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(d.hostname) + (d.is_primary ? ' · ' + esc(t('admin.cdPrimary')) : '') + '</span>'
          + '<span class="wsx-admin__sub">' + (d.last_checked_at ? esc(t('admin.cdChecked')) + ' ' + adRelDate(d.last_checked_at) : esc(t('admin.cdNotChecked'))) + (d.last_error && d.status !== 'active' ? ' · ' + esc(d.last_error) : '') + '</span></div>'
          + badge(d.status)
          + (d.status !== 'active' ? '<button class="wsx-abtn" data-cd-refresh="' + esc(d.id) + '" type="button">' + esc(t('admin.cdRefresh')) + '</button>' : '')
          + (d.status === 'active' && !d.is_primary ? '<button class="wsx-abtn" data-cd-primary="' + esc(d.id) + '" type="button">' + esc(t('admin.cdMakePrimary')) + '</button>' : '')
          + '<button class="wsx-abtn danger" data-cd-rm="' + esc(d.id) + '" data-cd-host="' + esc(d.hostname) + '" type="button">' + esc(t('admin.remove')) + '</button></div>'
          + steps + '</div>';
      }).join('');
      m.innerHTML = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.cdTitle')) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(t('admin.cdIntro').replace('{target}', res.cname_target || '')) + '</p>'
        + (res.mode === 'manual' ? '<p class="wsx-lens__intro">' + esc(t('admin.cdManual')) + '</p>' : '')
        + '<div class="wsx-admin__domain-add"><input class="wsx-admin__email" id="wsxCdInput" type="text" placeholder="portal.acme.example" style="max-width:260px">'
        + '<button class="wsx-abtn" id="wsxCdAdd" type="button">' + esc(t('admin.cdAdd')) + '</button><span class="wsx-admin__savemsg" id="wsxCdMsg"></span></div></div>'
        + (list.length ? rows : i18nEmpty('admin.cdNone'));
      var msg = document.getElementById('wsxCdMsg');
      function act(btn, p) {
        adBusy(btn); if (msg) msg.textContent = '';
        p.then(function () { delete adDataCache['domains']; adDomains(); })
          .catch(function (e) { adIdle(btn); if (msg) msg.textContent = (e && e.userMessage) || t('admin.saveFailed'); });
      }
      var add = document.getElementById('wsxCdAdd');
      var inp = document.getElementById('wsxCdInput');
      add.addEventListener('click', function () {
        var h = (inp.value || '').trim(); if (!h) return;
        act(add, cdReq('', { method: 'POST', body: JSON.stringify({ hostname: h }) }));
      });
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') add.click(); });
      m.querySelectorAll('[data-cd-refresh]').forEach(function (b) { b.addEventListener('click', function () { act(b, cdReq('/' + encodeURIComponent(b.getAttribute('data-cd-refresh')) + '/refresh', { method: 'POST' })); }); });
      m.querySelectorAll('[data-cd-primary]').forEach(function (b) { b.addEventListener('click', function () { act(b, cdReq('/' + encodeURIComponent(b.getAttribute('data-cd-primary')), { method: 'PATCH', body: JSON.stringify({ primary: true }) })); }); });
      m.querySelectorAll('[data-cd-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm(t('admin.cdConfirmRemove').replace('{host}', b.getAttribute('data-cd-host') || ''))) return;
          act(b, cdReq('/' + encodeURIComponent(b.getAttribute('data-cd-rm')), { method: 'DELETE' }));
        });
      });
      m.querySelectorAll('[data-cd-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
          navigator.clipboard.writeText(b.getAttribute('data-cd-copy') || '').then(function () { b.textContent = t('admin.copied'); setTimeout(function () { b.textContent = t('admin.copyAddress'); }, 1500); }).catch(function () {});
        });
      });
    }
    swr('domains', paint, function () { return cdReq('?refresh=1'); });
  }
`;
