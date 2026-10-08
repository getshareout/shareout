/** Agent chat: composer states (resting pill / sheet dialog) + SSE chat and inline widgets. */
export const workspace_client_agent_dock_JS = `  // ===== composer states: resting (pill) · sheet (dialog panel, user-resizable height) =====
  var composer = document.getElementById('wsxComposer');
  var scrim = document.getElementById('wsxScrim');
  var pill = document.getElementById('wsxPill');
  var pillDot = document.getElementById('wsxPillDot');
  var ask = document.getElementById('wsxAsk');
  var SHEET_H_LS = 'wsx_sheet_h';
  function sheetMax() { return Math.max(280, window.innerHeight - 36); }
  function applySheetH(px) { var h = Math.min(sheetMax(), Math.max(280, px)); composer.style.setProperty('--wsx-sheet-h', h + 'px'); return h; }
  try { var _sh = parseInt(localStorage.getItem(SHEET_H_LS), 10); if (_sh) applySheetH(_sh); } catch (e) {}
  function isSheet() { return composer.getAttribute('data-state') === 'sheet'; }
  // Unread dot on the resting pill: replies that land while the sheet is closed.
  function markUnread() { if (!isSheet() && pillDot) pillDot.hidden = false; }
  function markRead() { if (pillDot) pillDot.hidden = true; }
  function setComposer(state) {
    composer.setAttribute('data-state', state);
    var open = state === 'sheet';
    ws.classList.toggle('is-composer-sheet', open);
    scrim.hidden = !open;
    if (open) { composer.setAttribute('role', 'dialog'); composer.setAttribute('aria-modal', 'true'); markRead(); }
    else { composer.removeAttribute('role'); composer.removeAttribute('aria-modal'); }
  }
  // Opening from the pill moves focus into the composer; closing returns it to the pill.
  function openComposer() {
    if (composer.getAttribute('data-state') !== 'resting') return;
    setComposer('sheet');
    if (ask) { try { ask.focus({ preventScroll: true }); } catch (e) { ask.focus(); } }
  }
  function closeComposer() {
    if (!isSheet()) return;
    setComposer('resting');
    if (pill) { try { pill.focus({ preventScroll: true }); } catch (e) { pill.focus(); } }
  }
  if (pill) pill.addEventListener('click', openComposer);
  document.getElementById('wsxComposerMin').addEventListener('click', closeComposer);
  scrim.addEventListener('click', closeComposer);
  // Escape is scoped: inner controls (search, rename, thread menu) handle it first and
  // preventDefault; only an unhandled Escape closes the history drawer, then the sheet.
  function trapTab(e) {
    var f = Array.prototype.filter.call(composer.querySelectorAll('button, textarea, input:not([type=file]), a[href]'), function (n) { return !n.disabled && n.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  composer.addEventListener('keydown', function (e) {
    if (!isSheet() || e.defaultPrevented) return;
    if (e.key === 'Tab') { trapTab(e); return; }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (threadsPanel && !threadsPanel.hidden) { threadsPanel.hidden = true; if (threadsBtn) threadsBtn.focus(); }
    else closeComposer();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isSheet() && !e.defaultPrevented && (e.target === document.body || e.target === document.documentElement)) closeComposer();
  });

  // ----- drag the top grip to grow/shrink the chat panel; height persists -----
  var grip = document.getElementById('wsxComposerGrip');
  if (grip) {
    var dragStartY = 0, dragStartH = 0, dragging = false;
    function gripY(e) { return e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY; }
    function onMove(e) { if (!dragging) return; applySheetH(dragStartH + (dragStartY - gripY(e))); if (e.cancelable) e.preventDefault(); }
    function onUp() {
      if (!dragging) return;
      dragging = false; composer.classList.remove('is-resizing');
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
      try { localStorage.setItem(SHEET_H_LS, String(Math.round(composer.getBoundingClientRect().height))); } catch (e) {}
    }
    function onDown(e) {
      if (composer.getAttribute('data-state') !== 'sheet') return;
      dragging = true; dragStartY = gripY(e); dragStartH = composer.getBoundingClientRect().height;
      composer.classList.add('is-resizing');
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
      if (e.cancelable) e.preventDefault();
    }
    grip.addEventListener('mousedown', onDown);
    grip.addEventListener('touchstart', onDown, { passive: false });
    // double-click the grip to toggle full height ↔ default
    grip.addEventListener('dblclick', function () {
      var full = composer.getBoundingClientRect().height > sheetMax() - 40;
      var h = applySheetH(full ? Math.round(window.innerHeight * 0.72) : sheetMax());
      try { localStorage.setItem(SHEET_H_LS, String(h)); } catch (e) {}
    });
  }
  // Mobile full-screen sheet: track the visual viewport so the composer stays above the
  // on-screen keyboard (CSS reads --wsx-vvh / --wsx-vvtop below 720px).
  if (window.visualViewport) {
    var vview = window.visualViewport;
    var syncViewport = function () { composer.style.setProperty('--wsx-vvh', Math.round(vview.height) + 'px'); composer.style.setProperty('--wsx-vvtop', Math.round(vview.offsetTop) + 'px'); };
    vview.addEventListener('resize', syncViewport); vview.addEventListener('scroll', syncViewport); syncViewport();
  }

  // ===== agent dock (SSE) =====
  var API = '/v1/home/agent';
  var SCOPE = (window.WSX_WS || 'personal');
  var THREAD_LS = 'wsx_thread_' + SCOPE;
  var threadWrap = document.getElementById('wsxThread');
  var threadList = document.getElementById('wsxThreadList');
  var scrollDownBtn = document.getElementById('wsxScrollDown');
  var currentThreadId = null;
  try { currentThreadId = localStorage.getItem(THREAD_LS) || null; } catch (e) {}
  function setThread(id) { currentThreadId = id; try { if (id) localStorage.setItem(THREAD_LS, id); else localStorage.removeItem(THREAD_LS); } catch (e) {} }

  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var ICO = function (p, w) { return '<svg viewBox="0 0 24 24" width="' + (w || 18) + '" height="' + (w || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; };
  var SEND_SVG = ICO('<path d="M4 12h15M13 6l6 6-6 6"/>');
  var STOP_SVG = ICO('<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>');
  var CLIP_SVG = ICO('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', 14);
  // Shared reading engine (chat-core global, loaded via <script src="/sdk/chat-core.js">).
  // When present it owns follow/hold/away + jump + unread + anchoring + the composer; if
  // it fails to load the dock falls back to the inline behaviour below so it degrades,
  // never dies. Markdown stays local: chat-core's renderer is inline-only (no lists/code).
  var CC = (typeof window !== 'undefined' && window.ChatCore) || null;
  var scroller = null, unread = null, announcer = null, chatSearch = null;
  var replaying = false;
  function setBadge(n) { if (scrollDownBtn) scrollDownBtn.setAttribute('data-count', n > 0 ? String(n) : ''); }
  if (CC) {
    scroller = CC.createScrollController(threadWrap, {
      onEdgeChange: function (atEdge) { if (scrollDownBtn) scrollDownBtn.hidden = atEdge; },
      onAppendWhileAway: function () {}
    });
    unread = CC.createUnreadTracker(scroller, { onCount: setBadge });
    announcer = CC.createLiveAnnouncer({ mount: composer });
  }
  function atBottom() { return threadWrap.scrollHeight - threadWrap.scrollTop - threadWrap.clientHeight < 60; }
  function scrollEnd(force) {
    if (scroller) { if (force) scroller.jumpToLatest(); else scroller.stickToBottom(); return; }
    if (force || atBottom()) threadWrap.scrollTop = threadWrap.scrollHeight;
  }
  // Scroll so a row's top is visible (cards that would be clipped by a scroll-to-bottom).
  function scrollToTop(row) {
    if (!row) return;
    if (scroller) { scroller.scrollToAnchor(row); return; }
    threadWrap.scrollTop = Math.max(0, threadWrap.scrollTop + row.getBoundingClientRect().top - threadWrap.getBoundingClientRect().top - 8);
  }
  function rowOf(b) { return b && b.closest ? b.closest('.wsx-row') : null; }
  function noteBotAppend(b) { if (unread && !replaying) unread.onAppend(rowOf(b)); }
  if (!scroller) threadWrap.addEventListener('scroll', function () { if (scrollDownBtn) scrollDownBtn.hidden = atBottom(); });
  if (scrollDownBtn) scrollDownBtn.addEventListener('click', function () { scrollEnd(true); if (unread) unread.reset(); });

  // ----- message rows: user = quiet bubble on the right, assistant = full-width text -----
  var lastRole = null;
  var emptyEl = null;
  function syncLastRole() {
    var prev = threadList.lastElementChild;
    lastRole = prev && prev.classList.contains('wsx-row') ? (prev.classList.contains('user') ? 'user' : 'bot') : null;
  }
  function removeRow(row) {
    if (row && row.parentNode) row.parentNode.removeChild(row);
    syncLastRole();
    if (!threadList.children.length) showEmpty();
  }
  function makeCol(role) {
    if (emptyEl) { if (emptyEl.parentNode) emptyEl.parentNode.removeChild(emptyEl); emptyEl = null; }
    var grouped = role === lastRole; lastRole = role;
    var row = el('div', 'wsx-row ' + role + (grouped ? ' grouped' : ''));
    var col = el('div', 'wsx-col');
    row.appendChild(col); threadList.appendChild(row);
    return col;
  }
  function renderUserBody(b, text) {
    var parts = splitAttachments(text);
    if (parts.text) { var p = el('div', 'wsx-msg__text'); p.textContent = parts.text; b.appendChild(p); }
    parts.files.forEach(function (f) {
      var chip = el('span', 'wsx-msgfile'); chip.innerHTML = CLIP_SVG;
      var nm = el('span', 'wsx-msgfile__name'); nm.textContent = f.name; chip.appendChild(nm);
      b.appendChild(chip);
    });
  }
  function addMsg(role, text) {
    var col = makeCol(role);
    var b = el('div', 'wsx-msg ' + role);
    if (role === 'user') renderUserBody(b, text); else b.textContent = text;
    col.appendChild(b);
    if (replaying) return b;
    // The reader's own new turn anchors near the top (anchor-and-hold); replies stick
    // to the edge only while following and count as unread when the reader is away.
    if (role === 'user' && scroller) scroller.anchorTop(col.parentNode);
    else { scrollEnd(); noteBotAppend(b); }
    return b;
  }
  function addNote(text) { var b = addMsg('bot', text); b.classList.add('is-note'); return b; }
  function addCopy(col, bubble) {
    var c = el('button', 'wsx-copy'); c.type = 'button'; c.title = t('agent.copy'); c.textContent = t('agent.copy');
    c.addEventListener('click', function () {
      var txt = bubble.innerText || bubble.textContent || '';
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      c.textContent = t('agent.copied'); setTimeout(function () { c.textContent = t('agent.copy'); }, 1200);
    });
    col.appendChild(c);
  }
  function addBot(text) {
    var col = makeCol('bot');
    var b = el('div', 'wsx-msg bot'); b.innerHTML = mdToHtml(text); col.appendChild(b);
    addCopy(col, b);
    if (replaying) return b;
    scrollEnd(); noteBotAppend(b); return b;
  }
  // Failure row: plain-language copy (the raw server text goes to the console) plus a
  // Retry that resends the last user message when one is given.
  function addError(key, retryText) {
    var col = makeCol('bot');
    var box = el('div', 'wsx-err');
    var msg = el('span', 'wsx-err__msg'); msg.textContent = t(key); box.appendChild(msg);
    if (retryText) {
      var rb = el('button', 'wsx-err__retry'); rb.type = 'button'; rb.textContent = t('common.retry');
      rb.addEventListener('click', function () { if (sending) return; removeRow(rowOf(box)); send(retryText, { retry: true }); });
      box.appendChild(rb);
    }
    col.appendChild(box);
    if (!replaying) { scrollEnd(); noteBotAppend(box); markUnread(); }
    return box;
  }

  // ----- empty state: a greeting + a few neutral starters (click fills + sends) -----
  function showEmpty() {
    if (emptyEl || threadList.children.length) return;
    emptyEl = el('div', 'wsx-chatempty');
    var h = el('p', 'wsx-chatempty__title'); h.textContent = t('agent.emptyTitle');
    var chips = el('div', 'wsx-chatempty__chips');
    t('agent.suggestions').split('|').forEach(function (s) {
      var b = el('button', 'wsx-chip'); b.type = 'button'; b.textContent = s;
      b.addEventListener('click', function () { send(s); });
      chips.appendChild(b);
    });
    emptyEl.appendChild(h); emptyEl.appendChild(chips); threadList.appendChild(emptyEl);
  }
  document.addEventListener('shareout:locale', function () {
    if (emptyEl) { emptyEl.parentNode && emptyEl.parentNode.removeChild(emptyEl); emptyEl = null; showEmpty(); }
    syncSendBtn();
  });

  // ----- inline widgets -----
  function addCards(items) {
    if (!items || !items.length) return;
    var col = makeCol('bot');
    var wrap = el('div', 'wsx-cards');
    items.forEach(function (it) {
      var card = el('button', 'wsx-card'); card.type = 'button';
      var ic = el('span', 'wsx-card__ic'); ic.textContent = '\\uD83D\\uDCC4';
      var main = el('span', 'wsx-card__main');
      var top = el('span', 'wsx-card__top'); top.textContent = it.name || t('agent.untitled');
      var sub = el('span', 'wsx-card__sub'); sub.textContent = it.artifact_type || t('agent.page');
      main.appendChild(top); main.appendChild(sub);
      var go = el('span', 'wsx-card__go'); go.textContent = t('agent.open');
      card.appendChild(ic); card.appendChild(main); card.appendChild(go);
      card.addEventListener('click', function () { if (typeof openArtifact === 'function') openArtifact(it.slug, it.name, it.id); });
      wrap.appendChild(card);
    });
    col.appendChild(wrap); scrollEnd(); markUnread();
  }
  function addMedia(ev) {
    var col = makeCol('bot');
    var url = API + '/media/' + encodeURIComponent(ev.token);
    if ((ev.mime || '').indexOf('image/') === 0) {
      var fig = el('figure', 'wsx-media');
      var img = el('img'); img.src = url; img.alt = ev.caption || ev.filename || ''; img.loading = 'lazy';
      img.addEventListener('load', function () { scrollEnd(); });
      fig.appendChild(img);
      if (ev.caption) { var cap = el('figcaption'); cap.textContent = ev.caption; fig.appendChild(cap); }
      col.appendChild(fig);
    } else {
      var a = el('a', 'wsx-file'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = CLIP_SVG; var fn = el('span'); fn.textContent = ev.filename || t('agent.file'); a.appendChild(fn);
      col.appendChild(a);
    }
    scrollEnd(); markUnread();
  }

  // ----- approval cards (plain + build): neutral frame, one primary action -----
  function refreshActiveArtifact() {
    if (typeof activeArt !== 'undefined' && activeArt && activeArt.iframe && activeArt.slug)
      activeArt.iframe.src = '/a/' + encodeURIComponent(activeArt.slug) + '/?wsx=1&t=' + Date.now();
  }
  function buildWidget(col, name) {
    var box = el('div', 'wsx-build');
    var head = el('div', 'wsx-build__head');
    var spin = el('span', 'wsx-build__spin');
    var ttl = el('span'); ttl.textContent = t('agent.building').replace('{name}', name || t('agent.page'));
    head.appendChild(spin); head.appendChild(ttl);
    var step = el('div', 'wsx-build__step'); step.textContent = t('agent.buildStarting');
    box.appendChild(head); box.appendChild(step); col.appendChild(box);
    return { box: box, head: head, spin: spin, step: step, ttl: ttl };
  }
  function runBuildConfirm(token, name) {
    var col = makeCol('bot');
    var w = buildWidget(col, name); scrollEnd(true);
    fetch(API + '/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
      .then(function (resp) {
        if (!resp.ok || !resp.body) throw new Error('confirm ' + resp.status);
        return readStream(resp, function (ev) {
          if (ev.type === 'build_step') { w.step.textContent = ev.label; scrollEnd(); }
          else if (ev.type === 'build_done') {
            w.spin.classList.add('is-done'); w.ttl.textContent = ev.name || t('agent.pageBuilt');
            w.step.textContent = ''; w.box.classList.add('is-done');
            var line = el('div', 'wsx-build__line'); line.innerHTML = mdToHtml(ev.text || t('agent.done')); w.box.appendChild(line);
            if (ev.slug) {
              var open = el('button', 'wsx-build__open'); open.type = 'button'; open.textContent = t('agent.openPage');
              open.addEventListener('click', function () { if (typeof openArtifact === 'function') openArtifact(ev.slug, ev.name, ev.artifactId); });
              w.box.appendChild(open);
              refreshActiveArtifact();
            }
            scrollEnd(); markUnread();
          }
        });
      })
      .catch(function (e) { console.warn('[agent] build confirm failed', e); w.box.classList.add('is-done', 'is-error'); w.spin.classList.add('is-done'); w.step.textContent = t('agent.err.action'); markUnread(); });
  }
  function addConfirm(prompt, token, card) {
    var col = makeCol('bot');
    var box = el('div', 'wsx-approve' + (card && card.danger ? ' is-danger' : ''));
    var ttl = el('div', 'wsx-approve__title'); ttl.textContent = (card && card.title) || t('agent.confirm');
    box.appendChild(ttl);
    if (card && card.subject) { var sub = el('div', 'wsx-approve__subject'); sub.textContent = card.subject; box.appendChild(sub); }
    if (card && card.detail) { var det = el('div', 'wsx-approve__detail'); det.textContent = card.detail; box.appendChild(det); }
    if (card && card.lines && card.lines.length) {
      var ul = el('ul', 'wsx-approve__lines');
      card.lines.slice(0, 8).forEach(function (l) { var li = el('li'); li.textContent = l; ul.appendChild(li); });
      box.appendChild(ul);
    }
    if (!card) { var p = el('div', 'wsx-approve__detail'); p.textContent = prompt; box.appendChild(p); }
    var row = el('div', 'wsx-approve__row');
    var ok = el('button', 'wsx-approve__ok'); ok.type = 'button'; ok.textContent = (card && card.kind === 'build_artifact') ? t('agent.buildIt') : t('common.approve');
    var no = el('button', 'wsx-approve__no'); no.type = 'button'; no.textContent = t('agent.cancel');
    row.appendChild(ok); row.appendChild(no); box.appendChild(row); col.appendChild(box);
    scrollToTop(rowOf(box)); markUnread();
    no.addEventListener('click', function () { removeRow(rowOf(box)); addNote(t('agent.cancelled')); });
    ok.addEventListener('click', function () {
      var isBuild = card && card.kind === 'build_artifact';
      removeRow(rowOf(box));
      if (isBuild) { runBuildConfirm(token, card && card.subject); return; }
      var working = addMsg('bot', t('agent.working')); working.classList.add('is-typing');
      fetch(API + '/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j || {} }; }); })
        .then(function (res) {
          removeRow(rowOf(working));
          if (res.j.text) addBot(res.j.text);
          else if (!res.ok || res.j.error) { console.warn('[agent] confirm failed', res.j.error); addError('agent.err.action'); }
          else addBot(t('agent.done'));
          markUnread(); refreshActiveArtifact();
        })
        .catch(function (e) { console.warn('[agent] confirm failed', e); removeRow(rowOf(working)); addError('agent.err.action'); });
    });
  }

  function readStream(resp, onEv) {
    function deliver(ev) { try { onEv(ev); } catch (e) { console.error('[agent] event handler failed', ev && ev.type, e); } }
    if (CC) { return (async function () { for await (var ev of CC.readSSE(resp)) deliver(ev); })(); }
    var reader = resp.body.getReader(); var dec = new TextDecoder(); var buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split('\\n\\n'); buf = parts.pop();
        parts.forEach(function (p) {
          var line = p.replace(/^data: /, '').trim(); if (!line) return;
          var ev; try { ev = JSON.parse(line); } catch (e) { console.warn('[agent] dropped malformed SSE event', line.slice(0, 200)); return; }
          deliver(ev);
        });
        return pump();
      });
    }
    return pump();
  }

  // ----- composer: auto-growing textarea; the send button becomes Stop while streaming -----
  var sending = false; var currentAbort = null;
  var dock = document.getElementById('wsxDock');
  var sendBtn = document.getElementById('wsxSend');
  var attachedFile = null;
  function hasDraft() { return !!((ask && ask.value.trim()) || attachedFile); }
  function syncSendBtn() {
    if (!sendBtn) return;
    var stop = sending && !createMode;
    var mode = stop ? 'stop' : 'send';
    if (sendBtn.getAttribute('data-mode') !== mode) {
      sendBtn.setAttribute('data-mode', mode);
      sendBtn.innerHTML = stop ? STOP_SVG : SEND_SVG;
    }
    var label = t(stop ? 'composer.stop' : 'composer.send');
    sendBtn.setAttribute('aria-label', label); sendBtn.title = label;
    sendBtn.disabled = !stop && !hasDraft();
    sendBtn.classList.toggle('is-ready', !stop && hasDraft());
  }
  function setSending(on) { sending = on; syncSendBtn(); }
  function setAsk(v) { if (!ask) return; ask.value = v; ask.dispatchEvent(new Event('input')); }
  var ASK_MAX_H = 184; // ~8 lines
  function submitDock() {
    if (sending && !createMode) return; // blocked: the draft stays in the box
    var v = ask.value.trim();
    var out = v;
    if (attachedFile) {
      out = (v ? v + '\\n\\n' : '') + attachMarker(attachedFile.name, attachedFile.id);
      attachedFile = null;
      renderAttachChip();
    }
    if (!out) return;
    setAsk('');
    if (createMode) createSend(out); else send(out);
  }
  if (ask) {
    ask.addEventListener('input', syncSendBtn);
    if (CC && CC.wireComposer) CC.wireComposer({ input: ask, autoResize: true, maxHeight: ASK_MAX_H, clearOnSubmit: false, onSubmit: submitDock });
    else {
      ask.addEventListener('input', function () { ask.style.height = 'auto'; ask.style.height = Math.min(ask.scrollHeight, ASK_MAX_H) + 'px'; });
      ask.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitDock(); } });
    }
  }
  if (dock) dock.addEventListener('submit', function (e) { e.preventDefault(); submitDock(); });
  if (sendBtn) sendBtn.addEventListener('click', function () {
    if (sending && !createMode) { if (currentAbort) currentAbort.abort(); return; }
    submitDock();
  });
  syncSendBtn();

  // ----- send a turn (streaming, progressively formatted) -----
  function send(text, opts) {
    if (sending || !text) return;
    setSending(true); openComposer();
    if (!(opts && opts.retry)) addMsg('user', text);
    // Hold the log's announcements while the turn streams; AT reads the settled reply once.
    threadList.setAttribute('aria-busy', 'true');
    var typing = addMsg('bot', t('agent.thinking')); typing.classList.add('is-typing');
    var removed = false; function killTyping() { if (!removed) { removed = true; removeRow(rowOf(typing)); } }
    var streamEl = null; var streamBuf = ''; var stepEl = null; var painting = false;
    function showStep(label) {
      if (!label) return;
      if (!removed) typing.textContent = label;
      else if (stepEl) stepEl.textContent = label;
      else { stepEl = addMsg('bot', label); stepEl.classList.add('is-typing'); }
      if (announcer) announcer.announce(label);
      scrollEnd();
    }
    function clearStep() { if (stepEl) { removeRow(rowOf(stepEl)); stepEl = null; } }
    function ensureStream() { killTyping(); if (!streamEl) { streamEl = addMsg('bot', ''); streamEl.classList.add('is-streaming'); } return streamEl; }
    // Render Markdown as it streams, at most once per frame.
    function paint() { painting = false; if (streamEl) { streamEl.innerHTML = mdToHtml(mdStreaming(streamBuf)); scrollEnd(); } }
    function queuePaint() { if (painting) return; painting = true; (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(paint); }
    function finalizeStream(finalText) {
      killTyping();
      var shown = false;
      if (streamEl) { streamEl.classList.remove('is-streaming'); streamEl.innerHTML = mdToHtml(streamBuf || finalText || ''); addCopy(streamEl.parentNode, streamEl); streamEl = null; streamBuf = ''; shown = true; }
      else if (finalText) { addBot(finalText); shown = true; }
      if (shown) { if (announcer) announcer.announce(t('agent.replyReady'), { now: true }); markUnread(); }
    }
    currentAbort = ('AbortController' in window) ? new AbortController() : null;
    fetch(API + '/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, threadId: currentThreadId }), signal: currentAbort ? currentAbort.signal : undefined })
      .then(function (resp) {
        if (!resp.ok || !resp.body) {
          killTyping();
          return resp.json().catch(function () { return null; }).then(function (j) {
            if (j && j.error && (j.code === 'UPGRADE_REQUIRED' || j.code === 'FEATURE_DISABLED')) { addBot(j.error); return; }
            console.warn('[agent] chat request failed', resp.status, j && j.error);
            addError(resp.status === 429 ? 'agent.err.busy' : 'agent.err.unavailable', text);
          });
        }
        return readStream(resp, function (ev) {
          if (ev.type === 'typing') return;
          if (ev.type === 'tool_step') { showStep(ev.label); return; }
          if (ev.type !== 'thread') clearStep();
          if (ev.type === 'thread') { setThread(ev.id); }
          else if (ev.type === 'delta') { if (ev.text) { ensureStream(); streamBuf += ev.text; queuePaint(); } }
          else if (ev.type === 'text') { finalizeStream(ev.text); }
          else if (ev.type === 'cards') { finalizeStream(); addCards(ev.items); }
          else if (ev.type === 'media') { finalizeStream(); addMedia(ev); }
          else if (ev.type === 'ui_action') { finalizeStream(); if (ev.action && ev.action.kind === 'open_artifact' && typeof openArtifact === 'function') openArtifact(ev.action.slug, ev.action.name, ev.action.artifactId); else if (ev.action && ev.action.kind === 'show_onboarding' && typeof onbForce === 'function') onbForce(); }
          else if (ev.type === 'confirm') { finalizeStream(); addConfirm(ev.prompt, ev.token, ev.card); }
          else if (ev.type === 'error') { finalizeStream(); console.warn('[agent] stream error', ev.message); addError('agent.err.failed', text); }
        });
      })
      .catch(function (e) {
        killTyping();
        if (e && e.name === 'AbortError') { if (streamBuf) finalizeStream(); addNote(t('agent.stopped')); }
        else { console.warn('[agent] connection dropped', e); if (streamBuf) finalizeStream(); addError('agent.err.connection', text); }
      })
      .then(function () { clearStep(); threadList.removeAttribute('aria-busy'); setSending(false); currentAbort = null; });
  }

  // ----- attachments: chip in the composer; a file chip (not the raw marker) in the thread -----
  var attachChip = document.getElementById('wsxAttachChip');
  var attachBtn = document.getElementById('wsxAttach');
  var attachInput = document.getElementById('wsxAttachInput');
  function renderAttachChip() {
    syncSendBtn();
    if (!attachChip) return;
    if (!attachedFile) { attachChip.hidden = true; attachChip.innerHTML = ''; return; }
    attachChip.hidden = false;
    attachChip.innerHTML = '<span class="wsx__attachchip__pill">' + CLIP_SVG + '<span class="wsx__attachchip__name">' + esc(attachedFile.name) + '</span><button type="button" class="wsx__attachchip__x" id="wsxAttachClear" aria-label="' + esc(t('agent.removeAttachment')) + '" title="' + esc(t('agent.removeAttachment')) + '">&times;</button></span>';
    var clr = document.getElementById('wsxAttachClear');
    if (clr) clr.addEventListener('click', function () { attachedFile = null; renderAttachChip(); if (ask) ask.focus(); });
  }
  function setAttached(blobId, name) {
    attachedFile = { id: blobId, name: name || t('agent.file') };
    openComposer();
    renderAttachChip();
  }
  if (attachBtn && attachInput) {
    attachBtn.addEventListener('click', function () { if (!attachBtn.classList.contains('is-busy')) attachInput.click(); });
    attachInput.addEventListener('change', function () {
      var f = attachInput.files && attachInput.files[0];
      attachInput.value = '';
      if (!f) return;
      attachBtn.classList.add('is-busy');
      uploadBlobOnly(f, function (blobId, name) {
        attachBtn.classList.remove('is-busy');
        if (blobId) setAttached(blobId, name);
        else addError('agent.err.attach');
      });
    });
  }
  (function () {
    var p = new URLSearchParams(location.search);
    var fid = p.get('chat_file');
    if (!fid) return;
    setAttached(fid, p.get('chat_name') || '');
    p.delete('chat_file');
    p.delete('chat_name');
    var q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  })();
  function agentAsk(text, auto) {
    if (auto) { send(text); return; }
    openComposer(); setAsk(text); ask.focus();
    try { ask.setSelectionRange(ask.value.length, ask.value.length); } catch (e) {}
  }

  // ----- voice input: record → POST to /transcribe → drop transcript in the composer -----
  var mic = document.getElementById('wsxMic');
  var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  if (mic && canRecord) {
    mic.hidden = false;
    var rec = null; var chunks = []; var recStart = 0; var micBusy = false;
    function setMicState(s) { mic.setAttribute('data-state', s || ''); }
    function stopTracks(stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    function transcribe(blob, seconds) {
      micBusy = true; setMicState('busy'); openComposer();
      fetch(API + '/transcribe?seconds=' + Math.round(seconds), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.text) { setAsk(ask.value ? (ask.value + ' ' + d.text) : d.text); ask.focus(); }
          else { if (d && d.error) console.warn('[agent] transcribe failed', d.error); addError('agent.err.voiceEmpty'); }
        })
        .catch(function (e) { console.warn('[agent] transcribe failed', e); addError('agent.err.voice'); })
        .then(function () { micBusy = false; setMicState(''); });
    }
    function startRec() {
      if (micBusy) return;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        try { rec = new MediaRecorder(stream); } catch (e) { stopTracks(stream); return; }
        chunks = []; recStart = Date.now();
        rec.addEventListener('dataavailable', function (e) { if (e.data && e.data.size) chunks.push(e.data); });
        rec.addEventListener('stop', function () {
          stopTracks(stream); setMicState('');
          var seconds = (Date.now() - recStart) / 1000;
          if (chunks.length) transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), seconds);
          rec = null;
        });
        rec.start(); setMicState('recording');
      }).catch(function () { addError('agent.err.mic'); });
    }
    mic.addEventListener('click', function () {
      if (rec && rec.state === 'recording') rec.stop();
      else startRec();
    });
  }

  // ===== proactive daily brief: once per day a short summary of what needs you lands in
  // the chat — it never opens the sheet; the pill shows an unread dot instead =====
  function timeOfDay() {
    var h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
  }
  // Agent-requested surfacing only (e.g. show_onboarding) — never on page load.
  function openDock() { setComposer('sheet'); }
  (function () {
    if (currentThreadId) return;
    var key = 'wsx_brief_' + SCOPE;
    var today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(key) === today) return; } catch (e) {}
    var tod = timeOfDay();
    var loadCol = makeCol('bot');
    var load = el('div', 'wsx-msg bot wsx-msg--brief is-typing');
    load.textContent = t('agent.brief.' + tod);
    loadCol.appendChild(load);
    fetch(API + '/brief?tod=' + tod, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.text) {
          try { localStorage.setItem(key, today); } catch (e) {}
          load.classList.remove('is-typing'); load.innerHTML = mdToHtml(j.text); scrollToTop(rowOf(load)); markUnread();
        } else { removeRow(rowOf(load)); }
      })
      .catch(function () { removeRow(rowOf(load)); });
  })();

`;
