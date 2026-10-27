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
      showSub(false);
    }
    var accMain = document.getElementById('wsxAccMain'), accSub = document.getElementById('wsxAccSub');
    function showSub(on) {
      if (!accMain || !accSub) return;
      accMain.hidden = on; accSub.hidden = !on;
      accMain.parentNode.classList.toggle('is-sub', on);
      if (on && !linkedLoaded) { linkedLoaded = true; loadLinked(); }
    }
    var moreBtn = document.getElementById('wsxAccMore'), backBtn = document.getElementById('wsxAccBack');
    if (moreBtn) moreBtn.addEventListener('click', function () { showSub(true); });
    if (backBtn) backBtn.addEventListener('click', function () { showSub(false); moreBtn && moreBtn.focus(); });
    function close() {
      menu.hidden = true; root.classList.remove('is-account-open');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (menu.hidden) open(); else close(); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) close(); });
    menu.querySelectorAll('[data-acc-lens]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var lb = document.querySelector('[data-lens="' + a.getAttribute('data-acc-lens') + '"]');
        if (!lb) return;
        e.preventDefault(); close(); lb.click();
      });
    });

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
            b.addEventListener('click', function () { unlink(b.getAttribute('data-unlink'), b.closest('.wsx-acct-row')); });
          });
        })
        .catch(function () { list.innerHTML = i18nEmpty('account.couldNotLoadAccounts'); });
    }
    // Confirm, then the row leaves at once behind an "Unlinked · Undo" toast; the DELETE
    // waits for the undo window and a failure brings the row back.
    function unlink(id, row) {
      if (!window.confirm(t('account.unlinkConfirm'))) return;
      var leaving = null;
      optimistic({
        key: 'unlink:' + id,
        undo: true,
        apply: function () { if (row) leaving = window.soOptimistic.leave(row); },
        rollback: function () { if (leaving) leaving.restore(); },
        request: function () {
          return fetch('/v1/auth/linked-accounts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', keepalive: true })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) { if (!d || !d.ok) throw new Error('unlink'); });
        },
        success: t('account.unlinked'),
        error: t('account.unlinkFailed'),
        done: function () { if (leaving) leaving.commit(); loadLinked(); },
      });
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
    // Restore is optimistic: the row leaves the trash at once; a failure puts it back.
    function restore(b) {
      var id = b.getAttribute('data-restore'), row = b.closest('.wsx-trash-item'), leaving = null;
      optimistic({
        key: 'restore:' + id,
        apply: function () { if (row) leaving = window.soOptimistic.leave(row); },
        rollback: function () { if (leaving) leaving.restore(); },
        request: function () { return fetch('/v1/artifacts/' + encodeURIComponent(id) + '/restore', { method: 'POST', credentials: 'same-origin' }); },
        success: t('trash.restored'),
        error: t('trash.restoreFailed'),
        done: function () {
          if (leaving) leaving.commit();
          if (typeof artCache !== 'undefined') artCache = {};
          var list = document.getElementById('wsxTrashList');
          if (list && !list.querySelector('.wsx-trash-item')) list.innerHTML = i18nEmpty('trash.nothing');
        },
      });
    }
    function restoreAll(n) {
      if (!window.confirm(t('trash.restoreAllConfirm').replace('{n}', String(n)))) return;
      var list = document.getElementById('wsxTrashList');
      optimistic({
        key: 'restore:all',
        apply: function () { if (list) list.innerHTML = i18nEmpty('trash.nothing'); },
        rollback: function () { loadTrash(); },
        request: function () { return fetch('/v1/artifacts/deleted/restore-all', { method: 'POST', credentials: 'same-origin' }); },
        success: t('trash.restoredAll').replace('{n}', String(n)),
        error: t('trash.restoreFailed'),
        done: function () { if (typeof artCache !== 'undefined') artCache = {}; loadTrash(); },
      });
    }
  })();

`;
