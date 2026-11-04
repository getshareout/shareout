/** Admin → Billing, last card: the billing details invoices are made out to (GET/PUT /v1/workspaces/{ws}/billing-profile).
 *  Read-only facts with an Edit button once saved; the form straight away while empty. Copy: BILL_COPY (admin-billing-copy.ts).
 *  Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminBillingProfile_JS = `  var BP_COUNTRIES = ['AR', 'UY', 'CL', 'PY', 'BR', 'MX', 'ES', 'US'];
  var adBpEditing = false;
  function adBillProfile() {
    var m = adM('billprofile'); if (needWs(m)) return;
    function region(code) { try { return new Intl.DisplayNames([locTag()], { type: 'region' }).of(code) || code; } catch (e) { return code; } }
    function taxIdLabel(country) { return bt(country === 'AR' ? 'admin.bpTaxIdAR' : 'admin.bpTaxId'); }
    function fld(id, label, value, opts) {
      opts = opts || {};
      return '<label class="wsx-field" data-bp-f="' + id + '"' + (opts.hidden ? ' hidden' : '') + '><span class="wsx-field__lbl">' + esc(label) + '</span>'
        + (opts.select
          ? '<select class="wsx-field__in" name="' + id + '">' + opts.select + '</select>'
          : '<input class="wsx-field__in" name="' + id + '" value="' + esc(value || '') + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + (opts.type ? ' type="' + opts.type + '"' : '') + (opts.auto ? ' autocomplete="' + opts.auto + '"' : '') + '>')
        + '<span class="wsx-field__err" data-bp-err="' + id + '"></span></label>';
    }
    function opt(v, label, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    function paint(d) {
      if (!d) { m.innerHTML = i18nEmpty('common.couldNotLoad'); return; }
      var p = d.profile, conds = d.tax_conditions || [];
      var head = '<div class="wsx-admin__settings-title">' + esc(bt('admin.bpTitle')) + '</div><p class="wsx-lens__intro">' + esc(bt('admin.bpIntro')) + '</p>';
      if (p && !adBpEditing) {
        var ar = p.country === 'AR';
        var rows = [
          [bt('admin.bpLegalName'), p.legal_name],
          [taxIdLabel(p.country), p.tax_id_display || p.tax_id],
          ar ? [bt('admin.bpTaxCondition'), bt('admin.bpTax_' + p.tax_condition)] : null,
          [bt('admin.bpAddress'), [p.address, p.city, p.province, p.postal_code].filter(Boolean).join(', ')],
          [bt('admin.bpCountry'), region(p.country)],
          [bt('admin.bpPhone'), p.phone],
          p.billing_email ? [bt('admin.bpEmail'), p.billing_email] : null,
        ].filter(Boolean);
        m.innerHTML = '<div class="wsx-admin__settings-section" id="wsxBillProfile">' + head
          + '<dl class="wsx-sum__facts">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1] || '\\u2014') + '</dd>'; }).join('') + '</dl>'
          + '<div class="wsx-cform__foot"><span class="wsx-atbl__type wsx-bp__meta">' + esc(bt('admin.bpUpdated').replace('{when}', adRelDate(p.updated_at)).replace('{who}', p.updated_by_email || '\\u2014')) + '</span>'
          + (d.can_edit ? '<button class="wsx-abtn" type="button" id="wsxBpEdit">' + esc(bt('admin.bpEdit')) + '</button>' : '') + '</div></div>';
        var eb = document.getElementById('wsxBpEdit');
        if (eb) eb.addEventListener('click', function () { adBpEditing = true; paint(d); });
        return;
      }
      if (!d.can_edit) { m.innerHTML = '<div class="wsx-admin__settings-section" id="wsxBillProfile">' + head + i18nEmpty('admin.bpMissing') + '</div>'; return; }
      var v = p || { country: 'AR' }, country = v.country || 'AR';
      var countries = BP_COUNTRIES.indexOf(country) < 0 ? BP_COUNTRIES.concat([country]) : BP_COUNTRIES;
      m.innerHTML = '<div class="wsx-admin__settings-section" id="wsxBillProfile">' + head + (p ? '' : '<p class="wsx-lens__intro">' + esc(bt('admin.bpMissing')) + '</p>')
        + '<form class="wsx-cform" id="wsxBpForm" novalidate>'
        + '<div class="wsx-cform__row">' + fld('country', bt('admin.bpCountry'), '', { select: countries.map(function (c) { return opt(c, region(c), c === country); }).join('') })
        + fld('legal_name', bt('admin.bpLegalName'), v.legal_name, { auto: 'organization' }) + '</div>'
        + '<div class="wsx-cform__row">' + fld('tax_id', taxIdLabel(country), v.tax_id_display || v.tax_id, { ph: country === 'AR' ? '30-12345678-9' : '' })
        + fld('tax_condition', bt('admin.bpTaxCondition'), '', { hidden: country !== 'AR', select: opt('', bt('admin.bpTaxCondPick'), !v.tax_condition) + conds.map(function (c) { return opt(c, bt('admin.bpTax_' + c), c === v.tax_condition); }).join('') }) + '</div>'
        + fld('address', bt('admin.bpAddress'), v.address, { ph: bt('admin.bpAddressPh'), auto: 'street-address' })
        + '<div class="wsx-cform__row">' + fld('city', bt('admin.bpCity'), v.city, { auto: 'address-level2' }) + fld('province', bt('admin.bpProvince'), v.province, { auto: 'address-level1' })
        + fld('postal_code', bt('admin.bpPostal'), v.postal_code, { auto: 'postal-code' }) + '</div>'
        + '<div class="wsx-cform__row">' + fld('phone', bt('admin.bpPhone'), v.phone, { type: 'tel', auto: 'tel' }) + fld('billing_email', bt('admin.bpEmail'), v.billing_email, { type: 'email', auto: 'email' }) + '</div>'
        + '<div class="wsx-cform__err" id="wsxBpErr" role="alert"></div>'
        + '<div class="wsx-cform__foot">' + (p ? '<button class="wsx-abtn" type="button" id="wsxBpCancel">' + esc(bt('admin.bpCancel')) + '</button>' : '')
        + '<button class="wsx-abtn wsx-abtn--primary" type="submit" id="wsxBpSave">' + esc(bt('admin.bpSave')) + '</button></div></form></div>';
      var form = document.getElementById('wsxBpForm');
      function fe(k) { return form.querySelector('[name="' + k + '"]'); }
      fe('country').addEventListener('change', function () {
        var c = fe('country').value;
        form.querySelector('[data-bp-f="tax_condition"]').hidden = c !== 'AR';
        form.querySelector('[data-bp-f="tax_id"] .wsx-field__lbl').textContent = taxIdLabel(c);
      });
      var cb = document.getElementById('wsxBpCancel');
      if (cb) cb.addEventListener('click', function () { adBpEditing = false; paint(d); });
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var body = {}; ['country', 'legal_name', 'tax_id', 'tax_condition', 'address', 'city', 'province', 'postal_code', 'phone', 'billing_email'].forEach(function (k) { body[k] = fe(k).value; });
        form.querySelectorAll('.wsx-field').forEach(function (f) { f.classList.remove('is-bad'); });
        form.querySelectorAll('[data-bp-err]').forEach(function (e) { e.textContent = ''; });
        var err = document.getElementById('wsxBpErr'); err.textContent = '';
        var save = document.getElementById('wsxBpSave'); adBusy(save);
        fetch(wsUrl('/billing-profile'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            adIdle(save);
            if (res.ok) { adBpEditing = false; adDataCache.billprofile = res.j; showToast(bt('admin.bpSaved'), 'success'); paint(res.j); return; }
            var fields = (res.j && res.j.fields) || null;
            if (!fields) { err.textContent = bt('admin.bpFailed'); return; }
            err.textContent = bt('admin.bpFix');
            Object.keys(fields).forEach(function (k) {
              var f = form.querySelector('[data-bp-f="' + k + '"]'); if (!f) return;
              f.classList.add('is-bad');
              var code = fields[k], special = code === 'invalid' ? (k + (body.country === 'AR' && (k === 'tax_id' || k === 'postal_code') ? '_AR' : '')) : '';
              var msg = special && BILL_COPY.en['admin.bpErr_' + special] ? bt('admin.bpErr_' + special) : bt('admin.bpErr_' + code);
              f.querySelector('[data-bp-err]').textContent = msg;
            });
            var first = form.querySelector('.wsx-field.is-bad .wsx-field__in'); if (first) first.focus();
          })
          .catch(function () { adIdle(save); err.textContent = bt('admin.bpFailed'); });
      });
    }
    swr('billprofile', paint, function () {
      return fetch(wsUrl('/billing-profile'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; });
    });
  }
`;
