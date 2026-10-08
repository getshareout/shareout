/**
 * Agent dock: saved-thread history drawer (open / replay, inline rename + in-panel
 * delete confirm behind an always-visible ⋯ menu) and in-thread search. Runs right
 * after agent-dock in the shared IIFE, so its helpers (el, makeCol, addMsg, addBot,
 * openComposer, scroller…) are in scope.
 */
export const workspace_client_agent_threads_JS = `  // ----- thread history drawer -----
  var threadsPanel = document.getElementById('wsxThreads');
  var threadsList = document.getElementById('wsxThreadsList');
  var threadsBtn = document.getElementById('wsxThreadsBtn');
  function newChat() {
    setThread(null); threadList.innerHTML = ''; lastRole = null; emptyEl = null;
    showEmpty();
    if (threadsPanel) threadsPanel.hidden = true;
    openComposer(); if (ask) ask.focus();
  }
  var REPLAY_CAP = 30;
  function renderMsg(m) {
    if (m.role === 'assistant') addBot(m.content); else addMsg('user', m.content);
  }
  function replay(messages) {
    messages = messages || [];
    threadList.innerHTML = ''; lastRole = null; emptyEl = null;
    if (!messages.length) { showEmpty(); return; }
    replaying = true;
    var start = Math.max(0, messages.length - REPLAY_CAP);
    if (start > 0) {
      // Cap the eager render of very long threads; reveal the rest on demand,
      // preserving the reader's place across the prepend. [12,14]
      var more = el('button', 'wsx-loadearlier'); more.type = 'button';
      more.textContent = t(start > 1 ? 'agent.loadEarlierPlural' : 'agent.loadEarlier').replace('{n}', String(start));
      more.addEventListener('click', function () {
        function full() { threadList.innerHTML = ''; lastRole = null; replaying = true; messages.forEach(renderMsg); replaying = false; }
        if (scroller) scroller.preserveOnPrepend(full); else full();
      });
      threadList.appendChild(more);
    }
    messages.slice(start).forEach(renderMsg);
    replaying = false;
    // Reopen at the last user message, not the absolute bottom. [11]
    var rows = threadList.querySelectorAll('.wsx-row.user');
    var lastUser = rows.length ? rows[rows.length - 1] : null;
    if (scroller && lastUser) scroller.scrollToAnchor(lastUser); else scrollEnd(true);
  }
  function openThread(id, silent) {
    setThread(id);
    fetch(API + '/threads/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { if (silent) showEmpty(); else addError('agent.couldNotLoadChat'); return; }
        replay(j.messages); if (!silent) openComposer();
      })
      .catch(function () { if (silent) showEmpty(); });
    if (threadsPanel) threadsPanel.hidden = true;
  }
  function threadPost(id, suffix, method, body) {
    return fetch(API + '/threads/' + encodeURIComponent(id) + suffix, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (!r.ok) throw new Error('thread ' + method + ' ' + r.status); return r; });
  }
  // One row per saved chat: open button + always-visible ⋯ that reveals Rename / Delete.
  function threadRow(th) {
    var row = el('div', 'wsx-thread' + (th.id === currentThreadId ? ' is-active' : ''));
    var line = el('div', 'wsx-thread__line');
    var main = el('button', 'wsx-thread__main'); main.type = 'button';
    var ti = el('span', 'wsx-thread__title'); ti.textContent = th.title || t('agent.newChat');
    var pv = el('span', 'wsx-thread__preview'); pv.textContent = splitAttachments(th.preview || '').text;
    main.appendChild(ti); main.appendChild(pv);
    main.addEventListener('click', function () { openThread(th.id); });
    var more = el('button', 'wsx-thread__more'); more.type = 'button'; more.textContent = '\\u22EF';
    more.setAttribute('aria-label', t('agent.threadMenu')); more.title = t('agent.threadMenu');
    more.setAttribute('aria-expanded', 'false');
    line.appendChild(main); line.appendChild(more); row.appendChild(line);
    var panel = el('div', 'wsx-thread__panel'); panel.hidden = true; row.appendChild(panel);
    function closePanel(focusMore) { panel.hidden = true; panel.innerHTML = ''; more.setAttribute('aria-expanded', 'false'); if (focusMore) more.focus(); }
    function btn(cls, label, fn) { var b = el('button', cls); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; }
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closePanel(true); } });
    function showMenu() {
      panel.innerHTML = '';
      panel.appendChild(btn('wsx-thread__opt', t('agent.rename'), showRename));
      panel.appendChild(btn('wsx-thread__opt is-danger', t('common.delete'), showDelete));
      panel.hidden = false; more.setAttribute('aria-expanded', 'true');
      panel.firstChild.focus();
    }
    function showRename() {
      panel.innerHTML = '';
      var inp = el('input', 'wsx-thread__input'); inp.type = 'text'; inp.value = th.title || ''; inp.setAttribute('aria-label', t('agent.renameChat'));
      var msg = el('span', 'wsx-thread__msg');
      function save() {
        var nv = inp.value.trim(); if (!nv) { closePanel(true); return; }
        threadPost(th.id, '/rename', 'POST', { title: nv })
          .then(function () { th.title = nv; ti.textContent = nv; closePanel(true); })
          .catch(function () { msg.textContent = t('agent.renameFail'); });
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      panel.appendChild(inp);
      panel.appendChild(btn('wsx-thread__opt is-primary', t('common.save'), save));
      panel.appendChild(btn('wsx-thread__opt', t('agent.cancel'), function () { closePanel(true); }));
      panel.appendChild(msg);
      inp.focus(); inp.select();
    }
    function showDelete() {
      panel.innerHTML = '';
      var q = el('span', 'wsx-thread__msg'); q.textContent = t('agent.deleteChat');
      panel.appendChild(q);
      var yes = btn('wsx-thread__opt is-danger', t('common.delete'), function () {
        threadPost(th.id, '', 'DELETE')
          .then(function () { row.remove(); if (th.id === currentThreadId) newChat(); if (threadsList && !threadsList.children.length) threadsList.innerHTML = i18nEmpty('agent.noSavedChats'); })
          .catch(function () { q.textContent = t('agent.deleteFail'); });
      });
      panel.appendChild(yes);
      panel.appendChild(btn('wsx-thread__opt', t('agent.cancel'), function () { closePanel(true); }));
      yes.focus();
    }
    more.addEventListener('click', function () { if (panel.hidden) showMenu(); else closePanel(false); });
    return row;
  }
  function loadThreads() {
    if (!threadsList) return;
    threadsList.innerHTML = i18nLoad();
    fetch(API + '/threads', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { threads: [] }; })
      .then(function (j) {
        var ts = (j && j.threads) || [];
        if (!ts.length) { threadsList.innerHTML = i18nEmpty('agent.noSavedChats'); return; }
        threadsList.innerHTML = '';
        ts.forEach(function (th) { threadsList.appendChild(threadRow(th)); });
        var first = threadsList.querySelector('.wsx-thread__main'); if (first) first.focus();
      })
      .catch(function () { threadsList.innerHTML = i18nEmpty('agent.couldNotHistory'); });
  }
  var threadsClose = document.getElementById('wsxThreadsClose');
  var newChatBtn = document.getElementById('wsxNewChat');
  if (threadsBtn) threadsBtn.addEventListener('click', function () {
    openComposer();
    if (!threadsPanel) return;
    var show = threadsPanel.hidden; threadsPanel.hidden = !show;
    threadsBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) loadThreads();
  });
  if (threadsClose) threadsClose.addEventListener('click', function () { if (threadsPanel) threadsPanel.hidden = true; if (threadsBtn) { threadsBtn.setAttribute('aria-expanded', 'false'); threadsBtn.focus(); } });
  if (newChatBtn) newChatBtn.addEventListener('click', newChat);

  // ----- in-thread search (chat-core; only when the global is present) [10] -----
  var searchBar = document.getElementById('wsxSearch');
  var searchBtn = document.getElementById('wsxSearchBtn');
  if (searchBtn && !CC) searchBtn.hidden = true;
  if (searchBtn && searchBar && CC) {
    var searchInput = document.getElementById('wsxSearchInput');
    var searchCount = document.getElementById('wsxSearchCount');
    chatSearch = CC.createChatSearch(threadList, scroller, {
      messageSelector: '.wsx-msg',
      onCount: function (cur, total) { if (searchCount) searchCount.textContent = total ? (cur + '/' + total) : t('agent.noMatches'); }
    });
    function runSearch() { chatSearch.search(searchInput ? searchInput.value : ''); }
    function closeSearch() { if (chatSearch) chatSearch.clear(); searchBar.hidden = true; if (searchCount) searchCount.textContent = ''; searchBtn.focus(); }
    searchBtn.addEventListener('click', function () { var show = searchBar.hidden; searchBar.hidden = !show; if (show && searchInput) { searchInput.focus(); runSearch(); } else closeSearch(); });
    if (searchInput) searchInput.addEventListener('input', runSearch);
    // Escape here closes the search only — preventDefault keeps the sheet open.
    if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? chatSearch.prev() : chatSearch.next(); } else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } });
    var sNext = document.getElementById('wsxSearchNext'); if (sNext) sNext.addEventListener('click', function () { chatSearch.next(); });
    var sPrev = document.getElementById('wsxSearchPrev'); if (sPrev) sPrev.addEventListener('click', function () { chatSearch.prev(); });
    var sClose = document.getElementById('wsxSearchClose'); if (sClose) sClose.addEventListener('click', closeSearch);
  }

  // Restore the last open thread silently (never pops the composer on load);
  // otherwise show the empty state (the brief / onboarding replace it if they land).
  if (currentThreadId) openThread(currentThreadId, true); else showEmpty();

`;
