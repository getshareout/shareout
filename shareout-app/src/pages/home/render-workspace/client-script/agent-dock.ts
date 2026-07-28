/** Agent chat: composer states (resting/sheet/docked) + SSE chat, threads, inline widgets. */
export const workspace_client_agent_dock_JS = `  // ===== composer states: resting (pill) · sheet (bottom panel, user-resizable height) =====
  var composer = document.getElementById('wsxComposer');
  var scrim = document.getElementById('wsxScrim');
  var SHEET_H_LS = 'wsx_sheet_h';
  function sheetMax() { return Math.max(280, window.innerHeight - 36); }
  function applySheetH(px) { var h = Math.min(sheetMax(), Math.max(280, px)); composer.style.setProperty('--wsx-sheet-h', h + 'px'); return h; }
  try { var _sh = parseInt(localStorage.getItem(SHEET_H_LS), 10); if (_sh) applySheetH(_sh); } catch (e) {}
  function setComposer(state) {
    composer.setAttribute('data-state', state);
    ws.classList.toggle('is-composer-sheet', state === 'sheet');
    scrim.hidden = state !== 'sheet';
  }
  function openComposer() { if (composer.getAttribute('data-state') === 'resting') setComposer('sheet'); }
  document.getElementById('wsxComposerMin').addEventListener('click', function () { setComposer('resting'); });
  scrim.addEventListener('click', function () { setComposer('resting'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && composer.getAttribute('data-state') === 'sheet') setComposer('resting'); });

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
  function nowTime() { try { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  // Shared reading engine (chat-core global, loaded via <script src="/sdk/chat-core.js">).
  // When present it owns follow/hold/away + jump + unread + anchoring; if it fails to
  // load the dock falls back to the inline behaviour below so it degrades, never dies.
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
    announcer = CC.createLiveAnnouncer({ mount: threadWrap });
  }
  function atBottom() { return threadWrap.scrollHeight - threadWrap.scrollTop - threadWrap.clientHeight < 60; }
  function scrollEnd(force) {
    if (scroller) { if (force) scroller.jumpToLatest(); else scroller.stickToBottom(); return; }
    if (force || atBottom()) threadWrap.scrollTop = threadWrap.scrollHeight;
  }
  function rowOf(b) { return b && b.closest ? b.closest('.wsx-row') : null; }
  function noteBotAppend(b) { if (unread && !replaying) unread.onAppend(rowOf(b)); }
  if (!scroller) threadWrap.addEventListener('scroll', function () { if (scrollDownBtn) scrollDownBtn.hidden = atBottom(); });
  if (scrollDownBtn) scrollDownBtn.addEventListener('click', function () { scrollEnd(true); if (unread) unread.reset(); });

  // ----- safe Markdown: fenced code -> headings/lists/quote/hr -> paragraphs, inline last -----
  function mdInline(t) {
    var BT = String.fromCharCode(96);
    var s = esc(t);
    s = s.replace(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'), '<code>$1</code>');
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
    s = s.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|\\s)(https?:\\/\\/[^\\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s;
  }
  function mdToHtml(raw) {
    var BT = String.fromCharCode(96);
    var src = String(raw == null ? '' : raw);
    var blocks = [];
    var fence = new RegExp(BT + BT + BT + '[^\\n]*\\n([\\s\\S]*?)' + BT + BT + BT, 'g');
    src = src.replace(fence, function (m, code) { blocks.push(code); return '\\u0000C' + (blocks.length - 1) + '\\u0000'; });
    var lines = src.split('\\n'); var html = ''; var listType = null;
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var cm = ln.trim().match(/^\\u0000C(\\d+)\\u0000$/);
      if (cm) { closeList(); html += '<pre class="wsx-pre"><code>' + esc(blocks[+cm[1]]) + '</code></pre>'; continue; }
      if (/^\\s*$/.test(ln)) { closeList(); continue; }
      var h = ln.match(/^(#{1,3})\\s+(.*)$/);
      if (h) { closeList(); var lvl = h[1].length + 2; html += '<h' + lvl + ' class="wsx-h">' + mdInline(h[2]) + '</h' + lvl + '>'; continue; }
      if (/^\\s*[-*]\\s+/.test(ln)) { if (listType !== 'ul') { closeList(); html += '<ul class="wsx-ul">'; listType = 'ul'; } html += '<li>' + mdInline(ln.replace(/^\\s*[-*]\\s+/, '')) + '</li>'; continue; }
      if (/^\\s*\\d+\\.\\s+/.test(ln)) { if (listType !== 'ol') { closeList(); html += '<ol class="wsx-ol">'; listType = 'ol'; } html += '<li>' + mdInline(ln.replace(/^\\s*\\d+\\.\\s+/, '')) + '</li>'; continue; }
      if (/^\\s*>\\s?/.test(ln)) { closeList(); html += '<blockquote class="wsx-bq">' + mdInline(ln.replace(/^\\s*>\\s?/, '')) + '</blockquote>'; continue; }
      if (/^\\s*---+\\s*$/.test(ln)) { closeList(); html += '<hr class="wsx-hr">'; continue; }
      closeList(); html += '<p>' + mdInline(ln) + '</p>';
    }
    closeList();
    return html;
  }

  // ----- message rows: avatar + meta + bubble, grouped when same role repeats -----
  var lastRole = null;
  function makeCol(role, ts) {
    var grouped = role === lastRole; lastRole = role;
    var row = el('div', 'wsx-row ' + role + (grouped ? ' grouped' : ''));
    var av = el('div', 'wsx-av ' + role); av.textContent = role === 'user' ? '\\u25CB' : '\\u25C6';
    var col = el('div', 'wsx-col');
    if (!grouped) {
      var meta = el('div', 'wsx-meta');
      var nm = el('span', 'wsx-meta__name'); nm.textContent = role === 'user' ? 'You' : 'ShareOut';
      var tm = el('span', 'wsx-meta__time'); tm.textContent = ts || nowTime();
      meta.appendChild(nm); meta.appendChild(tm); col.appendChild(meta);
    }
    row.appendChild(av); row.appendChild(col); threadList.appendChild(row);
    return col;
  }
  function addMsg(role, text, ts) {
    var col = makeCol(role, ts);
    var b = el('div', 'wsx-msg ' + role); b.textContent = text; col.appendChild(b);
    if (replaying) return b;
    // The reader's own new turn anchors near the top (anchor-and-hold); replies stick
    // to the edge only while following and count as unread when the reader is away.
    if (role === 'user' && scroller) scroller.anchorTop(col.parentNode);
    else { scrollEnd(); noteBotAppend(b); }
    return b;
  }
  function addCopy(col, bubble) {
    var c = el('button', 'wsx-copy'); c.type = 'button'; c.title = 'Copy'; c.textContent = 'Copy';
    c.addEventListener('click', function () {
      var t = bubble.innerText || bubble.textContent || '';
      if (navigator.clipboard) navigator.clipboard.writeText(t);
      c.textContent = t('agent.copied'); setTimeout(function () { c.textContent = t('agent.copy'); }, 1200);
    });
    col.appendChild(c);
  }
  function addBot(text, ts) {
    var col = makeCol('bot', ts);
    var b = el('div', 'wsx-msg bot'); b.innerHTML = mdToHtml(text); col.appendChild(b);
    addCopy(col, b);
    if (replaying) return b;
    scrollEnd(); noteBotAppend(b); return b;
  }

  // ----- inline widgets -----
  function addCards(items) {
    if (!items || !items.length) return;
    var col = makeCol('bot');
    var wrap = el('div', 'wsx-cards');
    items.forEach(function (it) {
      var card = el('button', 'wsx-card'); card.type = 'button';
      var ic = el('span', 'wsx-card__ic'); ic.textContent = '\\uD83D\\uDCC4';
      var main = el('span', 'wsx-card__main');
      var top = el('span', 'wsx-card__top'); top.textContent = it.name || 'Untitled';
      var sub = el('span', 'wsx-card__sub'); sub.textContent = it.artifact_type || 'page';
      main.appendChild(top); main.appendChild(sub);
      var go = el('span', 'wsx-card__go'); go.textContent = 'Open \\u2192';
      card.appendChild(ic); card.appendChild(main); card.appendChild(go);
      card.addEventListener('click', function () { if (typeof openArtifact === 'function') openArtifact(it.slug, it.name, it.id); });
      wrap.appendChild(card);
    });
    col.appendChild(wrap); scrollEnd();
  }
  function addMedia(ev) {
    var col = makeCol('bot');
    var url = API + '/media/' + encodeURIComponent(ev.token);
    if ((ev.mime || '').indexOf('image/') === 0) {
      var fig = el('figure', 'wsx-media');
      var img = el('img'); img.src = url; img.alt = ev.caption || ev.filename || 'image'; img.loading = 'lazy';
      img.addEventListener('load', function () { scrollEnd(); });
      fig.appendChild(img);
      if (ev.caption) { var cap = el('figcaption'); cap.textContent = ev.caption; fig.appendChild(cap); }
      col.appendChild(fig);
    } else {
      var a = el('a', 'wsx-file'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = '\\uD83D\\uDCCE ' + (ev.filename || 'file');
      col.appendChild(a);
    }
    scrollEnd();
  }

  // ----- approval cards (plain + build) -----
  function buildWidget(col, name) {
    var box = el('div', 'wsx-build');
    var head = el('div', 'wsx-build__head');
    var spin = el('span', 'wsx-build__spin');
    var ttl = el('span'); ttl.textContent = 'Building \\u201C' + (name || 'page') + '\\u201D\\u2026';
    head.appendChild(spin); head.appendChild(ttl);
    var step = el('div', 'wsx-build__step'); step.textContent = 'Starting\\u2026';
    box.appendChild(head); box.appendChild(step); col.appendChild(box);
    return { box: box, head: head, spin: spin, step: step, ttl: ttl };
  }
  function runBuildConfirm(token, name) {
    var col = makeCol('bot');
    var w = buildWidget(col, name); scrollEnd(true);
    fetch(API + '/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
      .then(function (resp) {
        if (!resp.ok || !resp.body) throw 0;
        return readStream(resp, function (ev) {
          if (ev.type === 'build_step') { w.step.textContent = ev.label; scrollEnd(); }
          else if (ev.type === 'build_done') {
            w.spin.classList.add('is-done'); w.ttl.textContent = ev.name || 'Page built';
            w.step.textContent = ''; w.box.classList.add('is-done');
            var line = el('div', 'wsx-build__line'); line.innerHTML = mdToHtml(ev.text || 'Done.'); w.box.appendChild(line);
            if (ev.slug) {
              var open = el('button', 'wsx-build__open'); open.type = 'button'; open.textContent = 'Open page \\u2192';
              open.addEventListener('click', function () { if (typeof openArtifact === 'function') openArtifact(ev.slug, ev.name, ev.artifactId); });
              w.box.appendChild(open);
              if (typeof activeArt !== 'undefined' && activeArt && activeArt.iframe && activeArt.slug)
                activeArt.iframe.src = '/a/' + encodeURIComponent(activeArt.slug) + '/?wsx=1&t=' + Date.now();
            }
            scrollEnd();
          }
        });
      })
      .catch(function () { w.box.classList.add('is-done'); w.step.textContent = 'That didn\\u2019t go through.'; });
  }
  function addConfirm(prompt, token, card) {
    var col = makeCol('bot');
    var box = el('div', 'wsx-approve' + (card && card.danger ? ' is-danger' : ''));
    var ttl = el('div', 'wsx-approve__title'); ttl.textContent = (card && card.title) || 'Confirm';
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
    var ok = el('button', 'wsx-approve__ok'); ok.type = 'button'; ok.textContent = (card && card.kind === 'build_artifact') ? 'Build it' : 'Approve';
    var no = el('button', 'wsx-approve__no'); no.type = 'button'; no.textContent = 'Cancel';
    row.appendChild(ok); row.appendChild(no); box.appendChild(row); col.appendChild(box); scrollEnd(true);
    no.addEventListener('click', function () { box.remove(); addMsg('bot', 'Okay, cancelled.'); });
    ok.addEventListener('click', function () {
      var isBuild = card && card.kind === 'build_artifact';
      box.remove();
      if (isBuild) { runBuildConfirm(token, card && card.subject); return; }
      var working = addMsg('bot', 'Working\\u2026'); working.classList.add('is-typing');
      fetch(API + '/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { var rr = working.parentNode && working.parentNode.parentNode; if (rr) rr.remove(); lastRole = null; addBot(j.text || j.error || 'Done.');
          if (typeof activeArt !== 'undefined' && activeArt && activeArt.iframe && activeArt.slug) activeArt.iframe.src = '/a/' + encodeURIComponent(activeArt.slug) + '/?wsx=1&t=' + Date.now(); })
        .catch(function () { addMsg('bot', 'That didn\\u2019t go through.'); });
    });
  }

  function readStream(resp, onEv) {
    if (CC) { return (async function () { for await (var ev of CC.readSSE(resp)) onEv(ev); })(); }
    var reader = resp.body.getReader(); var dec = new TextDecoder(); var buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split('\\n\\n'); buf = parts.pop();
        parts.forEach(function (p) { var line = p.replace(/^data: /, '').trim(); if (!line) return; try { onEv(JSON.parse(line)); } catch (e) {} });
        return pump();
      });
    }
    return pump();
  }

  // ----- send a turn (streaming + stop) -----
  var sending = false; var currentAbort = null;
  var stopBtn = el('button', 'wsx-stop'); stopBtn.type = 'button'; stopBtn.hidden = true; stopBtn.textContent = '\\u25A0 Stop';
  composer.appendChild(stopBtn);
  stopBtn.addEventListener('click', function () { if (currentAbort) currentAbort.abort(); });
  function setSending(on) { sending = on; stopBtn.hidden = !on; }

  function send(text) {
    if (sending || !text) return;
    setSending(true); openComposer();
    addMsg('user', text);
    var typing = addMsg('bot', '\\u2026'); typing.classList.add('is-typing');
    var removed = false; function killTyping() { if (!removed && typing) { var r = typing.parentNode && typing.parentNode.parentNode; if (r) r.remove(); else typing.remove(); removed = true; lastRole = 'user'; } }
    var streamEl = null; var streamBuf = '';
    function ensureStream() { killTyping(); if (!streamEl) { streamEl = addMsg('bot', ''); streamEl.classList.add('is-streaming'); } return streamEl; }
    function finalizeStream(finalText) {
      killTyping();
      if (streamEl) { streamEl.classList.remove('is-streaming'); streamEl.innerHTML = mdToHtml(streamBuf || finalText || ''); addCopy(streamEl.parentNode, streamEl); streamEl = null; streamBuf = ''; }
      else if (finalText) { addBot(finalText); }
      if (announcer) announcer.announce('Reply ready', { now: true });
    }
    currentAbort = ('AbortController' in window) ? new AbortController() : null;
    fetch(API + '/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, threadId: currentThreadId }), signal: currentAbort ? currentAbort.signal : undefined })
      .then(function (resp) {
        if (!resp.ok || !resp.body) {
          killTyping();
          return resp.json().catch(function () { return null; }).then(function (j) {
            if (j && j.error && (j.code === 'UPGRADE_REQUIRED' || j.code === 'FEATURE_DISABLED')) addBot(j.error);
            else addMsg('bot', (j && j.error) || 'The agent is unavailable right now.');
          });
        }
        return readStream(resp, function (ev) {
          if (ev.type === 'typing') return;
          if (ev.type === 'thread') { setThread(ev.id); }
          else if (ev.type === 'delta') { if (ev.text) { ensureStream(); streamBuf += ev.text; streamEl.textContent = streamBuf; scrollEnd(); } }
          else if (ev.type === 'text') { finalizeStream(ev.text); }
          else if (ev.type === 'cards') { finalizeStream(); addCards(ev.items); }
          else if (ev.type === 'media') { finalizeStream(); addMedia(ev); }
          else if (ev.type === 'ui_action') { finalizeStream(); if (ev.action && ev.action.kind === 'open_artifact' && typeof openArtifact === 'function') openArtifact(ev.action.slug, ev.action.name, ev.action.artifactId); else if (ev.action && ev.action.kind === 'show_onboarding' && typeof onbForce === 'function') onbForce(); }
          else if (ev.type === 'confirm') { finalizeStream(); addConfirm(ev.prompt, ev.token, ev.card); }
          else if (ev.type === 'error') { finalizeStream(); addMsg('bot', ev.message || 'Something went wrong.'); }
        });
      })
      .catch(function (e) { killTyping(); if (e && e.name === 'AbortError') { if (streamBuf) finalizeStream(); else addMsg('bot', 'Stopped.'); } else addMsg('bot', 'Connection dropped.'); })
      .then(function () { setSending(false); currentAbort = null; });
  }

  // ----- thread history drawer -----
  var threadsPanel = document.getElementById('wsxThreads');
  var threadsList = document.getElementById('wsxThreadsList');
  function newChat() {
    setThread(null); threadList.innerHTML = ''; lastRole = null;
    if (threadsPanel) threadsPanel.hidden = true;
    openComposer(); if (ask) ask.focus();
  }
  var REPLAY_CAP = 30;
  function renderMsg(m) {
    var ts = ''; try { ts = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    if (m.role === 'assistant') addBot(m.content, ts); else addMsg('user', m.content, ts);
  }
  function replay(messages) {
    messages = messages || [];
    threadList.innerHTML = ''; lastRole = null;
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
      .then(function (j) { if (!j) { if (!silent) addMsg('bot', t('agent.couldNotLoadChat')); return; } replay(j.messages); if (!silent) { openComposer(); } })
      .catch(function () {});
    if (threadsPanel) threadsPanel.hidden = true;
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
        ts.forEach(function (th) {
          var row = el('div', 'wsx-thread' + (th.id === currentThreadId ? ' is-active' : ''));
          var main = el('button', 'wsx-thread__main'); main.type = 'button';
          var ti = el('span', 'wsx-thread__title'); ti.textContent = th.title || t('agent.newChat');
          var pv = el('span', 'wsx-thread__preview'); pv.textContent = th.preview || '';
          main.appendChild(ti); main.appendChild(pv);
          main.addEventListener('click', function () { openThread(th.id); });
          var ren = el('button', 'wsx-thread__act'); ren.type = 'button'; ren.title = t('agent.renameChat'); ren.textContent = '\\u270E';
          ren.addEventListener('click', function (e) { e.stopPropagation(); var nv = window.prompt(t('agent.renameChat'), th.title || ''); if (nv && nv.trim()) { fetch(API + '/threads/' + encodeURIComponent(th.id) + '/rename', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: nv.trim() }) }).then(function (r) { if (!r.ok) throw new Error('failed'); ti.textContent = nv.trim(); }).catch(function () { showToast('Couldn\\u2019t rename chat', 'error'); }); } });
          var del = el('button', 'wsx-thread__act'); del.type = 'button'; del.title = t('common.delete'); del.textContent = '\\u00D7';
          del.addEventListener('click', function (e) { e.stopPropagation(); if (!window.confirm(t('agent.deleteChat'))) return; fetch(API + '/threads/' + encodeURIComponent(th.id), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('failed'); row.remove(); if (th.id === currentThreadId) newChat(); }).catch(function () { showToast('Couldn\\u2019t delete chat', 'error'); }); });
          row.appendChild(main); row.appendChild(ren); row.appendChild(del);
          threadsList.appendChild(row);
        });
      })
      .catch(function () { threadsList.innerHTML = i18nEmpty('agent.couldNotHistory'); });
  }
  var threadsBtn = document.getElementById('wsxThreadsBtn');
  var threadsClose = document.getElementById('wsxThreadsClose');
  var newChatBtn = document.getElementById('wsxNewChat');
  if (threadsBtn) threadsBtn.addEventListener('click', function () { openComposer(); if (threadsPanel) { var show = threadsPanel.hidden; threadsPanel.hidden = !show; if (show) loadThreads(); } });
  if (threadsClose) threadsClose.addEventListener('click', function () { if (threadsPanel) threadsPanel.hidden = true; });
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
    function closeSearch() { if (chatSearch) chatSearch.clear(); searchBar.hidden = true; if (searchCount) searchCount.textContent = ''; }
    searchBtn.addEventListener('click', function () { var show = searchBar.hidden; searchBar.hidden = !show; if (show && searchInput) { searchInput.focus(); runSearch(); } else closeSearch(); });
    if (searchInput) searchInput.addEventListener('input', runSearch);
    if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? chatSearch.prev() : chatSearch.next(); } else if (e.key === 'Escape') { closeSearch(); } });
    var sNext = document.getElementById('wsxSearchNext'); if (sNext) sNext.addEventListener('click', function () { chatSearch.next(); });
    var sPrev = document.getElementById('wsxSearchPrev'); if (sPrev) sPrev.addEventListener('click', function () { chatSearch.prev(); });
    var sClose = document.getElementById('wsxSearchClose'); if (sClose) sClose.addEventListener('click', closeSearch);
  }

  var dock = document.getElementById('wsxDock');
  var ask = document.getElementById('wsxAsk');
  var attachedFile = null;
  var attachChip = document.getElementById('wsxAttachChip');
  var attachBtn = document.getElementById('wsxAttach');
  var attachInput = document.getElementById('wsxAttachInput');
  function renderAttachChip() {
    if (!attachChip) return;
    if (!attachedFile) { attachChip.hidden = true; attachChip.innerHTML = ''; return; }
    attachChip.hidden = false;
    attachChip.innerHTML = '<span class="wsx__attachchip__pill"><span class="wsx__attachchip__name">' + esc(attachedFile.name) + '</span><button type="button" class="wsx__attachchip__x" id="wsxAttachClear" aria-label="Remove">&times;</button></span>';
    var clr = document.getElementById('wsxAttachClear');
    if (clr) clr.addEventListener('click', function () { attachedFile = null; renderAttachChip(); });
  }
  function setAttached(blobId, name) {
    attachedFile = { id: blobId, name: name || 'file' };
    renderAttachChip();
    openComposer();
  }
  if (ask) ask.addEventListener('focus', function () { openComposer(); });
  if (dock) dock.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = ask.value.trim();
    var out = v;
    if (attachedFile) {
      out = (v ? v + '\\n\\n' : '') + '[Attached file: ' + attachedFile.name + ' — file id ' + attachedFile.id + ']';
      attachedFile = null;
      renderAttachChip();
    }
    if (!out) return;
    ask.value = '';
    if (createMode) createSend(out); else send(out);
  });
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
        else addMsg('bot', 'Could not attach that file. Try again?');
      });
    });
  }
  (function () {
    var p = new URLSearchParams(location.search);
    var fid = p.get('chat_file');
    if (!fid) return;
    setAttached(fid, p.get('chat_name') || 'file');
    p.delete('chat_file');
    p.delete('chat_name');
    var q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  })();
  function agentAsk(text, auto) { if (auto) { send(text); } else { ask.value = text; ask.focus(); } }

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
          if (d && d.text) { ask.value = ask.value ? (ask.value + ' ' + d.text) : d.text; ask.focus(); }
          else { addMsg('bot', (d && d.error) || 'I couldn’t transcribe that.'); }
        })
        .catch(function () { addMsg('bot', 'Voice transcription failed. Try again?'); })
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
      }).catch(function () { addMsg('bot', 'I need microphone access to hear you. Check your browser permissions.'); });
    }
    mic.addEventListener('click', function () {
      if (rec && rec.state === 'recording') rec.stop();
      else startRec();
    });
  }

  // Restore the last open thread silently (don't pop the composer on load).
  if (currentThreadId) openThread(currentThreadId, true);

  // ===== proactive daily brief: once per day the assistant greets you with a
  // short AI summary of what needs you + recent runs/updates, docked on the side =====
  function timeOfDay() {
    var h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 18) return 'Afternoon';
    return 'Evening';
  }
  function openDock() { setComposer('sheet'); }
  function showBrief(text) {
    var col = makeCol('bot');
    var b = el('div', 'wsx-msg bot wsx-msg--brief'); b.innerHTML = mdToHtml(text); col.appendChild(b);
    scrollEnd(true);
    openDock();
  }
  (function () {
    if (currentThreadId) return;
    var key = 'wsx_brief_' + SCOPE;
    var today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(key) === today) return; } catch (e) {}
    var tod = timeOfDay();
    var loadCol = makeCol('bot');
    var load = el('div', 'wsx-msg bot wsx-msg--brief is-typing');
    load.textContent = 'Preparing your ' + tod + ' Brief…';
    loadCol.appendChild(load); scrollEnd(true); openDock();
    fetch(API + '/brief?tod=' + tod.toLowerCase(), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.text) {
          try { localStorage.setItem(key, today); } catch (e) {}
          load.classList.remove('is-typing'); load.innerHTML = mdToHtml(j.text); scrollEnd(true);
        } else { loadCol.parentNode && loadCol.parentNode.removeChild(loadCol); }
      })
      .catch(function () { loadCol.parentNode && loadCol.parentNode.removeChild(loadCol); });
  })();

`;
