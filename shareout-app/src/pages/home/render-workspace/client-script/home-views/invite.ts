import { PUBLIC_EMAIL_DOMAINS } from '../../../../../workspaces/access-policy';

/** "Invite people" dialog + domain auto-join toggle (Admin → Members, overview, onboarding, palette). */
export const workspace_client_home_views_invite_JS = `  // ===== Invite people =====
  // Mirror of src/workspaces/parse-emails.ts (the shell can't import TS) — keep in step.
  var INV_RE = /^[a-z0-9.!#$%&'*+\\/=?^_\`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  var INV_BATCH = 100;
  function invParse(text) {
    var ok = [], bad = [];
    String(text || '').split(/[,;\\n\\r\\t]+/).forEach(function (piece) {
      var ang = piece.match(/<([^<>]*@[^<>]*)>/);
      (ang ? [ang[1]] : piece.split(/\\s+/)).forEach(function (tok) {
        if (tok.indexOf('@') < 0) return;
        var e = tok.trim().replace(/^mailto:/i, '').replace(/^["'(<[]+|["')>\\].:]+$/g, '').toLowerCase();
        var list = INV_RE.test(e) ? ok : bad;
        if (list.indexOf(e) < 0) list.push(e);
      });
    });
    return { ok: ok, bad: bad };
  }
  var INV_CODE_LABEL = { invited: 'invite.res.invited', added: 'invite.res.added', already_member: 'invite.res.already', invalid_email: 'invite.res.invalid', domain_not_allowed: 'invite.res.domain' };
  function wsxInvite(onDone) {
    if (!window.WSX_WS || !window.WSX_ADMIN) return;
    var md = wsxModal(t('invite.title'),
      '<div class="wsx-cform">'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('invite.emailsLbl')) + '</span><textarea class="wsx-field__in" id="invTa" rows="5" placeholder="' + esc(t('invite.emailsPh')) + '"></textarea></label>'
      + '<p class="wsx-field__note">' + esc(t('invite.emailsNote')) + '</p>'
      + '<div class="wsx-inv__chips" id="invChips"></div>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('invite.roleLbl')) + '</span><select class="wsx-field__in" id="invRole"><option value="member">' + esc(t('admin.roleMember')) + '</option><option value="admin">' + esc(t('admin.roleAdmin')) + '</option></select></label>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('invite.msgLbl')) + '</span><textarea class="wsx-field__in" id="invMsg" rows="2" maxlength="500" placeholder="' + esc(t('invite.msgPh')) + '"></textarea></label>'
      + '<div class="wsx-cform__err" id="invErr"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="invSend" type="button" disabled>' + esc(t('invite.send')) + '</button></div>'
      + '</div>');
    var ta = md.body.querySelector('#invTa'), chips = md.body.querySelector('#invChips'), send = md.body.querySelector('#invSend');
    var parsed = { ok: [], bad: [] };
    function paint() {
      parsed = invParse(ta.value);
      chips.innerHTML = parsed.ok.map(function (e) { return '<span class="wsx-inv__chip">' + esc(e) + '</span>'; }).join('')
        + parsed.bad.map(function (e) { return '<span class="wsx-inv__chip is-bad" title="' + esc(t('invite.res.invalid')) + '">' + esc(e) + '</span>'; }).join('');
      send.disabled = !parsed.ok.length;
      send.textContent = parsed.ok.length ? t(parsed.ok.length === 1 ? 'invite.sendOne' : 'invite.sendN').replace('{n}', String(parsed.ok.length)) : t('invite.send');
      md.body.querySelector('#invErr').textContent = parsed.bad.length ? t('invite.badNote').replace('{n}', String(parsed.bad.length)) : '';
    }
    ta.addEventListener('input', paint);
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 0);
    send.addEventListener('click', function () {
      var role = md.body.querySelector('#invRole').value, msg = (md.body.querySelector('#invMsg').value || '').trim();
      var batches = [];
      for (var i = 0; i < parsed.ok.length; i += INV_BATCH) batches.push(parsed.ok.slice(i, i + INV_BATCH));
      var all = parsed.bad.map(function (e) { return { email: e, code: 'invalid_email' }; });
      adBusy(send);
      (function next(k) {
        if (k >= batches.length) { invShowResults(md, all); if (onDone) onDone(); return; }
        fetch(wsUrl('/members/invite'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: batches[k], role: role, message: msg || undefined }) })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (!j || !j.results) { adIdle(send); md.body.querySelector('#invErr').textContent = (j && j.error) || t('common.failed'); if (all.length) invShowResults(md, all); return; }
            all = all.concat(j.results); next(k + 1);
          })
          .catch(function () { adIdle(send); md.body.querySelector('#invErr').textContent = t('common.failed'); });
      })(0);
    });
  }
  function invShowResults(md, results) {
    var counts = {};
    results.forEach(function (r) { counts[r.code] = (counts[r.code] || 0) + 1; });
    var head = Object.keys(INV_CODE_LABEL).filter(function (c) { return counts[c]; })
      .map(function (c) { return counts[c] + ' ' + t(INV_CODE_LABEL[c]); }).join(' \\u00B7 ');
    md.body.innerHTML = '<div class="wsx-cform"><p class="wsx-inv__sum">' + esc(head) + '</p><div class="wsx-admin__list">'
      + results.map(function (r) {
        var extra = r.invite_url ? ' \\u00B7 ' + esc(t('invite.res.noEmail')) + ' <button class="wsx-atbl__act" data-inv-url="' + esc(r.invite_url) + '" type="button">' + esc(t('admin.copyInviteLink')) + '</button>' : '';
        return '<div class="wsx-admin__row"><div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(r.email) + '</span>'
          + '<span class="wsx-admin__sub ' + (r.code === 'invited' || r.code === 'added' ? 'wsx-admin__mailok' : r.code === 'already_member' ? '' : 'wsx-admin__mailbad') + '">' + esc(t(INV_CODE_LABEL[r.code] || 'common.failed')) + extra + '</span></div></div>';
      }).join('') + '</div>'
      + (counts.domain_not_allowed ? '<p class="wsx-field__note">' + esc(t('invite.domainHint')) + '</p>' : '')
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="invDone" type="button">' + esc(t('invite.done')) + '</button></div></div>';
    md.body.querySelectorAll('[data-inv-url]').forEach(function (b) {
      b.addEventListener('click', function () { invCopy(b, b.getAttribute('data-inv-url')); });
    });
    md.body.querySelector('#invDone').addEventListener('click', md.close);
  }
  function invCopy(b, url) {
    var done = function () { b.textContent = t('admin.inviteLinkCopied'); };
    try { navigator.clipboard.writeText(url).then(done, function () { window.prompt(t('admin.copyInviteLink'), url); done(); }); }
    catch (e) { window.prompt(t('admin.copyInviteLink'), url); done(); }
  }
  // Domain auto-join: anyone who signs in with an allowed-domain email joins as a member
  // (workspaces/access-policy.ts autoJoinWorkspacesByDomain). Public mail providers are
  // never offered (the API refuses them too) — allowing gmail.com would let every Gmail user in.
  var INV_PUBLIC = ${JSON.stringify(PUBLIC_EMAIL_DOMAINS)};
  function invTeamAccess(mount, members) {
    fetch(wsUrl('/access-policy'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
      if (!p) return;
      var domains = (p.allowed_domains || []).slice();
      var tally = {};
      (members || []).forEach(function (m) { var d = String(m.email || '').split('@')[1]; if (d && INV_PUBLIC.indexOf(d) < 0) tally[d] = (tally[d] || 0) + 1; });
      var suggest = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0];
      var shown = domains.slice(); if (suggest && shown.indexOf(suggest) < 0) shown.push(suggest);
      if (!shown.length) { mount.innerHTML = ''; return; }
      var link = location.origin + '/auth/login?redirect=' + encodeURIComponent('/home?workspace=' + window.WSX_WS);
      mount.innerHTML = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('invite.domainTitle')) + '</div>'
        + shown.map(function (d) {
          return '<label class="wsx-field wsx-field--inline"><input type="checkbox" data-inv-dom="' + esc(d) + '"' + (domains.indexOf(d) >= 0 ? ' checked' : '') + '><span>' + esc(t('invite.domainToggle').replace('{domain}', d)) + '</span></label>';
        }).join('')
        + '<p class="wsx-field__note">' + esc(t('invite.domainNote')) + '</p>'
        + (domains.length ? '<div class="wsx-admin__invite"><button class="wsx-abtn" id="invTeamLink" type="button">' + esc(t('invite.teamLink')) + '</button><span class="wsx-field__note">' + esc(t('invite.teamLinkNote').replace('{domain}', domains.join(', @'))) + '</span></div>' : '')
        + '</div>';
      mount.querySelectorAll('[data-inv-dom]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var d = cb.getAttribute('data-inv-dom');
          if (cb.checked && !window.confirm(t('invite.domainConfirm').replace(/\\{domain\\}/g, d))) { cb.checked = false; return; }
          var next = cb.checked ? domains.concat([d]) : domains.filter(function (x) { return x !== d; });
          cb.disabled = true;
          fetch(wsUrl('/access-policy'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_domains: next }) })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok ? j : null; }); })
            .then(function (j) { if (!j) { cb.disabled = false; cb.checked = !cb.checked; return; } delete adDataCache['security']; invTeamAccess(mount, members); });
        });
      });
      var tl = mount.querySelector('#invTeamLink');
      if (tl) tl.addEventListener('click', function () { invCopy(tl, link); });
    }).catch(function () {});
  }
`;
