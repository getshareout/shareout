/** Notifications bell + right-docked panel: publish approvals (actionable) + activity that needs you. */
export const workspace_client_notifications_JS = `
  // ===== notifications: bell + panel (approvals + needs-you activity) =====
  (function () {
    var btn = document.getElementById('wsxNotifBtn');
    var badge = document.getElementById('wsxNotifBadge');
    var panel = document.getElementById('wsxNotifPanel');
    var scrim = document.getElementById('wsxNotifScrim');
    var body = document.getElementById('wsxNotifBody');
    var closeBtn = document.getElementById('wsxNotifClose');
    var readAll = document.getElementById('wsxNotifReadAll');
    var tabsEl = document.getElementById('wsxNotifTabUnread') ? document.getElementById('wsxNotifTabUnread').parentNode : null;
    var tabUnreadN = document.getElementById('wsxNotifTabUnreadN');
    if (!btn || !panel || !body) return;

    var wsId = window.WSX_WS || '';
    var wsq = wsId ? '&workspace=' + encodeURIComponent(wsId) : '';
    var needs = [], approvals = [], actions = [], seen = [], loaded = false, tab = 'unread', needsViewed = false;
    var svgUp = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    var svgBell = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

    function decidable() { return approvals.filter(function (a) { return a.viewer_can_decide; }).length; }
    function openActions() { return actions.filter(function (a) { return !a.resolved; }).length; }
    function overdueActions() { return actions.filter(function (a) { return !a.resolved && a.due_at && Date.parse(a.due_at) < Date.now(); }).length; }
    function total() { return decidable() + (needsViewed ? 0 : needs.length) + openActions(); }
    function setBadge() {
      var n = total();
      if (n > 0) { badge.hidden = false; badge.textContent = n > 99 ? '99+' : String(n); }
      else { badge.hidden = true; }
      if (tabUnreadN) {
        if (n > 0) { tabUnreadN.hidden = false; tabUnreadN.textContent = n > 99 ? '99+' : String(n); }
        else { tabUnreadN.hidden = true; }
      }
    }

    function needCard(e, isSeen) {
      var isAccess = e.kind === 'access';
      var top = e.actor ? esc(e.actor) : esc(e.artifact_name || t('notif.activity'));
      var sum = e.actor && e.artifact_name ? (esc(e.summary) + ' \\u00B7 ' + esc(e.artifact_name)) : esc(e.summary);
      var href = !isAccess && e.slug ? '/a/' + encodeURIComponent(e.slug) + '/' : '';
      var cls = isSeen ? 'wsx-ncard is-seen' : 'wsx-ncard';
      if (isAccess) cls += ' wsx-ncard--access';
      var openTag = href ? '<a class="' + cls + '" href="' + href + '"' : '<div class="' + cls + '"';
      var closeTag = href ? '</a>' : '</div>';
      var x = isSeen ? '' : '<button class="wsx-ncard__x" data-dismiss="' + esc(e.id) + '" type="button" title="' + esc(t('notif.dismiss')) + '" aria-label="' + esc(t('notif.dismiss')) + '">\\u00D7</button>';
      var actions = isAccess && !isSeen
        ? '<span class="wsx-ncard__act wsx-ncard__act--split"><button class="wsx-abtn wsx-abtn--primary" data-access-approve="' + esc(e.id) + '" type="button">' + esc(t('common.approve')) + '</button><button class="wsx-abtn danger" data-access-deny="' + esc(e.id) + '" type="button">' + esc(t('common.deny')) + '</button></span>'
        : '';
      return openTag + ' data-eid="' + esc(e.id) + '">'
        + iconChip(e, 'wsx-ncard__ic')
        + '<span class="wsx-ncard__main"><span class="wsx-ncard__top">' + top + '</span><span class="wsx-ncard__sum">' + sum + '</span><span class="wsx-ncard__time">' + timeAgo(e.ts) + '</span></span>'
        + actions
        + x + closeTag;
    }

    function dueChip(due) {
      if (!due) return '';
      var ms = Date.parse(due); if (isNaN(ms)) return '';
      var day = 86400000;
      var d0 = new Date(); d0.setHours(0, 0, 0, 0);
      var diff = Math.floor((new Date(ms).setHours(0, 0, 0, 0) - d0.getTime()) / day);
      var over = ms < Date.now() && diff < 0;
      var lbl = diff < 0 ? t('notif.dueOverdue') : diff === 0 ? t('notif.dueToday') : diff === 1 ? t('notif.dueTomorrow') : t('notif.dueOn').replace('{date}', adRelDate(due));
      return '<span class="wsx-duechip' + (over ? ' is-overdue' : '') + '">' + esc(lbl) + '</span>';
    }

    function actionCard(a) {
      var done = !!a.resolved;
      var top = esc(a.actor || a.artifact_name || t('notif.actionItems'));
      var sum = esc(a.summary || '') + (a.artifact_name ? ' \\u00B7 ' + esc(a.artifact_name) : '');
      var href = a.slug ? '/a/' + encodeURIComponent(a.slug) + '/' : '';
      var openTag = href ? '<a class="wsx-ncard wsx-ncard--action" href="' + href + '"' : '<div class="wsx-ncard wsx-ncard--action"';
      var closeTag = href ? '</a>' : '</div>';
      var meta = done
        ? '<span class="wsx-ncard__sum">' + esc(t('notif.completedBy').replace('{who}', a.resolved_by || '')) + '</span>'
        : dueChip(a.due_at);
      var actBtn = done
        ? '<button class="wsx-abtn" data-reopen="' + esc(a.id) + '" data-art="' + esc(a.artifact_id) + '" type="button">' + esc(t('notif.reopen')) + '</button>'
        : '<button class="wsx-abtn wsx-abtn--primary" data-done="' + esc(a.id) + '" data-art="' + esc(a.artifact_id) + '" type="button">' + esc(t('notif.done')) + '</button>';
      return openTag + ' data-action="' + esc(a.id) + '"' + (over(a) ? ' data-overdue="1"' : '') + '>'
        + '<span class="wsx-ncard__main"><span class="wsx-ncard__top">' + top + '</span><span class="wsx-ncard__sum">' + sum + '</span>'
        + '<span class="wsx-ncard__actrow">' + meta + '<span class="wsx-ncard__time">' + timeAgo(a.ts) + '</span></span></span>'
        + '<span class="wsx-ncard__act">' + actBtn + '</span>'
        + closeTag;
    }
    function over(a) { return !a.resolved && a.due_at && Date.parse(a.due_at) < Date.now(); }

    function apprCard(a) {
      var name = esc(a.artifact_name || t('notif.untitled'));
      var vis = t('notif.public');
      var sub = esc(t('notif.wantsPublish').replace('{who}', a.requester || '').replace('{vis}', vis));
      var when = a.created_at ? '<span class="wsx-ncard__time">' + esc(adRelDate(a.created_at)) + '</span>' : '';
      var foot = a.viewer_can_decide
        ? '<div class="wsx-ncard__actions"><button class="wsx-abtn wsx-abtn--primary" data-approve="' + esc(a.id) + '" data-art="' + esc(a.artifact_id) + '" type="button">' + esc(t('common.approve')) + '</button><button class="wsx-abtn danger" data-reject="' + esc(a.id) + '" data-art="' + esc(a.artifact_id) + '" type="button">' + esc(t('notif.reject')) + '</button></div>'
        : '<div class="wsx-ncard__status">' + esc(t('notif.awaiting').replace('{n}', String(a.approved_count || 0)).replace('{m}', String(a.approvals_required || 1))) + '</div>';
      return '<div class="wsx-ncard wsx-ncard--approval" data-appr="' + esc(a.id) + '">'
        + '<div class="wsx-ncard__row"><span class="wsx-ncard__ic">' + svgUp + '</span>'
        + '<span class="wsx-ncard__main"><span class="wsx-ncard__top">' + name + '</span><span class="wsx-ncard__sum">' + sub + '</span>' + when + '</span></div>'
        + foot + '</div>';
    }

    function render() {
      if (tab === 'seen') { renderSeen(); return; }
      var html = '';
      if (approvals.length) {
        html += '<div class="wsx__notif-sec">' + esc(t('notif.approvals')) + '</div>' + approvals.map(apprCard).join('');
      }
      if (actions.length) {
        var od = overdueActions();
        var head = esc(t('notif.actionItems')) + (od ? ' <span class="wsx__notif-sec-x">\\u00B7 ' + esc(t('notif.overdue').replace('{n}', String(od))) + '</span>' : '');
        html += '<div class="wsx__notif-sec">' + head + '</div>' + actions.map(actionCard).join('');
      }
      if (needs.length) {
        html += '<div class="wsx__notif-sec">' + esc(t('notif.recent')) + '</div>' + needs.map(needCard).join('');
      }
      if (!approvals.length && !actions.length && !needs.length) {
        html = '<div class="wsx-notif-empty">' + svgBell + '<div class="wsx-notif-empty__t">' + esc(t('notif.emptyTitle')) + '</div><div class="wsx-notif-empty__s">' + esc(t('notif.emptySub')) + '</div></div>';
      }
      body.innerHTML = html;
      if (readAll) readAll.hidden = !needs.length || needsViewed;
    }

    function renderSeen() {
      if (readAll) readAll.hidden = true;
      if (seen.length) {
        body.innerHTML = seen.map(function (e) { return needCard(e, true); }).join('');
      } else {
        body.innerHTML = '<div class="wsx-notif-empty">' + svgBell + '<div class="wsx-notif-empty__t">' + esc(t('notif.seenEmpty')) + '</div><div class="wsx-notif-empty__s">' + esc(t('notif.seenEmptySub')) + '</div></div>';
      }
    }

    function selectTab(next) {
      if (next === tab) return;
      tab = next;
      if (tabsEl) tabsEl.querySelectorAll('[data-tab]').forEach(function (b) {
        var on = b.getAttribute('data-tab') === tab;
        b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      render();
    }

    function load(showSpin, boot) {
      if (showSpin && !loaded) body.innerHTML = i18nSpin();
      // Boot: reuse the activity feed's in-flight response (needs/actionItems/seen do not
      // depend on the window) and keep the bell's 30-item cap. Opening the panel refetches.
      var feed = boot && typeof feedBoot !== 'undefined' && feedBoot && typeof feedBoot.then === 'function'
        ? feedBoot.then(function (d) { return d && d.needs ? { needs: d.needs.slice(0, 30), actionItems: d.actionItems, seen: d.seen } : d; })
        : fetch('/v1/home/activity-feed?limit=30&window=30d' + wsq, { credentials: 'same-origin' }).then(function (r) { return r.json(); });
      var jobs = [
        feed
          .then(function (d) { needsViewed = false; needs = (d && d.needs) || []; actions = (d && d.actionItems) || []; seen = (d && d.seen) || []; })
          .catch(function () { needs = []; actions = []; seen = []; }),
      ];
      if (wsId) {
        jobs.push(
          fetch('/v1/workspaces/' + encodeURIComponent(wsId) + '/publish-approvals?status=pending', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) { approvals = (d && d.approvals) || []; })
            .catch(function () { approvals = []; })
        );
      } else { approvals = []; }
      return Promise.all(jobs).then(function () { loaded = true; setBadge(); if (!panel.hidden) render(); });
    }

    function open() {
      panel.hidden = false; if (scrim) scrim.hidden = false;
      btn.classList.add('is-active'); btn.setAttribute('aria-expanded', 'true');
      render();
      load(true).then(function () { render(); markViewed(); });
    }
    // Opening the panel reads it: items stay listed now, leave the badge, show under Seen next time.
    function markViewed() {
      var ids = needs.map(function (x) { return x.id; });
      if (!ids.length || needsViewed) return;
      optimistic({
        key: 'notif:viewed',
        apply: function () { needsViewed = true; setBadge(); if (readAll) readAll.hidden = true; },
        rollback: function () { needsViewed = false; setBadge(); if (!panel.hidden) render(); },
        request: function () { return post('/v1/home/dismiss-event', 'POST', { eventIds: ids }); },
        error: t('evt.dismissFailed'),
      });
    }
    function close() {
      panel.hidden = true; if (scrim) scrim.hidden = true;
      btn.classList.remove('is-active'); btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (panel.hidden) open(); else close(); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (scrim) scrim.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });

    // Every card action is optimistic: the card changes or leaves at once, the request
    // runs behind, and a failure puts the item back where it was with an error toast.
    function takeOut(arr, id) { var at = -1, it = null; var rest = arr.filter(function (x, i) { if (x.id === id) { at = i; it = x; return false; } return true; }); return { rest: rest, at: at, it: it }; }
    function putBack(arr, id, at, it) { if (it && !arr.some(function (x) { return x.id === id; })) arr.splice(at < 0 ? arr.length : at, 0, it); }
    function afterChange() { setBadge(); if (readAll) readAll.hidden = !needs.length; if (!approvals.length && !actions.length && !needs.length) render(); }
    function post(url, method, payload) {
      return fetch(url, { method: method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    }
    // Swap a card to its "Approved" / "Rejected" line, then let it leave.
    function doneCard(card, label) {
      var prev = card ? card.innerHTML : '';
      if (card) card.innerHTML = '<div class="wsx-ncard__done">' + esc(label) + '</div>';
      return function () { if (card) card.innerHTML = prev; };
    }

    function dismiss(id, el) {
      var card = el.closest('.wsx-ncard'), out = null;
      optimistic({
        key: 'notif:dismiss:' + id,
        apply: function () { out = takeOut(needs, id); needs = out.rest; if (card) card.remove(); afterChange(); },
        rollback: function () { putBack(needs, id, out.at, out.it); render(); afterChange(); },
        request: function () { return post('/v1/home/dismiss-event', 'POST', { eventId: id }); },
        error: t('evt.dismissFailed'),
      });
    }

    function decide(el, decision) {
      var id = el.getAttribute('data-' + decision);
      var art = el.getAttribute('data-art');
      var card = el.closest('.wsx-ncard'), out = null, undoCard = null;
      optimistic({
        key: 'notif:decide:' + id,
        apply: function () { out = takeOut(approvals, id); approvals = out.rest; setBadge(); undoCard = doneCard(card, decision === 'approve' ? t('notif.approved') : t('notif.rejected')); },
        rollback: function () { putBack(approvals, id, out.at, out.it); if (undoCard) undoCard(); setBadge(); },
        request: function () {
          return post('/v1/artifacts/' + encodeURIComponent(art) + '/publish-approval/' + encodeURIComponent(id) + '/decision', 'POST', { decision: decision })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) { if (!d || !d.ok) throw new Error('decision'); });
        },
        error: t('notif.decisionFailed'),
        done: function () { setTimeout(function () { if (card) card.remove(); afterChange(); }, 900); },
      });
    }

    function resolveAction(el, resolved) {
      var id = el.getAttribute(resolved ? 'data-done' : 'data-reopen');
      var art = el.getAttribute('data-art');
      var card = el.closest('.wsx-ncard'), out = null, leaving = null;
      optimistic({
        key: 'notif:resolve:' + id,
        apply: function () { out = takeOut(actions, id); actions = out.rest; if (card) leaving = window.soOptimistic.leave(card); setBadge(); },
        rollback: function () { putBack(actions, id, out.at, out.it); if (leaving) leaving.restore(); setBadge(); },
        request: function () { return post('/v1/data/' + encodeURIComponent(art) + '/comments/' + encodeURIComponent(id) + '/resolve', 'PATCH', { resolved: resolved }); },
        error: t('notif.commentFailed'),
        done: function () { if (leaving) leaving.commit(); afterChange(); },
      });
    }
    function decideAccess(el, action) {
      var id = el.getAttribute(action === 'approve' ? 'data-access-approve' : 'data-access-deny');
      if (!id) return;
      var card = el.closest('.wsx-ncard');
      if (!card) return;
      var out = null, undoCard = null;
      optimistic({
        key: 'notif:access:' + id,
        apply: function () { out = takeOut(needs, id); needs = out.rest; setBadge(); undoCard = doneCard(card, action === 'approve' ? t('notif.approved') : t('notif.rejected')); },
        rollback: function () { putBack(needs, id, out.at, out.it); if (undoCard) undoCard(); setBadge(); },
        request: function () { return post('/v1/access-requests/' + encodeURIComponent(id), 'POST', { action: action }); },
        error: t('notif.accessFailed'),
        done: function () { setTimeout(function () { if (card) card.remove(); afterChange(); }, 900); },
      });
    }

    body.addEventListener('click', function (e) {
      var dn = e.target.closest('[data-done]');
      if (dn) { e.preventDefault(); e.stopPropagation(); resolveAction(dn, true); return; }
      var ro = e.target.closest('[data-reopen]');
      if (ro) { e.preventDefault(); e.stopPropagation(); resolveAction(ro, false); return; }
      var aa = e.target.closest('[data-access-approve]');
      if (aa) { e.preventDefault(); e.stopPropagation(); decideAccess(aa, 'approve'); return; }
      var ad = e.target.closest('[data-access-deny]');
      if (ad) { e.preventDefault(); e.stopPropagation(); decideAccess(ad, 'deny'); return; }
      var dis = e.target.closest('[data-dismiss]');
      if (dis) { e.preventDefault(); e.stopPropagation(); dismiss(dis.getAttribute('data-dismiss'), dis); return; }
      var ap = e.target.closest('[data-approve]');
      if (ap) { e.preventDefault(); decide(ap, 'approve'); return; }
      var rj = e.target.closest('[data-reject]');
      if (rj) { e.preventDefault(); decide(rj, 'reject'); return; }
      var link = e.target.closest('a.wsx-ncard');
      if (link) {
        var eid = link.getAttribute('data-eid');
        // Opening a needs-you notification marks it seen (moves it to the Seen tab).
        if (eid && tab !== 'seen' && !link.classList.contains('wsx-ncard--action')) {
          var ev = null;
          needs = needs.filter(function (x) { if (x.id === eid) { ev = x; return false; } return true; });
          if (ev) seen.unshift(ev);
          setBadge();
          fetch('/v1/home/dismiss-event', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: eid }) }).catch(function () {});
        }
        close();
      }
    });

    if (tabsEl) tabsEl.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-tab]'); if (!tb) return;
      selectTab(tb.getAttribute('data-tab'));
    });

    if (readAll) readAll.addEventListener('click', function () {
      var ids = needs.map(function (x) { return x.id; });
      if (!ids.length) return;
      var prev = needs.slice();
      optimistic({
        key: 'notif:readall',
        apply: function () { needs = []; render(); setBadge(); },
        rollback: function () { needs = prev.concat(needs.filter(function (x) { return ids.indexOf(x.id) < 0; })); render(); setBadge(); },
        request: function () { return post('/v1/home/dismiss-event', 'POST', { eventIds: ids }); },
        error: t('evt.dismissFailed'),
      });
    });

    // Prime the badge on load so the count shows without opening the panel.
    load(false, true);
  })();

`;
