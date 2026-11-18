import { BILLING_COPY } from './admin-billing-copy';

/** Admin → Billing, bottom half: invoices the instance operator issues to this workspace (src/router/api/workspace-invoices.ts).
 *  Always shown (an empty state until the first one is issued). Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminBilling_JS = `  // Billing: the operator creates/issues (which emails the invoice)/marks paid; workspace admins download the
  // invoice document and attach transfer proof, which marks it paid.
  var adBillOpenId = null, adBillDelivery = null;
  var BILL_COPY = ${JSON.stringify(BILLING_COPY).replace(/</g, '\\u003c')};
  // Billing strings first (in the page's current language), then the shell's copy.
  function bt(k) { var de = document.documentElement, l = de && de.lang === 'es' ? 'es' : 'en'; return BILL_COPY[l][k] || BILL_COPY.en[k] || t(k); }
  function adBilling() {
    var m = adM('billing'); if (needWs(m)) return;
    var wrap = document.getElementById('wsxAdSecWrap_billing');
    function money(cents, cur) {
      var v = (Number(cents) || 0) / 100;
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD' }).format(v); } catch (e) { return (cur || 'USD') + ' ' + v.toFixed(2); }
    }
    function micro(n) { var v = (Number(n) || 0) / 1e6; return '$' + (v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2)); }
    function day(iso) { return iso ? String(iso).slice(0, 10) : '\\u2014'; }
    function monthName(ym) { try { return new Date(ym + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return ym; } }
    function badge(st) { var cls = { paid: 'is-on', open: 'is-trial', void: 'is-off', draft: '' }[st] || ''; return '<span class="wsx-admin__rolebadge ' + cls + '" data-inv-status="' + esc(st) + '">' + esc(bt('admin.billStatus_' + st)) + '</span>'; }
    // Operator-only blocks: a pill anyone can spot (the API never sends them to workspace admins).
    function opPill() { return '<span class="wsx-opbadge" data-op-badge>' + esc(bt('admin.superOnly')) + '</span>'; }
    function reload() { delete adDataCache.billing; adBilling(); }
    // One request + toast; success repaints the section, failure frees the button and says why.
    // okMsg is the toast, or a function of the response that returns [text, type].
    function call(url, init, okMsg, btn) {
      adBusy(btn);
      return fetch(url, Object.assign({ credentials: 'same-origin' }, init)).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error((j && ((j.error && j.error.message) || (typeof j.error === 'string' && j.error) || j.message)) || bt('admin.actionFailed'));
          if (j && j.invoice) adBillOpenId = j.invoice.id;
          var msg = typeof okMsg === 'function' ? okMsg(j) : [okMsg, 'success'];
          if (msg && msg[0]) showToast(msg[0], msg[1]);
          reload(); return j;
        });
      }).catch(function (e) { adIdle(btn); showToast(String((e && e.message) || bt('admin.actionFailed')), 'error'); });
    }
    // After an issue or a resend: who got the email, or why it did not go out (the invoice is issued either way).
    function mailToast(okKey) {
      return function (j) {
        var em = j && j.email;
        if (!em) return [bt(okKey), 'success'];
        return em.sent ? [bt('admin.billMailed_ok').replace('{to}', (em.to || []).join(', ')), 'success'] : [bt('admin.billMailFailed').replace('{error}', em.error || ''), 'error'];
      };
    }
    // The "send email" checkbox, with exactly who issuing emails (res.delivery, operator only).
    function sendRow(attr) {
      var d = adBillDelivery || {}, to = d.to || [], sup = d.suppressed || [], can = !!(d.email_enabled && to.length);
      var label = !d.email_enabled ? bt('admin.billSendOff')
        : to.length ? bt(d.source === 'billing_email' ? 'admin.billSendToBilling' : 'admin.billSendToAdmins').replace('{to}', to.join(', '))
          : sup.length ? bt('admin.billSendSkipped').replace('{list}', sup.join(', ')) : bt('admin.billSendNobody');
      return '<label class="wsx-admin__check" data-inv-sendrow><input type="checkbox" ' + attr + (can ? ' checked' : ' disabled') + '> ' + esc(label) + '</label>'
        + (can && sup.length ? '<span class="wsx-field__note">' + esc(bt('admin.billSendSkipped').replace('{list}', sup.join(', '))) + '</span>' : '');
    }
    // The workspace sees the price; the operator (op) also sees cost and margin per row.
    function usageTable(titleKey, rows, label, op) {
      if (!rows || !rows.length) return '';
      return '<div class="wsx-admin__settings-title" style="margin-top:14px">' + esc(bt(titleKey)) + '</div><div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th></th>'
        + '<th>' + esc(bt('admin.billColCalls')) + '</th><th>' + esc(bt('admin.billColTokIn')) + '</th><th>' + esc(bt('admin.billColTokOut')) + '</th><th>' + esc(bt('admin.billColAmount')) + '</th>'
        + (op ? '<th>' + esc(bt('admin.billColCost')) + '</th><th>' + esc(bt('admin.billColMargin')) + '</th>' : '') + '</tr></thead><tbody>'
        + rows.map(function (r) {
          var cells = '<td class="wsx-atbl__num">' + micro(r.price_micro_usd) + '</td>';
          if (op) cells += '<td class="wsx-atbl__num" data-op-cost>' + micro(r.cost_micro_usd) + '</td><td class="wsx-atbl__num">' + micro((r.price_micro_usd || 0) - (r.cost_micro_usd || 0)) + '</td>';
          return '<tr><td>' + esc(label(r.key)) + '</td><td class="wsx-atbl__num">' + adCompact(r.calls) + '</td><td class="wsx-atbl__num">' + adCompact(r.input_tokens) + '</td><td class="wsx-atbl__num">' + adCompact(r.output_tokens) + '</td>' + cells + '</tr>';
        }).join('')
        + '</tbody></table></div>';
    }
    function usageHtml(u, manage) {
      if (!u) return '';
      var op = manage && u.cost_micro_usd != null;
      return '<div class="wsx-admin__settings-section" data-inv-usage><div class="wsx-admin__settings-title">' + esc(bt('admin.billUsageTitle').replace('{month}', monthName(u.month))) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(bt('admin.billUsageIntro').replace('{calls}', adCompact(u.calls)).replace('{total}', micro(u.price_micro_usd))) + '</p>'
        + (op ? '<p class="wsx-field__note" data-op-note>' + opPill() + ' ' + esc(bt('admin.billOpCost').replace('{cost}', micro(u.cost_micro_usd)).replace('{markup}', String((u.markup_bps || 10000) / 10000)).replace('{margin}', micro(u.price_micro_usd - u.cost_micro_usd))) + '</p>' : '')
        + usageTable('admin.billByKind', u.by_kind, function (k) { return tOr('admin.aiKind_' + k, k); }, op)
        + usageTable('admin.billByModel', u.by_model, function (k) { return k; }, op)
        + usageTable('admin.billByMember', u.by_member, function (k) { return k || bt('admin.billNoMember'); }, op)
        + '</div>';
    }
    function invoiceHtml(inv, manage) {
      var lines = inv.lines || [], usage = null;
      var rows = lines.map(function (l) {
        if (l.kind === 'usage') usage = l.usage;
        return '<tr><td>' + esc(l.description) + '</td><td class="wsx-atbl__num">' + esc(String(l.quantity)) + '</td><td class="wsx-atbl__num">' + money(l.unit_cents, inv.currency) + '</td><td class="wsx-atbl__num">' + money(l.amount_cents, inv.currency) + '</td></tr>';
      }).join('') + '<tr><td><strong>' + esc(bt('admin.billTotal')) + '</strong></td><td></td><td></td><td class="wsx-atbl__num"><strong>' + money(inv.total_cents, inv.currency) + '</strong></td></tr>';
      var id = esc(inv.id), st = inv.status;
      var files = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(bt('admin.billFiles')) + '</div><div class="wsx-bill__files">'
        + '<div>' + esc(bt('admin.billReceipt')) + ': ' + (inv.receipt ? '<a class="wsx-abtn" href="' + esc(wsUrl('/invoices/' + inv.id + '/receipt')) + '" download data-inv-dl="receipt">' + esc(inv.receipt.name || bt('admin.billDownload')) + '</a>' : '<span class="wsx-atbl__date">' + esc(bt('admin.billReceiptNone')) + '</span>')
        + (manage && st !== 'void' ? ' <button class="wsx-abtn" type="button" data-inv-up="receipt" data-inv-id="' + id + '">' + esc(bt(inv.receipt ? 'admin.billReplace' : 'admin.billUploadReceipt')) + '</button>' : '') + '</div>'
        + '<div>' + esc(bt('admin.billProof')) + ': ' + (inv.proof ? '<a class="wsx-abtn" href="' + esc(wsUrl('/invoices/' + inv.id + '/proof')) + '" download data-inv-dl="proof">' + esc(inv.proof.name || bt('admin.billDownload')) + '</a> <span class="wsx-atbl__date">' + esc(bt('admin.billProofBy').replace('{who}', inv.proof.uploaded_by || '\\u2014').replace('{date}', day(inv.proof.uploaded_at))) + '</span>' : '<span class="wsx-atbl__date">' + esc(bt('admin.billProofNone')) + '</span>')
        + (st === 'open' ? ' <button class="wsx-abtn" type="button" data-inv-up="proof" data-inv-id="' + id + '">' + esc(bt(inv.proof ? 'admin.billReplace' : 'admin.billUploadProof')) + '</button>'
          + (manage ? '' : ' <span class="wsx-field__note">' + esc(bt('admin.billProofMarksPaid')) + '</span>') : '') + '</div>'
        + '</div></div>';
      var acts = '';
      if (manage) {
        if (st === 'draft') acts = '<div style="flex-basis:100%">' + sendRow('data-inv-send="' + id + '"') + '</div><button class="wsx-abtn wsx-abtn--primary" type="button" data-inv-act="open" data-inv-id="' + id + '">' + esc(bt('admin.billIssue')) + '</button><button class="wsx-abtn" type="button" data-inv-act="delete" data-inv-id="' + id + '">' + esc(bt('admin.billDeleteDraft')) + '</button>';
        if (st === 'open') acts = '<input class="wsx-field__in" style="max-width:240px" data-inv-ref="' + id + '" maxlength="200" placeholder="' + esc(bt('admin.billRefPh')) + '"><button class="wsx-abtn wsx-abtn--primary" type="button" data-inv-act="paid" data-inv-id="' + id + '">' + esc(bt('admin.billMarkPaid')) + '</button><button class="wsx-abtn" type="button" data-inv-act="send" data-inv-id="' + id + '" data-inv-num="' + esc(inv.number) + '">' + esc(bt('admin.billResend')) + '</button><button class="wsx-abtn" type="button" data-inv-act="void" data-inv-id="' + id + '">' + esc(bt('admin.billVoid')) + '</button>';
        if (st === 'paid') acts = '<button class="wsx-abtn" type="button" data-inv-act="unpaid" data-inv-id="' + id + '">' + esc(bt('admin.billMarkUnpaid')) + '</button>';
        if (acts) acts = '<div class="wsx-admin__domain-add" style="margin-top:14px;flex-wrap:wrap">' + acts + '</div>';
      }
      var meta = [bt('admin.billIssued') + ' ' + day(inv.issued_at), bt('admin.billDue') + ' ' + day(inv.due_at)];
      if (inv.emailed_at) meta.push(bt('admin.billEmailedOn').replace('{date}', day(inv.emailed_at)).replace('{to}', (inv.emailed_to || []).join(', ')));
      else if (manage && st !== 'draft') meta.push(bt('admin.billNotEmailed'));
      if (inv.paid_at) meta.push(bt('admin.billPaidOn') + ' ' + day(inv.paid_at) + (inv.paid_source ? ' (' + bt('admin.billPaidBy_' + inv.paid_source) + ')' : '') + (inv.payment_reference ? ' \\u00b7 ' + inv.payment_reference : ''));
      return '<details class="wsx-bill" data-inv="' + id + '"' + (adBillOpenId === inv.id ? ' open' : '') + '><summary class="wsx-bill__sum">'
        + '<span class="wsx-atbl__link">' + esc(inv.number) + '</span><span class="wsx-atbl__date">' + esc(inv.period_month ? monthName(inv.period_month) : day(inv.created_at)) + '</span>'
        + '<span class="wsx-bill__amt">' + money(inv.total_cents, inv.currency) + '</span>' + badge(st) + '</summary><div class="wsx-bill__body">'
        + '<div class="wsx-atbl__date" style="margin-bottom:10px">' + esc(meta.join(' \\u00b7 ')) + '</div>'
        + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(bt('admin.billColItem')) + '</th><th>' + esc(bt('admin.billColQty')) + '</th><th>' + esc(bt('admin.billColUnit')) + '</th><th>' + esc(bt('admin.billColAmount')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        + usageHtml(usage, manage)
        + (inv.notes ? '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(bt('admin.billHowToPay')) + '</div><div class="wsx-bill__notes">' + esc(inv.notes) + '</div></div>' : '')
        + files + acts + '</div></details>';
    }
    function closedMonths() {
      var now = new Date(), out = [];
      for (var i = 1; i <= 3; i++) { var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); out.push(d.toISOString().slice(0, 7)); }
      return out;
    }
    function lineRow() { return '<div class="wsx-cform__row" data-inv-line><input class="wsx-field__in" style="flex:3 1 220px" data-l-desc maxlength="200" placeholder="' + esc(bt('admin.billLineDescPh')) + '"><input class="wsx-field__in" style="flex:1 1 110px" data-l-amt type="number" step="0.01" placeholder="' + esc(bt('admin.billLineAmtPh')) + '"><button class="wsx-abtn" type="button" data-l-rm aria-label="' + esc(bt('admin.billRemoveLine')) + '">\\u00d7</button></div>'; }
    function formHtml() {
      var months = closedMonths();
      return '<div class="wsx-admin__budget" id="wsxBillForm" hidden><div class="wsx-admin__settings-title">' + esc(bt('admin.billNew')) + '</div><div class="wsx-cform">'
        + '<div class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billLines')) + '</span><div id="wsxBillLines">' + lineRow() + '</div><div><button class="wsx-abtn" type="button" id="wsxBillAddLine">' + esc(bt('admin.billAddLine')) + '</button></div></div>'
        + '<div class="wsx-cform__row"><label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billUsageMonth')) + '</span><select class="wsx-field__in" id="wsxBillUsage"><option value="">' + esc(bt('admin.billNoUsage')) + '</option>'
        + months.map(function (ym, i) { return '<option value="' + ym + '"' + (i === 0 ? ' selected' : '') + '>' + esc(monthName(ym)) + '</option>'; }).join('') + '</select></label>'
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billCurrency')) + '</span><input class="wsx-field__in" id="wsxBillCur" maxlength="3" value="USD"></label>'
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billDue')) + '</span><input class="wsx-field__in" id="wsxBillDue" type="date"></label>'
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billNumber')) + '</span><input class="wsx-field__in" id="wsxBillNum" maxlength="40" placeholder="' + esc(bt('admin.billNumberPh')) + '"></label></div>'
        + '<p class="wsx-field__note" id="wsxBillUsagePrev"></p>'
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billHowToPay')) + '</span><textarea class="wsx-field__in" id="wsxBillNotes" rows="3" maxlength="2000" placeholder="' + esc(bt('admin.billNotesPh')) + '"></textarea></label>'
        + '<div>' + sendRow('id="wsxBillSend"') + '</div>'
        + '<div class="wsx-cform__foot"><button class="wsx-abtn" type="button" id="wsxBillDraft">' + esc(bt('admin.billSaveDraft')) + '</button><button class="wsx-abtn wsx-abtn--primary" type="button" id="wsxBillIssue">' + esc(bt('admin.billIssue')) + '</button></div>'
        + '</div></div>';
    }
    // One step from the invoice the operator issued in their own tax system: its PDF plus what it says.
    // Currency and how-to-pay start from the latest invoice, which is usually what the next one says too.
    function docFormHtml(last) {
      last = last || {};
      function fld(id, key, input) { return '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt(key)) + '</span>' + input.replace('<input ', '<input class="wsx-field__in" id="' + id + '" ') + '</label>'; }
      return '<div class="wsx-admin__budget" id="wsxBillDocForm" hidden><div class="wsx-admin__settings-title">' + esc(bt('admin.billNewDoc')) + '</div><div class="wsx-cform">'
        + '<p class="wsx-field__note">' + esc(bt('admin.billDocIntro')) + '</p>'
        + fld('wsxBillDocFile', 'admin.billDocFile', '<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp">')
        + '<div class="wsx-cform__row">' + fld('wsxBillDocNum', 'admin.billNumber', '<input maxlength="40" placeholder="' + esc(bt('admin.billDocNumberPh')) + '">')
        + fld('wsxBillDocCur', 'admin.billCurrency', '<input maxlength="3" value="' + esc(last.currency || 'USD') + '">')
        + fld('wsxBillDocTotal', 'admin.billTotal', '<input type="number" min="0.01" step="0.01">') + '</div>'
        + '<div class="wsx-cform__row">' + fld('wsxBillDocDesc', 'admin.billDocDesc', '<input maxlength="200" placeholder="' + esc(bt('admin.billDocDescPh')) + '">')
        + fld('wsxBillDocPeriod', 'admin.billDocPeriod', '<input type="month">')
        + fld('wsxBillDocDue', 'admin.billDue', '<input type="date">') + '</div>'
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(bt('admin.billHowToPay')) + '</span><textarea class="wsx-field__in" id="wsxBillDocNotes" rows="3" maxlength="2000" placeholder="' + esc(bt('admin.billNotesPh')) + '">' + esc(last.notes || '') + '</textarea></label>'
        + '<div>' + sendRow('id="wsxBillDocSend"') + '</div>'
        + '<div class="wsx-cform__foot"><button class="wsx-abtn" type="button" id="wsxBillDocDraft">' + esc(bt('admin.billSaveDraft')) + '</button><button class="wsx-abtn wsx-abtn--primary" type="button" id="wsxBillDocIssue">' + esc(bt('admin.billIssue')) + '</button></div>'
        + '</div></div>';
    }
    function wireDocForm() {
      function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
      function submit(status, btn) {
        var input = document.getElementById('wsxBillDocFile'), f = input && input.files && input.files[0];
        var total = Math.round(Number(val('wsxBillDocTotal')) * 100);
        if (!f || !val('wsxBillDocNum') || !val('wsxBillDocDesc') || !isFinite(total) || total < 1) { showToast(bt('admin.billDocMissing'), 'error'); return; }
        if (f.size > 10 * 1024 * 1024) { showToast(bt('admin.billFileTooBig'), 'error'); return; }
        var q = new URLSearchParams({ number: val('wsxBillDocNum'), currency: (val('wsxBillDocCur') || 'USD').toUpperCase(), total_cents: String(total), description: val('wsxBillDocDesc'), status: status, name: f.name });
        [['period_month', 'wsxBillDocPeriod'], ['due_at', 'wsxBillDocDue'], ['notes', 'wsxBillDocNotes']].forEach(function (p) { if (val(p[1])) q.set(p[0], val(p[1])); });
        if (status === 'open') { var cb = document.getElementById('wsxBillDocSend'); q.set('send_email', cb && cb.checked ? '1' : '0'); }
        call(wsUrl('/invoices/from-document?' + q.toString()), { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f },
          status === 'open' ? mailToast('admin.billIssued_ok') : bt('admin.billDraft_ok'), btn);
      }
      document.getElementById('wsxBillDocDraft').addEventListener('click', function () { submit('draft', this); });
      document.getElementById('wsxBillDocIssue').addEventListener('click', function () { submit('open', this); });
    }
    function wireForm() {
      var form = document.getElementById('wsxBillForm'); if (!form) return;
      var linesEl = document.getElementById('wsxBillLines'), sel = document.getElementById('wsxBillUsage'), prev = document.getElementById('wsxBillUsagePrev');
      function wireRm() { linesEl.querySelectorAll('[data-l-rm]').forEach(function (b) { b.onclick = function () { b.closest('[data-inv-line]').remove(); }; }); }
      wireRm();
      document.getElementById('wsxBillAddLine').addEventListener('click', function () { linesEl.insertAdjacentHTML('beforeend', lineRow()); wireRm(); });
      function preview() {
        var ym = sel.value; prev.textContent = '';
        if (!ym) return;
        prev.textContent = bt('common.loading');
        fetch(wsUrl('/invoices/usage?month=' + encodeURIComponent(ym)), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          if (sel.value !== ym) return;
          if (!j) { prev.textContent = bt('admin.actionFailed'); return; }
          prev.textContent = j.already_billed_in
            ? bt('admin.billUsageBilled').replace('{number}', j.already_billed_in)
            : bt('admin.billUsagePreview').replace('{month}', monthName(ym)).replace('{total}', micro(j.usage.price_micro_usd)).replace('{calls}', adCompact(j.usage.calls))
              .replace('{cost}', micro(j.usage.cost_micro_usd)).replace('{markup}', String((j.usage.markup_bps || 10000) / 10000));
        }).catch(function () { prev.textContent = bt('admin.actionFailed'); });
      }
      sel.addEventListener('change', preview); preview();
      function submit(status, btn) {
        var lines = [], bad = false;
        linesEl.querySelectorAll('[data-inv-line]').forEach(function (row) {
          var d = row.querySelector('[data-l-desc]').value.trim(), a = row.querySelector('[data-l-amt]').value.trim();
          if (!d && !a) return;
          var n = Number(a);
          if (!d || a === '' || !isFinite(n)) { bad = true; return; }
          lines.push({ description: d, quantity: 1, unit_cents: Math.round(n * 100) });
        });
        if (bad) { showToast(bt('admin.billLineInvalid'), 'error'); return; }
        var body = { status: status, lines: lines, usage_month: sel.value || null, currency: (document.getElementById('wsxBillCur').value || 'USD').trim().toUpperCase(),
          due_at: document.getElementById('wsxBillDue').value || null, number: document.getElementById('wsxBillNum').value.trim() || null, notes: document.getElementById('wsxBillNotes').value.trim() || null };
        if (!lines.length && !body.usage_month) { showToast(bt('admin.billLineInvalid'), 'error'); return; }
        if (status === 'open') { var cb = document.getElementById('wsxBillSend'); body.send_email = !!(cb && cb.checked); }
        call(wsUrl('/invoices'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, status === 'open' ? mailToast('admin.billIssued_ok') : bt('admin.billDraft_ok'), btn);
      }
      document.getElementById('wsxBillDraft').addEventListener('click', function () { submit('draft', this); });
      document.getElementById('wsxBillIssue').addEventListener('click', function () { submit('open', this); });
    }
    // Operator only: this workspace's AI resale markup (empty = the instance default).
    function markupHtml(mk) {
      mk = mk || {};
      var def = mk.instance_default || 1;
      return '<div class="wsx-admin__budget" id="wsxBillMarkupBox"><div class="wsx-admin__budgethead"><div class="wsx-admin__cardlbl">' + esc(bt('admin.billMarkup')) + '</div>'
        + '<div class="wsx-admin__cardval">' + esc(bt('admin.billMarkupInForce').replace('{markup}', String(mk.markup || def))) + '</div></div>'
        + '<p class="wsx-field__note" style="margin:6px 0 10px">' + esc(bt('admin.billMarkupIntro').replace('{default}', String(def))) + '</p>'
        + '<div class="wsx-admin__domain-add"><input class="wsx-field__in" style="width:110px" type="number" min="1" max="10" step="0.05" id="wsxBillMarkup" value="' + esc(mk.workspace_markup != null ? String(mk.workspace_markup) : '') + '" placeholder="' + esc(String(def)) + '"> \u00d7'
        + '<button class="wsx-abtn" type="button" id="wsxBillMarkupSave">' + esc(bt('common.save')) + '</button>'
        + (mk.workspace_markup != null ? '<button class="wsx-abtn" type="button" id="wsxBillMarkupReset">' + esc(bt('admin.billMarkupReset')) + '</button>' : '') + '</div></div>';
    }
    function saveMarkup(value, btn) {
      // Usage numbers change with the markup: drop their cached copies too.
      Object.keys(adDataCache).forEach(function (k) { if (k.indexOf('usage') === 0) delete adDataCache[k]; });
      call(wsUrl('/ai-markup'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markup: value }) }, bt('admin.billMarkupSaved'), btn);
    }
    function paint(res) {
      var invoices = (res && res.invoices) || [], manage = !!(res && res.can_manage);
      if (wrap) wrap.hidden = false;
      var head = '<div class="wsx-admin__settings-title">' + esc(bt('admin.billInvoices')) + '</div>';
      if (!res) { m.innerHTML = '<div class="wsx-admin__settings-section">' + head + i18nEmpty('common.couldNotLoad') + '</div>'; return; }
      adBillDelivery = res.delivery || null;
      var due = invoices.filter(function (i) { return i.status === 'open'; });
      var owed = {}; due.forEach(function (i) { owed[i.currency] = (owed[i.currency] || 0) + i.total_cents; });
      var owedTxt = Object.keys(owed).map(function (c) { return money(owed[c], c); }).join(' + ');
      var last = { currency: invoices[0] && invoices[0].currency, notes: (invoices.filter(function (i) { return i.notes; })[0] || {}).notes };
      m.innerHTML = '<div class="wsx-admin__settings-section">' + head + '<p class="wsx-lens__intro">' + esc(bt(manage ? 'admin.billIntroManage' : 'admin.billIntro')) + '</p>'
        + (due.length ? '<div class="wsx-admin__cards"><div class="wsx-admin__card"><div class="wsx-admin__cardlbl">' + esc(bt('admin.billOwed')) + '</div><div class="wsx-admin__cardval">' + esc(owedTxt) + '</div><div class="wsx-admin__cardsub">' + esc(bt('admin.billOwedSub').replace('{n}', String(due.length))) + '</div></div></div>' : '')
        + (manage ? '<div class="wsx-opzone" data-op-zone><div class="wsx-opzone__head">' + opPill() + '<span class="wsx-opzone__sub">' + esc(bt('admin.superOnlySub')) + '</span></div>'
          + markupHtml(res.markup) + '<div class="wsx-auto-bar"><button class="wsx-abtn" type="button" id="wsxBillDocBtn">' + esc(bt('admin.billNewDoc')) + '</button><button class="wsx-abtn" type="button" id="wsxBillNewBtn">' + esc(bt('admin.billNew')) + '</button></div>'
          + docFormHtml(last) + formHtml() + '</div>' : '')
        + (invoices.length ? '<div class="wsx-bill__list">' + invoices.map(function (i) { return invoiceHtml(i, manage); }).join('') + '</div>' : '<div class="wsx-empty">' + esc(bt('admin.billNone')) + '</div>') + '</div>';
      var ms = document.getElementById('wsxBillMarkupSave'), mr = document.getElementById('wsxBillMarkupReset');
      if (ms) ms.addEventListener('click', function () {
        var raw = document.getElementById('wsxBillMarkup').value.trim();
        if (raw === '') { saveMarkup(null, ms); return; }
        var v = Number(raw);
        if (!isFinite(v) || v < 1 || v > 10) { showToast(bt('admin.billMarkupInvalid'), 'error'); return; }
        saveMarkup(v, ms);
      });
      if (mr) mr.addEventListener('click', function () { saveMarkup(null, mr); });
      // The two create forms toggle open; each wires itself the first time it shows.
      [['wsxBillNewBtn', 'wsxBillForm', wireForm], ['wsxBillDocBtn', 'wsxBillDocForm', wireDocForm]].forEach(function (p) {
        var btn = document.getElementById(p[0]);
        if (btn) btn.addEventListener('click', function () { var f = document.getElementById(p[1]); if (f) { f.hidden = !f.hidden; if (!f.hidden && !f.getAttribute('data-wired')) { f.setAttribute('data-wired', '1'); p[2](); } } });
      });
      m.querySelectorAll('details[data-inv]').forEach(function (d) { d.addEventListener('toggle', function () { if (d.open) adBillOpenId = d.getAttribute('data-inv'); }); });
      m.querySelectorAll('[data-inv-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-inv-id'), act = b.getAttribute('data-inv-act'), url = wsUrl('/invoices/' + encodeURIComponent(id));
          adBillOpenId = id;
          if (act === 'delete') { if (!window.confirm(bt('admin.billDeleteConfirm'))) return; call(url, { method: 'DELETE' }, bt('admin.billDeleted_ok'), b); return; }
          if (act === 'send') {
            if (!window.confirm(bt('admin.billResendConfirm').replace('{number}', b.getAttribute('data-inv-num') || '').replace('{to}', ((adBillDelivery && adBillDelivery.to) || []).join(', ')))) return;
            call(url + '/send', { method: 'POST' }, mailToast('admin.billSaved_ok'), b); return;
          }
          if (act === 'void' && !window.confirm(bt('admin.billVoidConfirm'))) return;
          var body = { status: act === 'unpaid' ? 'open' : act };
          if (act === 'paid') { var ref = m.querySelector('[data-inv-ref="' + id + '"]'); if (ref && ref.value.trim()) body.payment_reference = ref.value.trim(); }
          if (act === 'open') { var cb = m.querySelector('[data-inv-send="' + id + '"]'); body.send_email = !!(cb && cb.checked); }
          call(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, act === 'open' ? mailToast('admin.billIssued_ok') : bt('admin.billSaved_ok'), b);
        });
      });
      m.querySelectorAll('[data-inv-up]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-inv-id'), which = b.getAttribute('data-inv-up');
          var input = document.createElement('input');
          input.type = 'file'; input.accept = 'application/pdf,image/png,image/jpeg,image/webp';
          input.addEventListener('change', function () {
            var f = input.files && input.files[0]; if (!f) return;
            if (f.size > 10 * 1024 * 1024) { showToast(bt('admin.billFileTooBig'), 'error'); return; }
            adBillOpenId = id;
            call(wsUrl('/invoices/' + encodeURIComponent(id) + '/' + which + '?name=' + encodeURIComponent(f.name)), { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f },
              bt(which === 'proof' && !manage ? 'admin.billProofPaid_ok' : 'admin.billUploaded_ok'), b);
          });
          input.click();
        });
      });
    }
    swr('billing', paint, function () {
      return fetch(wsUrl('/invoices'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    });
  }
`;
