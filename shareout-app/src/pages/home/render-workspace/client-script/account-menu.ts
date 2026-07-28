/** Account menu: workspace switcher + linked accounts + recently deleted. */
export const workspace_client_account_menu_JS = `
  // ===== account menu: workspace switcher + linked accounts + recently deleted =====
  (function () {
    var btn = document.getElementById('wsxAcctBtnMob');
    var menu = document.getElementById('wsxAccPanel');
    var root = document.querySelector('.wsx');
    var closeBtn = document.getElementById('wsxAccClose');
    if (!btn || !menu || !root) return;
    var linkedLoaded = false;
    // The account menu lives inside the right sidebar region — toggling this class
    // reveals it (and forces the rail open on Home, where it is normally 0-width).
    function open() {
      menu.hidden = false; root.classList.add('is-account-open');
      btn.setAttribute('aria-expanded', 'true');
      if (!linkedLoaded) { linkedLoaded = true; loadLinked(); }
    }
    function close() {
      menu.hidden = true; root.classList.remove('is-account-open');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (menu.hidden) open(); else close(); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) close(); });

    function loadLinked() {
      var list = document.getElementById('wsxLinked');
      fetch('/v1/auth/linked-accounts', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.accounts) { list.innerHTML = i18nEmpty('account.couldNotLoadAccounts'); return; }
          if (!d.accounts.length) { list.innerHTML = i18nEmpty('account.noLinked'); return; }
          list.innerHTML = d.accounts.map(function (a) {
            var label = esc(a.email || a.name || a.id);
            var av = a.picture ? '<img src="' + esc(a.picture) + '" alt="">' : esc((a.name || a.email || '?').charAt(0).toUpperCase());
            var tail = a.is_current ? '<span class="wsx-acct-row__tag">' + esc(t('account.thisAccount')) + '</span>'
              : '<button class="wsx-acct-row__unlink" data-unlink="' + esc(a.id) + '" type="button">' + esc(t('account.unlink')) + '</button>';
            return '<div class="wsx-acct-row"><span class="wsx-acct-row__av">' + av + '</span><span class="wsx-acct-row__email">' + label + '</span>' + tail + '</div>';
          }).join('');
          list.querySelectorAll('[data-unlink]').forEach(function (b) {
            b.addEventListener('click', function () { unlink(b.getAttribute('data-unlink')); });
          });
        })
        .catch(function () { list.innerHTML = i18nEmpty('account.couldNotLoadAccounts'); });
    }
    function unlink(id) {
      if (!window.confirm(t('account.unlinkConfirm'))) return;
      fetch('/v1/auth/linked-accounts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok) loadLinked(); else showToast('Couldn\\u2019t unlink account', 'error'); })
        .catch(function () { showToast('Couldn\\u2019t unlink account', 'error'); });
    }

    // Switch space: subdomain-based in prod; degrades to apex Personal on localhost.
    function spaceUrl(space, slug) {
      var h = location.hostname, proto = location.protocol;
      if (h === 'localhost' || /^[0-9.]+$/.test(h)) return location.origin + '/home?next=1';
      var parts = h.split('.'); var base = parts.length > 2 ? parts.slice(1).join('.') : h;
      if (space && slug) return proto + '//' + slug + '.' + base + '/home?next=1';
      return proto + '//' + base + '/home?next=1';
    }
    menu.querySelectorAll('.wsx-space').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('is-active')) { close(); return; }
        location.href = spaceUrl(b.getAttribute('data-space') || '', b.getAttribute('data-slug') || '');
      });
    });

    // Recently deleted overlay
    var trash = document.getElementById('wsxTrash');
    var trashBtn = document.getElementById('wsxTrashBtn');
    if (trashBtn && trash) {
      trashBtn.addEventListener('click', function () { close(); trash.hidden = false; loadTrash(); });
      var tc = document.getElementById('wsxTrashClose'); if (tc) tc.addEventListener('click', function () { trash.hidden = true; });
      trash.addEventListener('click', function (e) { if (e.target === trash) trash.hidden = true; });
    }
    function trashMeta(until) {
      if (!until) return t('trash.inTrash');
      var ms = (until < 1e12 ? until * 1000 : until) - Date.now();
      var days = Math.max(0, Math.ceil(ms / 86400000));
      if (days <= 0) return t('trash.expiresToday');
      if (days === 1) return t('trash.dayLeft');
      return t('trash.daysLeft').replace('{n}', String(days));
    }
    function loadTrash() {
      var list = document.getElementById('wsxTrashList');
      list.innerHTML = i18nLoad();
      fetch('/v1/artifacts/deleted', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = (d && d.artifacts) || [];
          if (!items.length) { list.innerHTML = i18nEmpty('trash.nothing'); return; }
          var rows = items.map(function (a) {
            return '<div class="wsx-trash-item"><div class="wsx-trash-item__main"><div class="wsx-trash-item__name">' + esc(a.name || t('trash.untitled')) + '</div><div class="wsx-trash-item__meta">' + esc(trashMeta(a.recoverable_until)) + '</div></div><button class="wsx-trash-restore" data-restore="' + esc(a.id) + '" type="button">' + esc(t('trash.restore')) + '</button></div>';
          }).join('');
          list.innerHTML = '<button class="wsx-trash-restore-all" id="wsxTrashRestoreAll" type="button">' + esc(t('trash.restoreAll')) + '</button>' + rows;
          list.querySelectorAll('[data-restore]').forEach(function (b) { b.addEventListener('click', function () { restore(b); }); });
          var restoreAllBtn = document.getElementById('wsxTrashRestoreAll');
          if (restoreAllBtn) restoreAllBtn.addEventListener('click', function () { restoreAll(items.length); });
        })
        .catch(function () { list.innerHTML = i18nEmpty('common.couldNotLoad'); });
    }
    function restore(b) {
      b.disabled = true; b.textContent = t('trash.restoring');
      fetch('/v1/artifacts/' + encodeURIComponent(b.getAttribute('data-restore')) + '/restore', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('failed'); return r.json(); })
        .then(function () { var row = b.closest('.wsx-trash-item'); if (row) row.remove(); })
        .catch(function () { b.disabled = false; b.textContent = t('trash.restore'); showToast('Couldn\\u2019t restore', 'error'); });
    }
    function restoreAll(n) {
      if (!window.confirm(t('trash.restoreAllConfirm').replace('{n}', String(n)))) return;
      fetch('/v1/artifacts/deleted/restore-all', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('failed'); return r.json(); })
        .then(function () { loadTrash(); })
        .catch(function () { showToast('Couldn\\u2019t restore', 'error'); });
    }
  })();

`;
