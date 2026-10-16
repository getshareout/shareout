/** Inspector History panel: version list, line diff, preview, restore. Shares the inspector IIFE scope. */
export const workspace_client_inspector_history_JS = `  // ----- History (/v1/artifacts/:id/versions) -----
  var histCache = {}, srcCache = {};
  function fmtBytes(n) { if (n == null) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
  function histWho(v) { return v.created_by_name || v.created_by_email || t('inspector.histUnknown'); }
  function histSource(s) { return s ? tOr('inspector.histSrc.' + s, s) : ''; }
  function renderHistory(art) {
    // Paint the cached list at once, then refetch: a publish elsewhere adds versions.
    var had = histCache[art.id];
    if (had) paintHistory(art, had); else rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
    fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/versions', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 403) return { denied: true };
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (activeArt !== art || rActive !== 'history') return;
        if (d.denied) { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.histNoAccess') + '</div>'; return; }
        histCache[art.id] = d;
        if (rActive === 'history' && (!had || JSON.stringify(had) !== JSON.stringify(d))) paintHistory(art, d);
      })
      .catch(function () { if (activeArt === art && !had) railRetry('inspector.histFailed', function () { renderHistory(art); }); });
  }
  function histRow(v, prev, live, editable) {
    var delta = prev && v.size_bytes != null && prev.size_bytes != null ? v.size_bytes - prev.size_bytes : null;
    var sub = [esc(histWho(v)), esc(histSource(v.source)), esc(adRelDate(v.created_at))].filter(Boolean).join(' \\u00B7 ');
    var note = v.restored_from_version_no ? t('inspector.histRestoredFrom').replace('{n}', String(v.restored_from_version_no)) : '';
    if (v.message) note = note ? note + ' \\u2014 ' + v.message : v.message;
    var size = v.size_bytes != null ? fmtBytes(v.size_bytes) + (delta ? ' (' + (delta > 0 ? '+' : '\\u2212') + fmtBytes(Math.abs(delta)) + ')' : '') : '';
    return '<div class="wsx-vh__row' + (live ? ' is-live' : '') + '" data-vno="' + v.version_no + '">'
      + '<div class="wsx-vh__top"><span class="wsx-vh__no">v' + v.version_no + '</span>'
      + (live ? '<span class="wsx-row__badge ok">' + esc(t('inspector.histLive')) + '</span>' : '')
      + '<span class="wsx-vh__size">' + esc(size) + '</span></div>'
      + '<div class="wsx-row__sub">' + sub + '</div>'
      + (note ? '<div class="wsx-vh__note">' + esc(note) + '</div>' : '')
      + '<div class="wsx-vh__acts">'
      + (prev ? '<button class="wsx-link" type="button" data-vh="diff">' + esc(t('inspector.histChanges')) + '</button>' : '')
      + '<button class="wsx-link" type="button" data-vh="preview">' + esc(t('inspector.histPreview')) + '</button>'
      + (editable && !live ? '<button class="wsx-link" type="button" data-vh="restore">' + esc(t('inspector.histRestore')) + '</button>' : '')
      + '</div></div>';
  }
  function paintHistory(art, d) {
    var vs = d.versions || [], editable = !!(metaCache[art.id] && metaCache[art.id].can_edit);
    if (!metaCache[art.id]) fetchMeta(art, function (m) { if (m && metaCache[art.id] && activeArt === art && rActive === 'history') paintHistory(art, histCache[art.id] || d); });
    if (!vs.length) { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.histEmpty') + '</div>'; return; }
    var opts = function (sel) { return vs.map(function (v) { return '<option value="' + v.version_no + '"' + (v.version_no === sel ? ' selected' : '') + '>v' + v.version_no + '</option>'; }).join(''); };
    var h = '<div class="wsx-vh">';
    if (vs.length > 1) {
      h += '<div class="wsx-vh__cmp"><select class="wsx-field__in" id="wsxVhFrom" aria-label="' + esc(t('inspector.histFrom')) + '">' + opts(vs[1].version_no) + '</select>'
        + '<span aria-hidden="true">\\u2192</span><select class="wsx-field__in" id="wsxVhTo" aria-label="' + esc(t('inspector.histTo')) + '">' + opts(vs[0].version_no) + '</select>'
        + '<button class="wsx-abtn" type="button" id="wsxVhCmp">' + esc(t('inspector.histCompare')) + '</button></div>';
    }
    h += '<div class="wsx-vh__list">' + vs.map(function (v, i) { return histRow(v, vs[i + 1], v.id === d.live_version_id, editable); }).join('') + '</div>';
    if (vs.length >= 50) h += '<div class="wsx-row__sub wsx-vh__more">' + esc(t('inspector.histLimit')) + '</div>';
    rbodyEl.innerHTML = h + '</div>';
    var cmp = rbodyEl.querySelector('#wsxVhCmp');
    if (cmp) cmp.addEventListener('click', function () {
      var a = +rbodyEl.querySelector('#wsxVhFrom').value, b = +rbodyEl.querySelector('#wsxVhTo').value;
      if (a !== b) openVersionDiff(art, Math.min(a, b), Math.max(a, b));
    });
    rbodyEl.querySelectorAll('[data-vh]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = b.closest('[data-vno]'), no = +row.getAttribute('data-vno'), k = b.getAttribute('data-vh');
        var idx = vs.findIndex(function (v) { return v.version_no === no; });
        if (k === 'diff') openVersionDiff(art, vs[idx + 1].version_no, no);
        else if (k === 'preview') openVersionPreview(art, no);
        else restoreVersion(art, no, b);
      });
    });
  }
  function versionSource(art, no) {
    var key = art.id + ':' + no;
    if (srcCache[key]) return Promise.resolve(srcCache[key]);
    return fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/versions/' + no + '/source', { credentials: 'same-origin' })
      .then(okOr).then(function (r) { return r.json(); })
      .then(function (d) { srcCache[key] = d; return d; });
  }
  function restoreVersion(art, no, btn) {
    if (!window.confirm(t('inspector.histRestoreConfirm').replace(/\\{n\\}/g, String(no)))) return;
    if (btn) btn.disabled = true;
    return fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/versions/' + no + '/restore', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(okOr).then(function (r) { return r.json(); })
      .then(function (d) {
        delete histCache[art.id]; delete metaCache[art.id];
        closeVersionModal();
        if (window.showToast) window.showToast(t(d.staged ? 'inspector.histRestoredStaged' : 'inspector.histRestored').replace('{n}', String(d.version_no)).replace('{m}', String(no)), 'success');
        var rec = panes[activeKey];
        if (rec && rec.art === art && rec.iframe && !d.staged) paintStage(rec);
        if (activeArt === art && rActive === 'history') renderHistory(art);
      })
      .catch(function (err) { if (btn) btn.disabled = false; failToast(err, t('inspector.histRestoreFailed')); });
  }
  // Line diff: trim the shared head/tail, LCS on the middle (block replace when too big).
  function lineDiff(a, b) {
    var A = a.split('\\n'), B = b.split('\\n'), out = [], p = 0, ea = A.length, eb = B.length, i, j;
    while (p < ea && p < eb && A[p] === B[p]) { out.push([' ', A[p]]); p++; }
    while (ea > p && eb > p && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    var n = ea - p, m = eb - p, W = m + 1;
    if (n * m > 4000000) {
      for (i = p; i < ea; i++) out.push(['-', A[i]]);
      for (j = p; j < eb; j++) out.push(['+', B[j]]);
    } else {
      var dp = new Uint32Array((n + 1) * W);
      for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
        dp[i * W + j] = A[p + i] === B[p + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      i = 0; j = 0;
      while (i < n && j < m) {
        if (A[p + i] === B[p + j]) { out.push([' ', A[p + i]]); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { out.push(['-', A[p + i]]); i++; }
        else { out.push(['+', B[p + j]]); j++; }
      }
      for (; i < n; i++) out.push(['-', A[p + i]]);
      for (; j < m; j++) out.push(['+', B[p + j]]);
    }
    for (i = ea; i < A.length; i++) out.push([' ', A[i]]);
    return out;
  }
  function diffHtml(ops) {
    var CTX = 3, rows = [], folds = [], o = 0, nw = 0, k = 0;
    function line(op) {
      if (op[0] !== '+') o++; if (op[0] !== '-') nw++;
      var cls = op[0] === '+' ? ' k-add' : op[0] === '-' ? ' k-del' : '';
      return '<div class="wsx-vd__ln' + cls + '"><span class="wsx-vd__no">' + (op[0] === '+' ? '' : o) + '</span><span class="wsx-vd__no">' + (op[0] === '-' ? '' : nw) + '</span><span class="wsx-vd__mk">' + (op[0] === ' ' ? '' : op[0] === '-' ? '\\u2212' : '+') + '</span><code>' + esc(op[1]) + '</code></div>';
    }
    while (k < ops.length) {
      if (ops[k][0] !== ' ') { rows.push(line(ops[k])); k++; continue; }
      var s = k; while (k < ops.length && ops[k][0] === ' ') k++;
      var head = s === 0 ? 0 : CTX, tail = k === ops.length ? 0 : CTX;
      if (k - s <= head + tail + 1) { for (var x = s; x < k; x++) rows.push(line(ops[x])); continue; }
      for (var y = s; y < s + head; y++) rows.push(line(ops[y]));
      var hidden = []; for (var z = s + head; z < k - tail; z++) hidden.push(line(ops[z]));
      folds.push(hidden.join(''));
      rows.push('<button class="wsx-vd__fold" type="button" data-fold="' + (folds.length - 1) + '">' + esc(t('inspector.histUnchanged').replace('{n}', String(hidden.length))) + '</button>');
      for (var w = k - tail; w < k; w++) rows.push(line(ops[w]));
    }
    return { html: rows.join(''), folds: folds };
  }
  function closeVersionModal() { var m = document.getElementById('wsxVhModal'); if (m) m.remove(); }
  function versionModal(title, body, foot) {
    closeVersionModal();
    var m = document.createElement('div');
    m.id = 'wsxVhModal'; m.className = 'so-c-modal-overlay wsx-vd-overlay'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="so-c-modal wsx-vd"><div class="so-c-modal__head"><span class="so-c-modal__title">' + esc(title) + '</span><button type="button" class="so-c-modal__close" data-vd-close aria-label="' + esc(t('inspector.closeTab')) + '">&times;</button></div>'
      + '<div class="so-c-modal__body wsx-vd__body">' + body + '</div>' + (foot ? '<div class="so-c-modal__foot wsx-vd__foot">' + foot + '</div>' : '') + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-vd-close]')) closeVersionModal(); });
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeVersionModal(); });
    document.body.appendChild(m);
    m.querySelector('[data-vd-close]').focus();
    return m;
  }
  function versionFoot(art, no) {
    var live = histCache[art.id] && (histCache[art.id].versions || []).some(function (v) { return v.version_no === no && v.id === histCache[art.id].live_version_id; });
    var editable = !!(metaCache[art.id] && metaCache[art.id].can_edit);
    return (editable && !live ? '<button class="so-c-btn so-c-btn--primary so-c-btn--sm" type="button" data-vd-restore="' + no + '">' + esc(t('inspector.histRestoreN').replace('{n}', String(no))) + '</button>' : '');
  }
  function wireFoot(m, art) {
    var r = m.querySelector('[data-vd-restore]');
    if (r) r.addEventListener('click', function () { restoreVersion(art, +r.getAttribute('data-vd-restore'), r); });
    var p = m.querySelector('[data-vd-preview]');
    if (p) p.addEventListener('click', function () { openVersionPreview(art, +p.getAttribute('data-vd-preview')); });
  }
  function openVersionDiff(art, from, to) {
    var title = t('inspector.histDiffTitle').replace('{a}', String(from)).replace('{b}', String(to));
    var m = versionModal(title, i18nLoad(), '');
    Promise.all([versionSource(art, from), versionSource(art, to)]).then(function (res) {
      if (!document.body.contains(m)) return;
      var ops = lineDiff(res[0].content || '', res[1].content || '');
      var add = 0, del = 0; ops.forEach(function (op) { if (op[0] === '+') add++; else if (op[0] === '-') del++; });
      var d = diffHtml(ops);
      var stats = '<div class="wsx-vd__stats"><span class="k-add">+' + add + '</span> <span class="k-del">\\u2212' + del + '</span> ' + esc(t('inspector.histLines'))
        + (res[0].truncated || res[1].truncated ? ' \\u00B7 ' + esc(t('inspector.histTruncated')) : '') + '</div>';
      m.querySelector('.wsx-vd__body').innerHTML = stats + (add || del ? '<div class="wsx-vd__code">' + d.html + '</div>' : i18nEmpty('inspector.histSame'));
      m.querySelectorAll('[data-fold]').forEach(function (f) {
        f.addEventListener('click', function () { var tmp = document.createElement('div'); tmp.innerHTML = d.folds[+f.getAttribute('data-fold')]; f.replaceWith.apply(f, Array.prototype.slice.call(tmp.childNodes)); });
      });
      var foot = '<button class="so-c-btn so-c-btn--secondary so-c-btn--sm" type="button" data-vd-preview="' + to + '">' + esc(t('inspector.histPreviewN').replace('{n}', String(to))) + '</button>' + versionFoot(art, to);
      var fe = document.createElement('div'); fe.className = 'so-c-modal__foot wsx-vd__foot'; fe.innerHTML = foot;
      m.querySelector('.so-c-modal').appendChild(fe); wireFoot(m, art);
    }).catch(function (err) {
      if (document.body.contains(m)) m.querySelector('.wsx-vd__body').innerHTML = '<div class="wsx-empty">' + esc(errReason(err, t('inspector.histDiffFailed'))) + '</div>';
    });
  }
  function openVersionPreview(art, no) {
    var m = versionModal(t('inspector.histPreviewTitle').replace('{n}', String(no)), i18nLoad(), '');
    versionSource(art, no).then(function (d) {
      if (!document.body.contains(m)) return;
      var base = metaCache[art.id] && metaCache[art.id].url;
      var html = d.content || '';
      if (base && html.indexOf('<base') < 0) html = '<base href="' + esc(base).split('"').join('&quot;') + '">' + html;
      var body = m.querySelector('.wsx-vd__body'); body.classList.add('is-preview'); body.innerHTML = '<div class="wsx-row__sub wsx-vd__hint">' + esc(t('inspector.histPreviewHint')) + '</div>';
      var f = document.createElement('iframe');
      f.className = 'wsx-vd__frame'; f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('title', t('inspector.histPreviewTitle').replace('{n}', String(no)));
      f.srcdoc = html; body.appendChild(f);
      var foot = versionFoot(art, no);
      if (foot) { var fe = document.createElement('div'); fe.className = 'so-c-modal__foot wsx-vd__foot'; fe.innerHTML = foot; m.querySelector('.so-c-modal').appendChild(fe); wireFoot(m, art); }
    }).catch(function (err) {
      if (document.body.contains(m)) m.querySelector('.wsx-vd__body').innerHTML = '<div class="wsx-empty">' + esc(errReason(err, t('inspector.histDiffFailed'))) + '</div>';
    });
  }

`;
