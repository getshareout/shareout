/** Right-click (and Shift+F10 / menu key) quick actions on artifact cards and table rows.
 *  Reuses the card-actions globals; role gates match the card hover buttons. */
export const workspace_client_home_views_cardMenu_JS = `
  // ===== artifact context menu (grid + table) =====
  var cmEl = null;
  function cmClose() { if (cmEl) { cmEl.remove(); cmEl = null; } }
  function cmIc(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var CM_IC = {
    open: '<path d="M3 3h18v18H3z"/><path d="M3 9h18"/>',
    tab: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
  };
  function cmInfo(el) {
    var title = el.querySelector('.card-title, .wsx-tr__name');
    return {
      id: el.getAttribute('data-id') || '', slug: el.getAttribute('data-slug') || '',
      name: ((title && title.textContent) || el.getAttribute('data-name') || '').trim(),
      type: el.getAttribute('data-type') || '', url: el.getAttribute('data-url') || '',
      role: el.getAttribute('data-role') || '', fav: el.getAttribute('data-favorite') === '1',
      vis: el.getAttribute('data-visibility') || '', ws: el.getAttribute('data-workspace') || ''
    };
  }
  function cmSetAttr(id, k, v) { artEls(id).forEach(function (el) { el.setAttribute(k, v); }); }
  function cmItems(a) {
    var owner = a.role === 'owner', canEdit = owner || a.role === 'editor';
    var open = function () { openArtifact(a.slug, a.name, a.id, a.type); };
    var items = [
      ['open', t('cmenu.open'), open],
      ['tab', t('cmenu.newTab'), function () { window.open(a.url || ('/a/' + encodeURIComponent(a.slug) + '/'), '_blank', 'noopener'); }],
      canEdit && ['edit', t('cmenu.edit'), function () { open(); var b = document.querySelector('#wsxTabMode [data-mode="edit"]'); if (b) b.click(); }],
      canEdit && ['share', t('cmenu.share'), open],
      ['link', t('assets.copyLink'), function () { copyLink(a.url); }],
      '-',
      ['star', t(a.fav ? 'cmenu.unfav' : 'cmenu.fav'), function () { toggleFavorite(a.id); cmSetAttr(a.id, 'data-favorite', a.fav ? '0' : '1'); }],
      owner && a.ws && (a.vis === 'workspace'
        ? ['lock', t('cmenu.makePrivate'), function () { toggleVisibility(a.id, 'private'); cmSetAttr(a.id, 'data-visibility', 'private'); }]
        : ['people', t('cmenu.shareWs'), function () { toggleVisibility(a.id, 'workspace'); cmSetAttr(a.id, 'data-visibility', 'workspace'); }]),
      owner && ['folder', t('assets.moveToFolder'), function () { openFolderPicker([a.id]); }],
      owner && ['export', t('cards.export'), function () { var l = document.createElement('a'); l.href = '/v1/artifacts/' + encodeURIComponent(a.id) + '/export'; l.download = ''; document.body.appendChild(l); l.click(); l.remove(); }],
      owner && '-',
      owner && ['del', t('common.delete'), function () { confirmDelete(a.id); }, true]
    ];
    return items.filter(Boolean);
  }
  function cmOpen(el, x, y) {
    cmClose();
    var a = cmInfo(el); if (!a.id) return;
    var items = cmItems(a);
    cmEl = document.createElement('div');
    cmEl.className = 'wsx-cmenu'; cmEl.setAttribute('role', 'menu');
    cmEl.innerHTML = items.map(function (it, i) {
      if (it === '-') return '<div class="wsx-cmenu__sep" role="separator"></div>';
      return '<button type="button" role="menuitem" class="wsx-cmenu__it' + (it[3] ? ' is-danger' : '') + '" data-cm="' + i + '">' + cmIc(CM_IC[it[0]]) + '<span>' + esc(it[1]) + '</span></button>';
    }).join('');
    document.body.appendChild(cmEl);
    var w = cmEl.offsetWidth, h = cmEl.offsetHeight;
    cmEl.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    cmEl.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
    cmEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cm]'); if (!b) return;
      var fn = items[Number(b.getAttribute('data-cm'))][2]; cmClose(); fn();
    });
    cmEl.addEventListener('keydown', function (e) {
      var its = Array.prototype.slice.call(cmEl.querySelectorAll('[data-cm]')), i = its.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); cmClose(); el.focus && el.focus(); }
    });
    var first = cmEl.querySelector('[data-cm]'); if (first) first.focus();
  }
  function cmTarget(node) { return node && node.closest ? node.closest('.artifact-card[data-id], .wsx-tr[data-id]') : null; }
  document.addEventListener('contextmenu', function (e) {
    var el = cmTarget(e.target); if (!el) return;
    e.preventDefault(); cmOpen(el, e.clientX, e.clientY);
  });
  document.addEventListener('keydown', function (e) {
    if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    var el = cmTarget(document.activeElement); if (!el) return;
    e.preventDefault(); var r = el.getBoundingClientRect(); cmOpen(el, r.left + 24, r.top + Math.min(r.height, 40));
  });
  document.addEventListener('mousedown', function (e) { if (cmEl && !cmEl.contains(e.target)) cmClose(); }, true);
  window.addEventListener('scroll', cmClose, true);
  window.addEventListener('resize', cmClose);
  window.addEventListener('blur', cmClose);
`;
