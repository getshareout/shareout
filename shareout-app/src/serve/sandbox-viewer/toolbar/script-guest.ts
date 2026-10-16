import { js } from './copy';
import type { GuestCopy } from './copy-guest';

/** Markup for the guest panel above the composer (no account; email code flow). */
export function renderGuestPanel(g: GuestCopy): string {
  return `<div class="so-cmt-guest" id="so-cmt-guest">
          <div class="so-cmt-guest-signed" id="so-cmt-guest-signed" hidden>${g.guestAs} <strong id="so-cmt-guest-who"></strong> <span class="so-cmt-agent">${g.guestBadge}</span> <button type="button" onclick="guestSignOut()">${g.guestNotYou}</button></div>
          <div id="so-cmt-guest-form">
            <div class="so-cmt-guest-title">${g.guestTitle}</div>
            <div class="so-cmt-guest-intro">${g.guestIntro}</div>
            <input type="text" class="so-cmt-textarea so-cmt-guest-input" id="so-cmt-guest-name" placeholder="${g.guestName}" aria-label="${g.guestName}" maxlength="80" autocomplete="name">
            <input type="email" class="so-cmt-textarea so-cmt-guest-input" id="so-cmt-guest-email" placeholder="${g.guestEmail}" aria-label="${g.guestEmail}" maxlength="254" autocomplete="email">
            <button type="button" class="so-cmt-submit" id="so-cmt-guest-send" onclick="guestSendCode()">${g.guestSendCode}</button>
            <div class="so-cmt-guest-code" id="so-cmt-guest-codewrap" hidden>
              <input type="text" class="so-cmt-textarea so-cmt-guest-input" id="so-cmt-guest-code" placeholder="${g.guestCode}" aria-label="${g.guestCode}" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
              <button type="button" class="so-cmt-submit" onclick="guestVerify()">${g.guestConfirm}</button>
            </div>
            <div class="so-cmt-guest-msg" id="so-cmt-guest-msg" aria-live="polite"></div>
          </div>
        </div>`;
}

/** Client script for the guest flow. Runs after the comments script (shares its scope: cmtApi, isPanelOpen). */
export function renderToolbarScriptGuest(g: GuestCopy): string {
  return `
    var gApi = cmtApi + '/_guest';
    window.soGuest = { name: null };
    function gEl(id) { return document.getElementById(id); }
    function gMsg(text, tone) {
      var m = gEl('so-cmt-guest-msg');
      if (m) { m.textContent = text || ''; m.className = 'so-cmt-guest-msg' + (tone ? ' is-' + tone : ''); }
    }
    function gRender() {
      var form = gEl('so-cmt-guest-form'), signed = gEl('so-cmt-guest-signed');
      if (!form || !signed) return;
      var n = window.soGuest.name;
      signed.hidden = !n;
      form.hidden = !!n;
      if (n) gEl('so-cmt-guest-who').textContent = n;
    }
    function gFields() {
      return {
        name: (gEl('so-cmt-guest-name').value || '').trim(),
        email: (gEl('so-cmt-guest-email').value || '').trim(),
        code: (gEl('so-cmt-guest-code').value || '').trim()
      };
    }
    function gPost(path, body) {
      return fetch(gApi + path, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function(r) {
        return r.json().catch(function() { return {}; }).then(function(j) { return { ok: r.ok, status: r.status, body: j }; });
      });
    }
    window.guestSendCode = function() {
      var f = gFields();
      if (!f.name || f.email.indexOf('@') < 1) { gMsg('${js(g.guestNeedFields)}', 'error'); return; }
      var btn = gEl('so-cmt-guest-send');
      btn.disabled = true;
      gPost('/code', { name: f.name, email: f.email }).then(function(res) {
        btn.disabled = false;
        if (res.ok) { gEl('so-cmt-guest-codewrap').hidden = false; gMsg('${js(g.guestCodeSent)}', 'success'); gEl('so-cmt-guest-code').focus(); return; }
        gMsg(res.status === 429 ? '${js(g.guestTooMany)}' : '${js(g.guestSendFail)}', 'error');
      }).catch(function() { btn.disabled = false; gMsg('${js(g.guestSendFail)}', 'error'); });
    };
    window.guestVerify = function() {
      var f = gFields();
      if (!/^[0-9]{6}$/.test(f.code)) { gMsg('${js(g.guestWrongCode)}', 'error'); return; }
      gPost('/verify', { name: f.name, email: f.email, code: f.code }).then(function(res) {
        var d = res.body && res.body.data;
        if (res.ok && d && d.guest) {
          window.soGuest.name = d.guest.name;
          gEl('so-cmt-guest-code').value = '';
          gMsg('');
          gRender();
          var ta = gEl('so-cmt-input');
          if (ta) ta.focus();
          return;
        }
        gMsg(res.status === 429 ? '${js(g.guestTooMany)}' : '${js(g.guestWrongCode)}', 'error');
      }).catch(function() { gMsg('${js(g.guestWrongCode)}', 'error'); });
    };
    window.guestSignOut = function() {
      fetch(gApi, { method: 'DELETE', credentials: 'include' }).catch(function() {});
      window.soGuest.name = null;
      gRender();
    };
    window.soGuest.prompt = function() {
      if (!isPanelOpen()) window.openComments();
      gRender();
      gMsg('${js(g.guestNeedVerify)}', 'error');
      var n = gEl('so-cmt-guest-name');
      if (n) n.focus();
    };
    window.soGuest.expired = function() {
      window.soGuest.name = null;
      gRender();
      gMsg('${js(g.guestExpired)}', 'error');
    };
    fetch(gApi, { credentials: 'include' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(res) { var d = res && res.data; if (d && d.guest) window.soGuest.name = d.guest.name; gRender(); })
      .catch(function() {});`;
}
