/** Admin → Support tickets (list + detail). Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminSupport_JS = `  function supPriorityBadge(p) { var c = { urgent: 'var(--color-error)', high: 'var(--color-warning)', normal: 'var(--color-primary)', low: 'var(--color-text-tertiary)' }[p] || 'var(--color-text-tertiary)'; return p ? '<span class="wsx-atbl__badge" style="background:color-mix(in srgb,' + c + ' 10%,transparent);color:' + c + '">' + esc(p) + '</span>' : ''; }
  function adSupportDetail(id) {
    var m = adM('support'); if (!m) return;
    adLoading(m);
    fetch('/v1/support/tickets/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ticket) { m.innerHTML = i18nEmpty('admin.couldNotTicket'); return; }
        var ticket = j.ticket;
        var thread = (j.thread || []).map(function (x) {
          var who = x.author === 'customer' ? t('admin.supportAuthorCustomer') : x.author === 'ai' ? t('admin.supportAuthorAi') : t('admin.supportAuthorStaff');
          return '<div class="wsx-admin__audit-row"><span class="wsx-admin__audit-actor">' + esc(who) + '</span>'
            + '<span class="wsx-admin__audit-action">' + esc(x.body) + '</span>'
            + '<span class="wsx-admin__audit-ts">' + adRelDate(x.created_at) + '</span></div>';
        }).join('');
        m.innerHTML = '<button class="wsx-abtn" id="supBack" type="button">' + esc(t('admin.allTickets')) + '</button>'
          + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(ticket.subject) + ' ' + supPriorityBadge(ticket.priority) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(ticket.channel) + ' \\u00B7 ' + esc(ticket.status) + (ticket.category ? ' \\u00B7 ' + esc(ticket.category) : '') + ' \\u00B7 ' + esc(ticket.requester_email || t('admin.unknown')) + '</p>'
          + '<div class="wsx-admin__auditfeed">' + thread + '</div></div>'
          + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.supportReply')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.supportReplyIntro')) + '</p>'
          + '<textarea class="wsx-admin__email" id="supDraft" style="width:100%;min-height:120px">' + esc(ticket.ai_draft || '') + '</textarea>'
          + '<div class="wsx-admin__domain-add"><button class="wsx-abtn" id="supSend" type="button">' + esc(t('admin.supportApproveSend')) + '</button>'
          + '<button class="wsx-abtn" id="supResolve" type="button">' + esc(t('admin.supportResolve')) + '</button>'
          + '<span class="wsx-admin__savemsg" id="supMsg"></span></div></div>';
        var msg = function (s) { var e = document.getElementById('supMsg'); if (e) e.textContent = s; };
        document.getElementById('supBack').onclick = function () { adSupport(); };
        document.getElementById('supSend').onclick = function () {
          var body = (document.getElementById('supDraft') || {}).value || '';
          if (!body.trim()) { msg(t('admin.supportWriteReply')); return; }
          var feed = m.querySelector('.wsx-admin__auditfeed'), draft = document.getElementById('supDraft'), row = null;
          optimistic({
            key: 'sup-reply:' + id,
            apply: function () {
              row = document.createElement('div'); row.className = 'wsx-admin__audit-row';
              row.innerHTML = '<span class="wsx-admin__audit-actor">' + esc(t('admin.supportAuthorStaff')) + '</span><span class="wsx-admin__audit-action">' + esc(body) + '</span><span class="wsx-admin__audit-ts">' + esc(t('time.justNow')) + '</span>';
              if (feed) feed.appendChild(row);
              if (draft) draft.value = '';
              msg('');
            },
            rollback: function () { if (row) row.remove(); if (draft && !draft.value) draft.value = body; },
            request: function () { return adReq('/v1/support/tickets/' + encodeURIComponent(id) + '/reply', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: body }) }).then(function (res) { if (!res || !res.success) throw new Error('send'); return res; }); },
            success: t('admin.replySent'),
            error: adErr(t('admin.supportSendFailed')),
          });
        };
        document.getElementById('supResolve').onclick = function () {
          optimistic({
            key: 'sup-resolve:' + id,
            apply: function () { adSupport(); },
            rollback: function () { adSupportDetail(id); },
            request: function () { return adReq('/v1/support/tickets/' + encodeURIComponent(id) + '/status', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) }); },
            success: t('admin.ticketResolved'),
            error: adErr(t('admin.actionFailed')),
            done: function () { adSupport(); },
          });
        };
      }).catch(function () { m.innerHTML = i18nEmpty('common.couldNotLoad'); });
  }
  function adSupport() {
    var m = adM('support'); if (needWs(m)) return;
    adLoading(m);
    fetch('/v1/support/tickets?scope=workspace&workspace=' + encodeURIComponent(window.WSX_WS), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var tickets = (j && j.tickets) || [];
        var rows = tickets.map(function (tk) {
          return '<tr class="wsx-atbl__row is-click" data-sup-id="' + esc(tk.id) + '">'
            + '<td>' + esc(tk.subject) + '</td>'
            + '<td>' + supPriorityBadge(tk.priority) + '</td>'
            + '<td class="wsx-atbl__date">' + esc(tk.status) + '</td>'
            + '<td>' + esc(tk.channel) + '</td>'
            + '<td class="wsx-atbl__date">' + adRelDate(tk.last_msg_at) + '</td></tr>';
        }).join('');
        m.innerHTML = adTableSection('admin.supportTickets', 'admin.supportIntro', ['admin.colSubject', 'admin.colPriority', 'admin.lblStatus', 'admin.colChannel', 'admin.colUpdated'], rows, 'admin.noTickets');
        m.querySelectorAll('[data-sup-id]').forEach(function (row) {
          row.addEventListener('click', function () { adSupportDetail(row.getAttribute('data-sup-id')); });
        });
      }).catch(function () { m.innerHTML = i18nEmpty('common.couldNotLoad'); });
  }

`;
