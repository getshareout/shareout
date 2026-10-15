/** Connect your agent (/home?view=connect): Claude / ChatGPT connector steps + personal keys. */
export const workspace_client_home_views_connect_JS = `  // ----- Connect your agent — connector URL + steps per app, personal keys for local agents -----
  var cnTab = 'claude', cnNewKey = '';
  function cnOrigin() { return window.WSX_ORIGIN || location.origin; }
  function cnSteps(key) { return '<ol class="wsx-cn__steps">' + t(key).split('|').map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'; }
  // Copy buttons name WHAT to copy (url | key | prompt), never carry the text in an attribute.
  function cnCopyBtn(what, label, primary) { return '<button class="wsx-abtn' + (primary ? ' wsx-abtn--primary' : '') + '" type="button" data-cn-copy="' + what + '">' + esc(t(label)) + '</button>'; }
  function cnCopyText(what) { return what === 'url' ? cnOrigin() + '/mcp' : what === 'key' ? cnNewKey : cnPrompt(); }
  function cnPrompt() {
    return t(window.WSX_WS ? 'connect.prompt' : 'connect.promptPersonal')
      .split('{origin}').join(cnOrigin())
      .split('{token}').join(cnNewKey || t('connect.keyPlaceholder'))
      .split('{ws}').join(window.WSX_WS || '');
  }
  function loadConnect() {
    var m = document.getElementById('wsxCnMount'); if (!m) return;
    ws.querySelectorAll('[data-cn-tab]').forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-cn-tab') === cnTab); });
    if (cnTab !== 'code') {
      var claude = cnTab === 'claude', url = cnOrigin() + '/mcp';
      m.innerHTML = '<div class="wsx-cn"><div class="wsx-sched">'
        + '<div class="wsx-field__lbl">' + esc(t('connect.urlLabel')) + '</div>'
        + '<div class="wsx-cn__url"><code>' + esc(url) + '</code>' + cnCopyBtn('url', 'connect.copy', true) + '</div>'
        + cnSteps(claude ? 'connect.claudeSteps' : 'connect.chatgptSteps')
        + '<p class="wsx-field__note">' + esc(t(claude ? 'connect.claudeNote' : 'connect.chatgptNote')) + '</p></div></div>';
      return;
    }
    var prompt = cnPrompt();
    m.innerHTML = '<div class="wsx-cn"><p class="wsx-lens__intro">' + esc(t('connect.codeIntro')) + '</p>'
      + '<div class="wsx-sched"><div class="wsx-sched__title">' + esc(t('connect.keysTitle')) + '</div><div id="wsxCnKeys">' + i18nLoad() + '</div>'
      + (cnNewKey ? '<div class="wsx-cn__new"><pre class="wsx-skill__pre">' + esc(cnNewKey) + '</pre><p class="wsx-field__note">' + esc(t('connect.keyOnce')) + '</p><div class="wsx-skill__btns">' + cnCopyBtn('key', 'connect.copy', false) + '</div></div>' : '')
      + '<div class="wsx-skill__btns"><button class="wsx-abtn' + (cnNewKey ? '' : ' wsx-abtn--primary') + '" type="button" id="wsxCnCreate">' + esc(t('connect.createKey')) + '</button></div>'
      + '<p class="wsx-cform__err" id="wsxCnErr"></p></div>'
      + '<div class="wsx-sched"><div class="wsx-sched__title">' + esc(t('connect.promptTitle')) + '</div>'
      + (cnNewKey ? '' : '<p class="wsx-field__note">' + esc(t('connect.promptNeedsKey')) + '</p>')
      + '<pre class="wsx-skill__pre">' + esc(prompt) + '</pre><div class="wsx-skill__btns">' + cnCopyBtn('prompt', 'connect.copyPrompt', !!cnNewKey) + '</div></div></div>';
    // Exception to optimistic: the key is generated server-side and shown once.
    document.getElementById('wsxCnCreate').addEventListener('click', function () {
      var b = this, label = b.textContent; b.disabled = true; b.textContent = t('common.creating');
      fetch('/v1/me/tokens', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(okOr)
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d || !d.token) throw new Error('failed'); cnNewKey = d.token; loadConnect(); })
        .catch(function (err) { b.disabled = false; b.textContent = label; var e = document.getElementById('wsxCnErr'); if (e) e.textContent = errReason(err, t('connect.keyError')); });
    });
    cnLoadKeys();
  }
  // Keys revoked optimistically whose DELETE hasn't landed — a reload keeps them out.
  var pendingKeyRevokes = {};
  function cnLoadKeys() {
    var k = document.getElementById('wsxCnKeys'); if (!k) return;
    fetch('/v1/me/tokens', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var ts = ((d && d.tokens) || []).filter(function (tk) { return !pendingKeyRevokes[tk.id]; });
        if (!ts.length) { k.innerHTML = '<p class="wsx-field__note">' + esc(t('connect.keysNone')) + '</p>'; return; }
        k.innerHTML = ts.map(function (tk) {
          var used = tk.last_used_at ? t('connect.keyUsed').replace('{date}', adRelDate(tk.last_used_at)) : t('connect.keyNeverUsed');
          return '<div class="wsx-cn__key"><span><b>' + esc(tk.name || '') + '</b> <span class="wsx-skill__hint">' + esc(t('connect.keyCreated').replace('{date}', adRelDate(tk.created_at))) + ' \\u00B7 ' + esc(used) + '</span></span>'
            + '<button class="wsx-abtn danger" type="button" data-cn-revoke="' + esc(tk.id) + '">' + esc(t('connect.revoke')) + '</button></div>';
        }).join('');
      }).catch(function () { k.innerHTML = i18nError('common.couldNotLoad'); });
  }
  ws.addEventListener('click', function (e) {
    var tg = e.target && e.target.closest ? e.target : null; if (!tg) return;
    var tab = tg.closest('[data-cn-tab]');
    if (tab) { cnTab = tab.getAttribute('data-cn-tab'); loadConnect(); return; }
    var cp = tg.closest('[data-cn-copy]');
    if (cp) { copyText(cnCopyText(cp.getAttribute('data-cn-copy')), cp); return; }
    var rv = tg.closest('[data-cn-revoke]');
    if (rv) {
      if (!window.confirm(t('connect.revokeConfirm'))) return;
      var kid = rv.getAttribute('data-cn-revoke'), gone = null;
      optimistic({
        key: 'key:revoke:' + kid,
        undo: true,
        apply: function () { pendingKeyRevokes[kid] = true; gone = window.soOptimistic.leave(rv.closest('.wsx-cn__key')); },
        rollback: function () { delete pendingKeyRevokes[kid]; if (gone) gone.restore(); },
        request: function () { return fetch('/v1/me/tokens/' + encodeURIComponent(kid), { method: 'DELETE', credentials: 'same-origin', keepalive: true }); },
        success: t('connect.revoked'),
        error: t('connect.revokeError'),
        done: function () { delete pendingKeyRevokes[kid]; if (gone) gone.commit(); cnLoadKeys(); },
      });
      return;
    }
    // Account menu "API token": open the view in place so ?workspace= context is kept.
    var op = tg.closest('[data-cn-open]');
    if (op) {
      e.preventDefault(); cnTab = op.getAttribute('data-cn-open');
      var cl = document.getElementById('wsxAccClose'); if (cl) cl.click();
      var lb = ws.querySelector('[data-lens="connect"]'); if (lb) lb.click();
    }
  });

`;
