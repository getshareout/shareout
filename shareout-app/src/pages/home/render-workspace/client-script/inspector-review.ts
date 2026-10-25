/** Inspector review workflow: open/all filter, resolve/reopen, assign, "on vN" hints and
 *  approvals (Details strip + History). Shares the inspector IIFE scope. */
export const workspace_client_inspector_review_JS = `  // ----- Review (/v1/home/review, /v1/home/comments/resolve|assign, /v1/home/approvals) -----
  var reviewCache = {}, reviewLoading = {}, cmFilter = 'open';
  function loadReview(art, cb) {
    var q = reviewLoading[art.id];
    if (q) { if (cb) q.push(cb); return; }
    q = reviewLoading[art.id] = cb ? [cb] : [];
    fetch('/v1/home/review?artifactId=' + encodeURIComponent(art.id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) { delete reviewLoading[art.id]; reviewCache[art.id] = d || { can_review: false, approvals: [], my_approvals: [] }; q.forEach(function (f) { f(reviewCache[art.id]); }); });
  }
  function ensureReview(art) {
    if (reviewCache[art.id] || !art.id) return;
    loadReview(art, function () { if (activeArt === art && rActive === 'comments' && cmtCache[art.id]) paintComments(art, cmtCache[art.id]); });
  }
  function reviewPost(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(okOr).then(function (r) { return r.json(); });
  }
  function cmFilterRoots(roots) { return cmFilter === 'open' ? roots.filter(function (c) { return !c.resolved; }) : roots; }
  function cmFilterBar(roots) {
    var open = roots.filter(function (c) { return !c.resolved; }).length;
    function b(k, label, n) { return '<button class="wsx-cm__fbtn' + (cmFilter === k ? ' is-on' : '') + '" type="button" data-cmf="' + k + '" aria-pressed="' + (cmFilter === k) + '">' + esc(label) + ' <span>' + n + '</span></button>'; }
    return '<div class="wsx-cm__filter" role="group">' + b('open', t('review.filterOpen'), open) + b('all', t('review.filterAll'), roots.length) + '</div>';
  }
  function cmPersonName(email) {
    var d = activeArt && cmDataCache[activeArt.id], p = d && d.people.filter(function (x) { return x.email === email; })[0];
    return (p && p.name) || email;
  }
  function cmReviewMeta(c) {
    var r = activeArt && reviewCache[activeArt.id], live = r && r.live_version_no, h = '';
    if (c.version_no && live && c.version_no < live) h += '<span class="wsx-cm__ver" title="' + esc(t('review.onVersionTip').replace('{n}', String(c.version_no)).replace('{m}', String(live))) + '">' + esc(t('review.onVersion').replace('{n}', String(c.version_no))) + '</span>';
    if (c.assignee_email) h += '<span class="wsx-cm__asg">' + esc(t('review.assignedTo').replace('{who}', cmPersonName(c.assignee_email))) + '</span>';
    return h ? '<div class="wsx-cm__rv">' + h + '</div>' : '';
  }
  function cmReviewActs(c) {
    var r = activeArt && reviewCache[activeArt.id];
    if (!r || !r.can_review) return '';
    return '<button class="wsx-cm__reply" type="button" data-cmres="' + esc(c.id) + '" data-on="' + (c.resolved ? '0' : '1') + '">' + esc(t(c.resolved ? 'review.reopen' : 'review.resolve')) + '</button>'
      + (c.resolved ? '' : '<button class="wsx-cm__reply" type="button" data-cmasg="' + esc(c.id) + '">' + esc(t('review.assign')) + '</button>');
  }
  function cmRow(art, id) { return (cmtCache[art.id] || []).filter(function (c) { return c.id === id; })[0]; }
  function wireReview(art) {
    rbodyEl.querySelectorAll('[data-cmf]').forEach(function (b) {
      b.addEventListener('click', function () { cmFilter = b.getAttribute('data-cmf'); paintComments(art, cmtCache[art.id] || []); });
    });
    rbodyEl.querySelectorAll('[data-cmres]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cmres'), on = b.getAttribute('data-on') === '1';
        b.disabled = true;
        reviewPost('/v1/home/comments/resolve', { artifactId: art.id, commentId: id, resolved: on })
          .then(function (d) { var c = cmRow(art, id); if (c) c.resolved = d.resolved; if (activeArt === art && rActive === 'comments') paintComments(art, cmtCache[art.id]); })
          .catch(function (err) { b.disabled = false; failToast(err, t('review.failed')); });
      });
    });
    rbodyEl.querySelectorAll('[data-cmasg]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); openAssignPicker(art, b); });
    });
  }
  function openAssignPicker(art, btn) {
    var prev = rbodyEl.querySelector('.wsx-cm__picker'); if (prev) { var same = prev.previousSibling === btn; prev.remove(); if (same) return; }
    var id = btn.getAttribute('data-cmasg'), c = cmRow(art, id);
    var menu = document.createElement('div'); menu.className = 'wsx-cm__picker'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', t('review.assignTo'));
    menu.innerHTML = i18nLoad();
    btn.parentNode.insertBefore(menu, btn.nextSibling);
    getCmData(art, function (d) {
      var rows = (d.people || []).slice(0, 50).map(function (p) {
        return '<div class="wsx-cm__mention" role="option" data-asg="' + esc(p.email) + '"><span class="wsx-cm__av">' + esc((p.name || p.email || '?').charAt(0).toUpperCase()) + '</span><span class="wsx-cm__mtxt">' + esc(p.name || p.email) + '</span><small>' + esc(p.email) + '</small></div>';
      });
      if (c && c.assignee_email) rows.unshift('<div class="wsx-cm__mention" role="option" data-asg=""><span class="wsx-cm__mtxt">' + esc(t('review.unassign')) + '</span></div>');
      menu.innerHTML = rows.length ? rows.join('') : '<div class="wsx-cm__empty">' + esc(t('review.noPeople')) + '</div>';
      menu.querySelectorAll('[data-asg]').forEach(function (el) {
        el.addEventListener('click', function () {
          var email = el.getAttribute('data-asg') || null;
          menu.remove();
          reviewPost('/v1/home/comments/assign', { artifactId: art.id, commentId: id, assignee: email })
            .then(function (r) { var row = cmRow(art, id); if (row) row.assignee_email = r.assignee_email; if (activeArt === art && rActive === 'comments') paintComments(art, cmtCache[art.id]); })
            .catch(function (err) { failToast(err, t('review.failed')); });
        });
      });
    });
  }
  // Approvals section: status chip (approved = success), approve/withdraw with busy → done feedback.
  function paintApprovals(art) {
    var box = rbodyEl.querySelector('#wsxApprove'); if (!box || !art.id) return;
    var secEl = box.closest('.wsx-det__sec');
    function draw(r, flash) {
      if (!document.body.contains(box)) return;
      if (!r || !r.live_version_id) { if (secEl) secEl.hidden = true; return; }
      var on = (r.approvals || []).filter(function (a) { return a.version_id === r.live_version_id; });
      var me = (r.my_approvals || []).indexOf(r.live_version_id) >= 0;
      var names = on.map(function (a) { return a.name || a.email || t('inspector.someone'); }).join(', ');
      if (secEl) secEl.hidden = false;
      box.innerHTML = '<div class="wsx-det__apst' + (on.length ? ' is-ok' : '') + (flash ? ' is-flash' : '') + '"><span class="wsx-det__apchip">' + (on.length ? '\\u2713 v' + r.live_version_no : 'v' + r.live_version_no) + '</span>'
        + '<span class="wsx-row__sub">' + esc(on.length ? t('review.approvedBy').replace('{who}', names) : t('review.notApproved').replace('{n}', String(r.live_version_no))) + '</span></div>'
        + (r.can_review ? '<button class="wsx-abtn' + (me ? '' : ' wsx-abtn--primary') + ' wsx-det__approve" type="button" data-approve="' + (me ? '0' : '1') + '">' + esc(t(me ? 'review.withdraw' : 'review.approve')) + '</button>' : '');
      var b = box.querySelector('[data-approve]');
      if (b) b.addEventListener('click', function () {
        var yes = b.getAttribute('data-approve') === '1';
        b.disabled = true; b.classList.add('is-busy'); b.textContent = t(yes ? 'review.approving' : 'review.withdrawing');
        reviewPost('/v1/home/approvals', { artifactId: art.id, versionId: r.live_version_id, approved: yes })
          .then(function (d) { reviewCache[art.id] = d; delete histCache[art.id]; draw(d, true); wsxToast(t(yes ? 'review.approvedToast' : 'review.withdrawnToast')); })
          .catch(function (err) { draw(r); failToast(err, t('review.approveFailed')); });
      });
    }
    loadReview(art, function (r) { draw(r); });
  }
  function histReviewLine(v) {
    var n = v.comment_count || 0, ap = v.approvals || [], parts = [];
    if (n) parts.push(n === 1 ? t('review.comment1') : t('review.comments').replace('{n}', String(n)));
    if (ap.length) parts.push('\\u2713 ' + t('review.approvedBy').replace('{who}', ap.map(function (a) { return a.name || a.email || t('inspector.someone'); }).join(', ')));
    return parts.length ? '<div class="wsx-vh__rv">' + esc(parts.join(' \\u00B7 ')) + '</div>' : '';
  }

`;
