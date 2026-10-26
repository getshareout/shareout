/** Inspector Details helpers (toast, section-order persistence, About/Deliver builders, drag-reorder).
 *  Extracted from inspector.ts to stay under the module line cap; shares the workspace IIFE scope,
 *  so it must be composed alongside inspector.ts (see client-script/index.ts). */
export const workspace_client_inspector_details_JS = `  // ===== Inspector Details helpers =====
  // Sections: fixed most→least important order, collapsible, open state remembered per user.
  var SEC_OPEN_KEY = 'wsx.inspector.open', SEC_OPEN = ['share', 'approvals', 'pages'];
  try { var so = JSON.parse(localStorage.getItem(SEC_OPEN_KEY) || 'null'); if (Array.isArray(so)) SEC_OPEN = so; } catch (e) {}
  // [icon path, tone] — tone colors the section chip (p primary, s success, w warning, n neutral).
  var SEC_IC = {
    share: ['<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 11h5M19.5 8.5v5"/>', 'p'],
    approvals: ['<path d="M20 6 9 17l-5-5"/>', 's'],
    pages: ['<path d="M4 4h16v16H4z"/><path d="M4 9h16"/>', 'n'],
    organize: ['<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 'n'],
    analytics: ['<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 'p'],
    tests: ['<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>', 'w'],
    knowledge: ['<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/>', 'p']
  };
  function sec(key, labelText, helpText, body) {
    var help = helpText ? '<button class="wsx-det__help" type="button" aria-label="' + esc(helpText) + '" data-tip="' + esc(helpText) + '">?</button>' : '';
    var ic = SEC_IC[key] ? '<span class="wsx-det__secic t-' + SEC_IC[key][1] + '">' + isvg(SEC_IC[key][0]) + '</span>' : '';
    return '<details class="wsx-det__sec" data-sec="' + key + '"' + (SEC_OPEN.indexOf(key) >= 0 ? ' open' : '') + '><summary class="wsx-det__label">' + ic + '<span class="wsx-det__labeltxt">' + esc(labelText) + '</span>' + help + '</summary><div class="wsx-det__secbody">' + body + '</div></details>';
  }
  function wireSecs(root) {
    root.addEventListener('click', function (e) { if (e.target.closest('.wsx-det__help')) e.preventDefault(); });
    root.addEventListener('toggle', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-sec'); if (!k) return;
      SEC_OPEN = SEC_OPEN.filter(function (x) { return x !== k; }); if (e.target.open) SEC_OPEN.push(k);
      try { localStorage.setItem(SEC_OPEN_KEY, JSON.stringify(SEC_OPEN)); } catch (e2) {}
    }, true);
  }

  // Meta line under the title: owner · version · updated (created on hover), then status chips.
  function aboutHtml(meta, type, vis) {
    var own = meta.owner && (meta.owner.name || meta.owner.email), upd = fmtDate(meta.updated_at);
    var line = [own ? esc(t('inspector.byOwner').replace('{who}', own)) : '', 'v' + (meta.current_version || 1), '<span data-tip="' + esc(t('inspector.metaDatesTip').replace('{c}', fmtDate(meta.created_at)).replace('{u}', upd)) + '">' + esc(t('inspector.updatedShort').replace('{d}', upd)) + '</span>'].filter(Boolean).join(' \\u00B7 ');
    function pill(inner, cls) { return '<span class="wsx-det__mpill' + (cls ? ' ' + cls : '') + '">' + inner + '</span>'; }
    var h = pill('<span class="dot"></span>' + esc(meta.paused ? t('inspector.statusPaused') : t('inspector.statusActive')), meta.paused ? 'is-warn' : 'is-ok');
    if (type) h += pill(esc(String(type).toUpperCase()));
    if (vis !== 'public' && meta.auth_method) h += pill(esc(meta.auth_method === 'google' ? t('inspector.authGoogle') : (meta.auth_method === 'password' ? t('inspector.authPassword') : meta.auth_method)));
    if (meta.embed_allowed) h += pill(esc(t('inspector.embedsOn')));
    return '<div class="wsx-det__metaline">' + line + '</div><div class="wsx-det__meta">' + h + '</div>' + liveChangeHtml(meta);
  }
  function liveChangeHtml(meta) {
    if (!meta.live_message) return '';
    var when = meta.updated_at ? adRelDate(meta.updated_at) : '';
    return '<div class="wsx-det__change">' + esc(t('inspector.liveChange').replace('{d}', when)) + ' ' + aiBadge(meta.live_message_source) + esc(meta.live_message) + '</div>';
  }

  // Thin alias over the shared design-system toast (window.showToast).
  function wsxToast(text, isError) { if (typeof window.showToast === 'function') window.showToast(text, isError ? 'error' : 'success'); }
  function copyText(txt, btn) {
    var done = function () { if (btn) { btn.classList.add('is-on'); setTimeout(function () { btn.classList.remove('is-on'); }, 1100); } wsxToast(t('cards.linkCopied')); };
    var fail = function () { wsxToast(t('inspector.copyFailed'), true); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fail);
    else { var i = document.createElement('input'); i.value = txt; document.body.appendChild(i); i.select(); try { if (document.execCommand('copy')) done(); else fail(); } catch (e) { fail(); } i.remove(); }
  }
  function toggleFav(id, btn) {
    var on = btn.classList.contains('is-on');
    function set(v) { btn.classList.toggle('is-on', v); if (metaCache[id]) metaCache[id].is_favorite = v ? 1 : 0; if (typeof applyFavoriteDom === 'function') applyFavoriteDom(id, v); }
    optimistic({
      key: 'fav:' + id,
      apply: function () { set(!on); },
      rollback: function () { set(on); },
      request: function () { return fetch('/v1/artifacts/' + encodeURIComponent(id) + '/favorite', { method: on ? 'DELETE' : 'POST', credentials: 'same-origin' }); },
      error: t('cards.favFailed'),
    });
  }
  // Confirm, then the tab closes at once and the shared card-actions delete takes over
  // (cards leave, "Deleted · Undo" toast, deferred DELETE, rollback on failure).
  function trashArtifact(art) {
    if (!art.id || !window.confirm(t('inspector.trashConfirm').replace('{name}', art.name || t('cards.thisPage')))) return;
    closeTab(art.key);
    // Undo (or a failed DELETE) also brings the closed tab back.
    deleteArtifacts([art.id]).then(function (ok) { if (!ok && art.slug) openArtifact(art.slug, art.name, art.id); });
  }

  // ----- Knowledge from this artifact: notes whose sources include it. The route answers
  // [] when knowledge is off or the viewer may not see it; the section stays hidden then. -----
  function renderKnowledgeFrom(art, meta) {
    var box = rbodyEl.querySelector('#wsxKnFrom'); if (!box) return;
    var secEl = box.closest('.wsx-det__sec'); if (secEl) secEl.hidden = true;
    var wsId = meta && meta.workspace_id;
    if (!art.id || !wsId || wsId !== window.WSX_WS) return;
    fetch('/v1/workspaces/' + encodeURIComponent(wsId) + '/knowledge/from/' + encodeURIComponent(art.id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var notes = (d && d.notes) || [];
        if (!notes.length || !box.isConnected) return;
        box.innerHTML = '<div class="wsx-list">' + notes.map(function (n) {
          return '<a class="wsx-row" href="#l/knowledge/' + encodeURIComponent(n.path) + '"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(n.title || n.path) + '</div><div class="wsx-row__sub">' + esc(n.path) + '</div></div></a>';
        }).join('') + '</div>';
        if (secEl) secEl.hidden = false;
      })
      .catch(function () {});
  }

  // ----- Artifact meta -----
  // GET /v1/artifacts/{id|slug} is the one access check the rail follows: a tab opened by
  // deep link (#a/<slug>) has no id until it resolves; can_edit/can_delete gate controls.
  function adoptMeta(art, d) {
    metaCache[d.id] = d;
    var rec = panes[art.key];
    [art, rec && rec.art].forEach(function (a) {
      if (!a) return;
      a.id = d.id; a.canEdit = !!d.can_edit;
      if (d.artifact_type) a.type = d.artifact_type;
      if (d.name && (!a.name || a.name === t('inspector.artifact'))) a.name = d.name;
    });
    if (rec) setTabLabel(art.key, rec.art.name);
    if (rec && !rec.art.canEdit && rec.mode === 'edit') setEditMode(rec, 'view');
    syncTabMode();
  }
  // One request per artifact in flight: the stage (type) and the rail (details) both ask.
  var metaWait = {};
  function fetchMeta(art, cb) {
    if (art.id && metaCache[art.id]) { cb(metaCache[art.id]); return; }
    var k = art.id || art.slug;
    if (metaWait[k]) { metaWait[k].push([art, cb]); return; }
    metaWait[k] = [[art, cb]];
    function done(d) {
      var waiting = metaWait[k] || []; delete metaWait[k];
      waiting.forEach(function (w) { if (d) adoptMeta(w[0], d); w[1](d); });
    }
    fetch('/v1/artifacts/' + encodeURIComponent(k), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { done(d && d.id ? d : null); })
      .catch(function () { done(null); });
  }

`;
