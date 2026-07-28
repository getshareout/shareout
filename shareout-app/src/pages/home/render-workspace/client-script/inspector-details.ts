/** Inspector Details helpers (toast, section-order persistence, About/Deliver builders, drag-reorder).
 *  Extracted from inspector.ts to stay under the module line cap; shares the workspace IIFE scope,
 *  so it must be composed alongside inspector.ts (see client-script/index.ts). */
export const workspace_client_inspector_details_JS = `  // ===== Inspector Details helpers =====
  var GRIP_SVG = '<svg viewBox="0 0 16 16" width="14" height="16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="6" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="10" cy="12" r="1.4"/></svg>';

  // Section order is user-reorderable and persisted globally (all artifacts share one order).
  var SEC_ORDER_KEY = 'wsx.inspector.sections';
  var DEFAULT_SEC_ORDER = ['share', 'deliver', 'about', 'description', 'tags', 'folder', 'tests', 'analytics', 'watches'];
  function loadSecOrder() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(SEC_ORDER_KEY) || '[]'); } catch (e) { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    var out = saved.filter(function (k) { return DEFAULT_SEC_ORDER.indexOf(k) >= 0; });
    DEFAULT_SEC_ORDER.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); }); // new sections append
    return out;
  }
  function saveSecOrder(order) { try { localStorage.setItem(SEC_ORDER_KEY, JSON.stringify(order)); } catch (e) {} }

  function sec(key, labelText, helpText, body, draggable) {
    var grip = draggable ? '<button class="wsx-det__grip" type="button" draggable="true" aria-label="' + esc(t('inspector.dragHint')) + '" data-tip="' + esc(t('inspector.dragHint')) + '">' + GRIP_SVG + '</button>' : '';
    var help = helpText ? '<button class="wsx-det__help" type="button" aria-label="' + esc(helpText) + '" data-tip="' + esc(helpText) + '">?</button>' : '';
    return '<div class="wsx-det__sec" data-sec="' + key + '"><div class="wsx-det__label">' + grip + '<span class="wsx-det__labeltxt">' + esc(labelText) + '</span>' + help + '</div>' + body + '</div>';
  }

  // About → compact meta pills (was a 7-row key/value table).
  function aboutHtml(meta, type, vis) {
    function pill(inner, tip) { return '<span class="wsx-det__mpill"' + (tip ? ' data-tip="' + esc(tip) + '"' : '') + '>' + inner + '</span>'; }
    var h = pill('<span class="dot" style="background:' + (meta.paused ? 'var(--color-warning)' : 'var(--color-success)') + '"></span>' + esc(meta.paused ? t('inspector.statusPaused') : t('inspector.statusActive')));
    if (type) h += pill(esc(String(type).toUpperCase()), t('inspector.metaTypeTip'));
    h += pill('v' + (meta.current_version || 1));
    var upd = fmtDate(meta.updated_at);
    h += pill(esc(t('inspector.updatedShort').replace('{d}', upd)), t('inspector.metaDatesTip').replace('{c}', fmtDate(meta.created_at)).replace('{u}', upd));
    if (vis !== 'public' && meta.auth_method) {
      var authLabel = meta.auth_method === 'google' ? t('inspector.authGoogle') : (meta.auth_method === 'password' ? t('inspector.authPassword') : meta.auth_method);
      h += pill('<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' + esc(authLabel));
    }
    if (meta.embed_allowed) h += pill(esc(t('inspector.embedsOn')));
    return '<div class="wsx-det__meta">' + h + '</div>';
  }

  // Deliver → destination tiles + a per-destination body (recipient/send, or a Connect prompt).
  function deliverHtml() {
    return '<div class="wsx-det__dests" role="radiogroup" aria-label="' + esc(t('inspector.deliver')) + '">'
      + '<button class="wsx-det__dest" data-dest="Slack" role="radio" aria-checked="false" type="button"><img class="wsx-det__destlogo" src="/brand/slack-icon.png" alt="" width="22" height="22" decoding="async">Slack</button>'
      + '<button class="wsx-det__dest" data-dest="Telegram" role="radio" aria-checked="false" type="button"><img class="wsx-det__destlogo" src="/brand/telegram-icon.png" alt="" width="22" height="22" decoding="async">Telegram</button>'
      + '<button class="wsx-det__dest" data-dest="Email" role="radio" aria-checked="false" type="button">' + isvg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>') + 'Email</button>'
      + '</div>'
      + '<div class="wsx-det__delbody" id="wsxDelBody"></div>';
  }

  // One toast, reused for invites + deliver. Body-appended so it never clips.
  var toastEl = null, toastTmr = null;
  function wsxToast(text, isError) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'wsx-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); toastEl.addEventListener('click', function () { toastEl.classList.remove('is-show'); }); }
    toastEl.classList.toggle('is-error', !!isError);
    var check = isError ? '' : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    toastEl.innerHTML = check + '<span></span>';
    toastEl.querySelector('span').textContent = text;
    toastEl.classList.add('is-show');
    if (toastTmr) clearTimeout(toastTmr);
    toastTmr = setTimeout(function () { if (toastEl) toastEl.classList.remove('is-show'); }, 3500);
  }
  // Live drag-reorder of sections; persists the resulting order on drop.
  function wireSecDnd(root) {
    var cont = root.querySelector('#wsxSecs'); if (!cont) return;
    var dragging = null;
    function afterEl(y) {
      var els = [].slice.call(cont.querySelectorAll('.wsx-det__sec:not(.is-dragging)'));
      var best = { off: -Infinity, el: null };
      els.forEach(function (c) { var box = c.getBoundingClientRect(); var off = y - box.top - box.height / 2; if (off < 0 && off > best.off) best = { off: off, el: c }; });
      return best.el;
    }
    cont.querySelectorAll('.wsx-det__grip').forEach(function (g) {
      g.addEventListener('dragstart', function (e) { dragging = g.closest('.wsx-det__sec'); dragging.classList.add('is-dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging.getAttribute('data-sec')); } catch (_) {} });
      g.addEventListener('dragend', function () {
        if (dragging) dragging.classList.remove('is-dragging');
        dragging = null;
        var order = [].slice.call(cont.querySelectorAll('.wsx-det__sec')).map(function (s) { return s.getAttribute('data-sec'); });
        if (order.length === DEFAULT_SEC_ORDER.length) saveSecOrder(order); // only persist the full set
      });
    });
    cont.addEventListener('dragover', function (e) {
      if (!dragging) return; e.preventDefault();
      var after = afterEl(e.clientY);
      if (after == null) cont.appendChild(dragging); else cont.insertBefore(dragging, after);
    });
  }

  function copyText(txt, btn) {
    var done = function () { btn.classList.add('is-on'); setTimeout(function () { btn.classList.remove('is-on'); }, 1100); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(function () {});
    else { var i = document.createElement('input'); i.value = txt; document.body.appendChild(i); i.select(); try { document.execCommand('copy'); done(); } catch (e) {} i.remove(); }
  }
  function toggleFav(id, btn) {
    var on = btn.classList.contains('is-on');
    btn.classList.toggle('is-on', !on);
    if (metaCache[id]) metaCache[id].is_favorite = on ? 0 : 1;
    fetch('/v1/artifacts/' + encodeURIComponent(id) + '/favorite', { method: on ? 'DELETE' : 'POST', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('failed'); })
      .catch(function () { btn.classList.toggle('is-on', on); if (metaCache[id]) metaCache[id].is_favorite = on ? 1 : 0; try { wsxToast('Couldn\\u2019t update favorite', true); } catch (e) {} });
  }
  function trashArtifact(art) {
    if (!window.confirm(t('inspector.trashConfirm').replace('{name}', art.name || 'this page'))) return;
    fetch('/v1/artifacts/' + encodeURIComponent(art.id), { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) { if (r.ok) closeTab(art.key); });
  }

  // ----- Watches (metric_watches via /v1/metric-watch). No table-list plumbing —
  // table is free text; a bad table/column name surfaces as a toast from the API. -----
  function watchMetricLabel(w) { return w.metric_kind === 'sum' ? 'sum(' + w.column_name + ')' : (w.metric_kind === 'last' ? w.column_name : t('inspector.watchKind.count')); }
  function watchRow(w) {
    return '<div class="wsx-row"><div class="wsx-row__main"><div class="wsx-row__title">' + esc(w.table_name) + ' \\u00B7 ' + esc(watchMetricLabel(w)) + '</div><div class="wsx-row__sub">' + esc(t('inspector.watchThreshold').replace('{n}', w.threshold_pct)) + '</div></div>'
      + '<button class="wsx-det__icon is-danger" data-wdel="' + esc(w.id) + '" type="button" data-tip="' + esc(t('inspector.act.trash')) + '" aria-label="' + esc(t('inspector.act.trash')) + '">' + isvg(SVG_TRASH) + '</button></div>';
  }
  function watchFormHtml() {
    var kinds = ['count', 'sum', 'last'].map(function (k) { return '<option value="' + k + '">' + esc(t('inspector.watchKind.' + k)) + '</option>'; }).join('');
    return '<div class="wsx-list" id="wsxWForm">'
      + '<input class="wsx-share__search" id="wsxWTable" placeholder="' + esc(t('inspector.watchTablePh')) + '" autocomplete="off">'
      + '<select class="wsx-share__search" id="wsxWKind">' + kinds + '</select>'
      + '<input class="wsx-share__search" id="wsxWColumn" placeholder="' + esc(t('inspector.watchColumnPh')) + '" autocomplete="off" hidden>'
      + '<input class="wsx-share__search" id="wsxWThreshold" type="number" min="1" placeholder="20">'
      + '<button class="wsx-abtn wsx-abtn--block" id="wsxWAdd" type="button">' + esc(t('inspector.watchAdd')) + '</button>'
      + '</div>';
  }
  function loadWatches(art, box) {
    fetch('/v1/metric-watch?artifact_id=' + encodeURIComponent(art.id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { paintWatches(art, box, (d && d.watches) || []); })
      .catch(function () { paintWatches(art, box, []); });
  }
  function paintWatches(art, box, watches) {
    var listH = watches.length ? '<div class="wsx-list">' + watches.map(watchRow).join('') + '</div>' : '<div class="wsx-tests__off">' + esc(t('inspector.watchesEmpty')) + '</div>';
    box.innerHTML = listH + watchFormHtml();
    box.querySelectorAll('[data-wdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        fetch('/v1/metric-watch/' + encodeURIComponent(b.getAttribute('data-wdel')), { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (!j || !j.success) { b.disabled = false; try { wsxToast(t('inspector.watchDeleteFailed'), true); } catch (e) {} return; } loadWatches(art, box); })
          .catch(function () { b.disabled = false; try { wsxToast(t('inspector.watchDeleteFailed'), true); } catch (e) {} });
      });
    });
    var kindSel = box.querySelector('#wsxWKind'), colInp = box.querySelector('#wsxWColumn');
    function syncCol() { colInp.hidden = kindSel.value === 'count'; }
    kindSel.addEventListener('change', syncCol); syncCol();
    box.querySelector('#wsxWAdd').addEventListener('click', function () {
      var btn = box.querySelector('#wsxWAdd');
      var table = box.querySelector('#wsxWTable').value.trim();
      var column = colInp.value.trim();
      var threshold = box.querySelector('#wsxWThreshold').value.trim();
      if (!table) { try { wsxToast(t('inspector.watchTableRequired'), true); } catch (e) {} return; }
      var body = { artifact_id: art.id, table: table, kind: kindSel.value };
      if (column) body.column = column;
      if (threshold) body.threshold_pct = Number(threshold);
      btn.disabled = true;
      fetch('/v1/metric-watch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (!res.ok || !res.j || !res.j.watch) { btn.disabled = false; try { wsxToast((res.j && res.j.error) || t('inspector.watchAddFailed'), true); } catch (e) {} return; } loadWatches(art, box); })
        .catch(function () { btn.disabled = false; try { wsxToast(t('inspector.watchAddFailed'), true); } catch (e) {} });
    });
  }
  function renderWatches(art) {
    var box = rbodyEl.querySelector('#wsxWatches'); if (!box || !art.id) return;
    box.innerHTML = i18nLoad();
    loadWatches(art, box);
  }

`;
