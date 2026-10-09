/** Lens tab routing, lazy view loading, and help panel. */
export const workspace_client_home_views_lensRouting_JS = `  var lenses = ws.querySelectorAll('[data-lens]');
  var loaded = {};
  function openView(key) {
    if (key !== 'knowledge' && typeof knStopPoll === 'function') knStopPoll();
    activateTab('home'); show(key === 'brief' ? 'brief' : key);
    if (key === 'artifacts') loadArtifacts();
    else if (key === 'assets' && !loaded.assets) { loaded.assets = 1; loadAssets(); }
    else if (key === 'schedules' && !loaded.schedules) { loaded.schedules = 1; loadSchedules(); }
    else if (key === 'alerts' && !loaded.alerts) { loaded.alerts = 1; loadAlerts(); }
    else if (key === 'analytics' && !loaded.analytics) { loaded.analytics = 1; loadAccountAnalytics(); }
    else if (key === 'datasets' && !loaded.datasets) { loaded.datasets = 1; loadDatasets(); }
    else if (key === 'crew' && !loaded.crew) { loaded.crew = 1; loadCrew(); }
    else if (key === 'library' && !loaded.library) { loaded.library = 1; loadLibrary(); }
    else if (key === 'connectors' && !loaded.connectors) { loaded.connectors = 1; loadConnectors(); }
    else if (key === 'connect') loadConnect();
    else if (key === 'catalog' && !loaded.catalog) { loaded.catalog = 1; loadCatalog(); }
    else if (key === 'knowledge' && !loaded.knowledge) { loaded.knowledge = 1; loadKnowledge(); }
    else if (key === 'admin' && !loaded.admin) { loaded.admin = 1; loadAdmin(); }
    if (typeof syncHash === 'function') syncHash();
  }
  lenses.forEach(function (b) {
    b.addEventListener('click', function () {
      exitCreate();
      lenses.forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      openView(b.getAttribute('data-lens'));
    });
  });

  (function () {
    var btn = document.getElementById('wsxHelpBtn'), panel = document.getElementById('wsxHelpPanel'), scrim = document.getElementById('wsxHelpScrim');
    if (!btn || !panel) return;
    var form = document.getElementById('wsxHelpForm');
    var mineLoaded = false;
    function loadMine() {
      var m = document.getElementById('wsxHelpMine'); if (!m) return;
      if (form) form.hidden = false;
      fetch('/v1/support/tickets?scope=mine', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ts = (j && j.tickets) || [];
          if (!ts.length) { m.innerHTML = ''; return; }
          m.innerHTML = '<div class="wsx__help-minetitle">' + esc(t('help.yourTickets')) + '</div>' + ts.map(function (tk) {
            return '<div class="wsx__help-mineitem" role="button" tabindex="0" data-help-ticket="' + esc(tk.id) + '"><span>' + esc(tk.subject) + '</span><span class="wsx-admin__sub">' + esc(t('help.status.' + tk.status)) + ' \\u00B7 ' + adRelDate(tk.last_msg_at) + '</span></div>';
          }).join('');
        }).catch(function () {});
    }
    function openThread(id) {
      var m = document.getElementById('wsxHelpMine'); if (!m) return;
      fetch('/v1/support/tickets/' + encodeURIComponent(id), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.ticket) return;
          if (form) form.hidden = true;
          m.innerHTML = '<button type="button" class="wsx-link" data-help-back>' + esc(t('help.back')) + '</button>'
            + '<div class="wsx__help-minetitle">' + esc(j.ticket.subject) + '</div>'
            + '<div class="wsx__help-thread">' + (j.thread || []).map(function (msg) {
              var who = msg.author === 'customer' ? t('help.you') : t('help.team');
              return '<div class="wsx__help-msg' + (msg.author === 'customer' ? '' : ' wsx__help-msg--staff') + '"><div class="wsx-admin__sub">' + esc(who) + ' \\u00B7 ' + adRelDate(msg.created_at) + '</div>' + esc(msg.body) + '</div>';
            }).join('') + '</div>'
            + '<div class="wsx-field"><textarea class="wsx-field__in wsx-field__ta" id="wsxHelpReply" placeholder="' + esc(t('help.replyPlaceholder')) + '"></textarea></div>'
            + '<div class="wsx__help-actions"><button class="wsx-abtn" type="button" data-help-reply="' + esc(j.ticket.id) + '">' + esc(t('help.send')) + '</button><span class="wsx-admin__savemsg" id="wsxHelpReplyMsg"></span></div>';
          var th = m.querySelector('.wsx__help-thread'); if (th) th.scrollTop = th.scrollHeight;
        }).catch(function () {});
    }
    function sendReply(id) {
      var ta = document.getElementById('wsxHelpReply'), out = document.getElementById('wsxHelpReplyMsg');
      var body = ta ? ta.value.trim() : '';
      if (!body) return;
      if (out) out.textContent = t('help.sending');
      fetch('/v1/support/tickets/' + encodeURIComponent(id) + '/message', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: body }) })
        .then(function (r) { if (!r.ok) throw new Error(); openThread(id); })
        .catch(function () { if (out) out.textContent = t('help.couldNotSend'); });
    }
    var mineEl = document.getElementById('wsxHelpMine');
    if (mineEl) {
      mineEl.addEventListener('click', function (e) {
        var row = e.target.closest('[data-help-ticket]'); if (row) { openThread(row.getAttribute('data-help-ticket')); return; }
        if (e.target.closest('[data-help-back]')) { loadMine(); return; }
        var rp = e.target.closest('[data-help-reply]'); if (rp) sendReply(rp.getAttribute('data-help-reply'));
      });
      mineEl.addEventListener('keydown', function (e) {
        var row = e.key === 'Enter' && e.target.closest('[data-help-ticket]'); if (row) openThread(row.getAttribute('data-help-ticket'));
      });
    }
    function open() { panel.hidden = false; if (scrim) scrim.hidden = false; if (!mineLoaded) { mineLoaded = true; loadMine(); } }
    function close() { panel.hidden = true; if (scrim) scrim.hidden = true; }
    btn.addEventListener('click', function () { panel.hidden ? open() : close(); });
    var x = document.getElementById('wsxHelpClose'); if (x) x.addEventListener('click', close);
    if (scrim) scrim.addEventListener('click', close);
    if (location.hash === '#help') open();
    var send = document.getElementById('wsxHelpSend');
    if (send) send.addEventListener('click', function () {
      var subj = (document.getElementById('wsxHelpSubject') || {}).value || '';
      var body = (document.getElementById('wsxHelpBody') || {}).value || '';
      var msg = document.getElementById('wsxHelpMsg');
      if (!subj.trim() || !body.trim()) { if (msg) msg.textContent = t('help.addSummary'); return; }
      if (msg) msg.textContent = t('help.sending');
      var payload = {
        subject: subj, body: body,
        category: (document.getElementById('wsxHelpCategory') || {}).value || 'other',
        pageUrl: location.href, userAgent: navigator.userAgent,
        locale: document.documentElement.lang === 'es' ? 'es' : 'en'
      };
      if (window.WSX_WS) payload.workspaceId = window.WSX_WS;
      fetch('/v1/support/tickets', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          if (res && res.success) {
            if (msg) msg.textContent = t('help.sent');
            document.getElementById('wsxHelpSubject').value = ''; document.getElementById('wsxHelpBody').value = '';
            mineLoaded = true; loadMine();
          } else { if (msg) msg.textContent = t('help.couldNotSend'); }
        }).catch(function () { if (msg) msg.textContent = t('help.couldNotSend'); });
    });
  })();

  // Retry from an error empty-state (i18nError): drop the loaded cache and re-run the
  // active lens loader — same mechanism the locale switch uses below.
  ws.addEventListener('click', function (e) {
    if (!(e.target && e.target.closest && e.target.closest('[data-empty-retry]'))) return;
    e.preventDefault();
    loaded = {};
    var a = ws.querySelector('[data-lens].is-active');
    if (a) openView(a.getAttribute('data-lens'));
    else if (typeof loadFeed === 'function') loadFeed();
  });

  document.addEventListener('shareout:locale', function () {
    loaded = {};
    var activeLens = ws.querySelector('[data-lens].is-active');
    if (activeLens) openView(activeLens.getAttribute('data-lens'));
    else if (typeof loadFeed === 'function') loadFeed();
    if (tabs && tabs[0]) tabs[0].label = t('tabs.home');
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof paintRail === 'function' && typeof activeArt !== 'undefined' && activeArt) paintRail();
  });

`;
