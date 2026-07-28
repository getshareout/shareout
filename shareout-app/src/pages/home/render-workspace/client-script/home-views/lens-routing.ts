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
    var mineLoaded = false;
    function loadMine() {
      var m = document.getElementById('wsxHelpMine'); if (!m) return;
      fetch('/v1/support/tickets?scope=mine', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ts = (j && j.tickets) || [];
          if (!ts.length) { m.innerHTML = ''; return; }
          m.innerHTML = '<div class="wsx__help-minetitle">' + esc(t('help.yourTickets')) + '</div>' + ts.map(function (tk) {
            return '<div class="wsx__help-mineitem"><span>' + esc(tk.subject) + '</span><span class="wsx-admin__sub">' + esc(tk.status) + ' \\u00B7 ' + adRelDate(tk.last_msg_at) + '</span></div>';
          }).join('');
        }).catch(function () {});
    }
    function open() { panel.hidden = false; if (scrim) scrim.hidden = false; if (!mineLoaded) { mineLoaded = true; loadMine(); } }
    function close() { panel.hidden = true; if (scrim) scrim.hidden = true; }
    btn.addEventListener('click', function () { panel.hidden ? open() : close(); });
    var x = document.getElementById('wsxHelpClose'); if (x) x.addEventListener('click', close);
    if (scrim) scrim.addEventListener('click', close);
    var send = document.getElementById('wsxHelpSend');
    if (send) send.addEventListener('click', function () {
      var subj = (document.getElementById('wsxHelpSubject') || {}).value || '';
      var body = (document.getElementById('wsxHelpBody') || {}).value || '';
      var msg = document.getElementById('wsxHelpMsg');
      if (!subj.trim() || !body.trim()) { if (msg) msg.textContent = t('help.addSummary'); return; }
      if (msg) msg.textContent = t('help.sending');
      var payload = { subject: subj, body: body };
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
