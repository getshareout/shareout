import { MESSAGES_PAGE_COPY } from './messages-copy';

/** Messages lens: one-to-one conversations between internal members of the workspace
 *  (/v1/workspaces/{ws}/messages). Lazily loaded (lazy-chunks.ts); shares the shell scope.
 *  The list and the open conversation sit side by side; under 720px the list comes first and a
 *  conversation opens over it with a back button. Polls every 20 s while the view is on screen. */
export const workspace_client_home_views_messages_JS = `  var MSG_COPY = ${JSON.stringify(MESSAGES_PAGE_COPY).replace(/</g, '\\u003c')};
  // Messages strings first (in the page's current language), then the shell's copy.
  function mt(k) { var de = document.documentElement, l = de && de.lang === 'es' ? 'es' : 'en'; return MSG_COPY[l][k] || MSG_COPY.en[k] || t(k); }
  var MSG_PAGE = 50;
  var MSG_MAX = 4000;
  var MSG_POLL_MS = 20000;
  var msgWith = '';
  var msgThreads = null;
  var msgConv = null;
  var msgPeople = null;
  var msgTimer = null;
  var msgSending = false;
  var msgReq = 0;
  var msgDrafts = {};
  var MSG_DOC = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
  function msgBase() { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS || '') + '/messages'; }
  // JSON in, JSON out; a refusal rejects with the API's code (MESSAGE_TOO_LONG, RATE_LIMITED, …).
  function msgFetch(path, init) {
    return fetch(msgBase() + path, Object.assign({ credentials: 'same-origin' }, init || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.error) || ('HTTP ' + r.status)); e.code = d && d.code; e.status = r.status; throw e; }
        return d || {};
      });
    });
  }
  function msgEl(id) { return document.getElementById(id); }
  function msgSvg(p) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  function msgMs(iso) { var n = Date.parse(iso || ''); return isNaN(n) ? 0 : n; }
  function msgFold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
  function msgFirst(p) { return p && p.name ? p.name.trim().split(/\\s+/)[0] : msgName(p); }
  function msgThread(id) { return (msgThreads || []).filter(function (x) { return x.with && x.with.id === id; })[0] || null; }
  function msgNewBtn() { return '<button class="wsx-abtn wsx-abtn--primary" type="button" data-msg-new>' + msgSvg('<path d="M12 5v14M5 12h14"/>') + '<span>' + esc(mt('msg.new')) + '</span></button>'; }

  function msgPaintShell() {
    var root = msgEl('wsxMsgMount'); if (!root) return;
    root.innerHTML = '<div class="wsx-adm__ph wsx-dm__ph"><div><h2 class="wsx-adm__title">' + esc(mt('msg.title')) + '</h2><p class="wsx-adm__desc">' + esc(mt('msg.desc')) + '</p></div>'
      + '<div class="wsx-adm__act">' + msgNewBtn() + '</div></div>'
      + '<div class="wsx-dm__box"><nav class="wsx-dm__list" id="wsxMsgList" aria-label="' + esc(mt('msg.conversations')) + '">' + i18nSpin() + '</nav>'
      + '<section class="wsx-dm__conv" id="wsxMsgConv"></section></div>';
  }

  // ---- conversation list ----
  function msgPreview(th) { return th.last ? (th.last.sentByMe ? mt('msg.you') + ': ' : '') + th.last.body : ''; }
  function msgPaintList() {
    var el = msgEl('wsxMsgList'); if (!el || !msgThreads) return;
    var rows = msgThreads.slice();
    // A conversation opened from the picker or a link joins the list before its first message.
    if (msgWith && msgConv && msgConv.id === msgWith && msgConv.with && !msgThread(msgWith)) rows.unshift({ id: '', with: msgConv.with, last: null, unread: 0 });
    if (!rows.length) { el.innerHTML = '<p class="wsx-dm__none">' + esc(mt('msg.emptyTitle')) + '</p>'; return; }
    el.innerHTML = rows.map(function (th) {
      var on = th.with.id === msgWith, n = th.unread || 0;
      return '<button class="wsx-dm__row' + (on ? ' is-on' : '') + (n ? ' is-unread' : '') + '" type="button" data-msg-open="' + esc(th.with.id) + '"' + (on ? ' aria-current="true"' : '') + '>'
        + msgAv(th.with)
        + '<span class="wsx-dm__rowmain"><span class="wsx-dm__rowtop"><span class="wsx-dm__name">' + esc(msgName(th.with)) + '</span>'
        + (th.last ? '<span class="wsx-dm__time">' + esc(timeAgo(msgMs(th.last.at))) + '</span>' : '') + '</span>'
        + '<span class="wsx-dm__rowbot"><span class="wsx-dm__prev">' + esc(msgPreview(th)) + '</span>'
        + (n ? '<span class="wsx-dm__n">' + (n > 99 ? '99+' : n) + '</span>' : '') + '</span></span></button>';
    }).join('');
  }
  function msgLoadList(quiet) {
    return msgFetch('?limit=' + MSG_PAGE).then(function (d) {
      msgThreads = d.threads || [];
      msgSetUnread(d);
      msgPaintList();
      if (msgWith) msgFollow(); else msgPaintConv();
    }, function () {
      if (quiet) return;
      var el = msgEl('wsxMsgList');
      if (el) el.innerHTML = '<div class="wsx-empty">' + esc(mt('msg.loadFailed')) + ' <button class="wsx-link" type="button" data-empty-retry>' + esc(t('common.retry')) + '</button></div>';
    });
  }
  // A poll saw something new in the open conversation: fetch it and mark it read.
  function msgFollow() {
    if (!msgConv || msgConv.id !== msgWith || !msgConv.with) return;
    var th = msgThread(msgWith); if (!th) return;
    var ms = msgConv.messages, last = ms.length ? msgMs(ms[ms.length - 1].createdAt) : 0;
    if (th.unread || msgMs(th.lastMessageAt) > last) msgLoadConv(msgWith, true);
  }

  // ---- one conversation ----
  function msgTime(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locTag(), { hour: 'numeric', minute: '2-digit' }); }
  function msgDay(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(d.getTime()); day.setHours(0, 0, 0, 0);
    var diff = Math.round((today.getTime() - day.getTime()) / 86400000);
    return diff === 0 ? mt('msg.today') : diff === 1 ? mt('msg.yesterday') : fmtDay(iso, day.getFullYear() !== today.getFullYear());
  }
  function msgBubble(m, next) {
    var via = m.sentVia && m.sentVia !== 'web' ? mt(m.sentByMe ? 'msg.viaMine' : 'msg.viaTheirs') : '';
    // The time closes a run of messages from one side a few minutes apart; "through their
    // assistant" always shows.
    var tail = !!via || !next || next.sentByMe !== m.sentByMe || msgMs(next.createdAt) - msgMs(m.createdAt) > 300000 || msgDay(next.createdAt) !== msgDay(m.createdAt);
    var a = m.artifact, art = '';
    if (a) {
      var inner = '<span class="wsx-dm__arti">' + msgSvg(MSG_DOC) + '</span><span class="wsx-dm__artn">' + esc(a.name || a.slug || '') + '</span>';
      art = a.slug
        ? '<a class="wsx-dm__art" href="/a/' + encodeURIComponent(a.slug) + '/" data-name="' + esc(a.name || a.slug) + '" data-id="' + esc(a.id) + '">' + inner + '</a>'
        : '<span class="wsx-dm__art">' + inner + '</span>';
    }
    return '<div class="wsx-dm__b' + (m.sentByMe ? ' is-mine' : '') + '">'
      + (m.body ? '<div class="wsx-dm__bub">' + esc(m.body) + '</div>' : '') + art
      + (tail ? '<div class="wsx-dm__meta">' + esc(msgTime(m.createdAt)) + (via ? ' \\u00B7 ' + esc(via) : '') + '</div>' : '')
      + '</div>';
  }
  // scroll: 'bottom' (open / sent), 'end' (stay at the end if already there), 'prepend' (older page).
  function msgPaintLog(scroll) {
    var log = msgEl('wsxMsgLog'); if (!log || !msgConv) return;
    var ms = msgConv.messages, prevDay = '';
    var html = msgConv.more ? '<button class="wsx-link wsx-dm__earlier" type="button" data-msg-earlier>' + esc(mt('msg.earlier')) + '</button>' : '';
    if (!ms.length) html += '<p class="wsx-dm__hello">' + esc(mt('msg.convEmpty').replace('{name}', msgFirst(msgConv.with))) + '</p>';
    ms.forEach(function (m, i) {
      var day = msgDay(m.createdAt);
      if (day !== prevDay) { html += '<div class="wsx-dm__day"><span>' + esc(day) + '</span></div>'; prevDay = day; }
      html += msgBubble(m, ms[i + 1]);
    });
    var atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80, prevH = log.scrollHeight, prevTop = log.scrollTop;
    log.innerHTML = html;
    if (scroll === 'bottom' || (scroll === 'end' && atEnd)) log.scrollTop = log.scrollHeight;
    else if (scroll === 'prepend') log.scrollTop = log.scrollHeight - prevH + prevTop;
    else log.scrollTop = prevTop;
  }
  function msgPaintConv() {
    var root = msgEl('wsxMsgMount'), el = msgEl('wsxMsgConv'); if (!root || !el) return;
    root.classList.toggle('is-conv', !!msgWith);
    root.classList.toggle('is-empty', !msgWith && !!msgThreads && !msgThreads.length);
    if (!msgWith) {
      el.innerHTML = !msgThreads ? '' : msgThreads.length ? emptyState(mt('msg.pickTitle'), mt('msg.pickSub')) : emptyState(mt('msg.emptyTitle'), mt('msg.emptySub'), msgNewBtn());
      return;
    }
    var c = msgConv && msgConv.id === msgWith ? msgConv : null;
    var who = c && c.with ? c.with : (msgThread(msgWith) || {}).with;
    var back = '<button class="wsx-dm__back" type="button" data-msg-back aria-label="' + esc(mt('msg.back')) + '" title="' + esc(mt('msg.back')) + '">' + msgSvg('<path d="M15 18l-6-6 6-6"/>') + '</button>';
    var head = '<header class="wsx-dm__head">' + back + (who ? msgAv(who) + '<span class="wsx-dm__who"><b>' + esc(msgName(who)) + '</b>' + (who.name && who.email ? '<span>' + esc(who.email) + '</span>' : '') + '</span>' : '') + '</header>';
    if (!c || !c.with) {
      el.innerHTML = head + (c && c.failed ? '<div class="wsx-empty">' + esc(c.failed) + (c.retry ? ' <button class="wsx-link" type="button" data-msg-retry>' + esc(t('common.retry')) + '</button>' : '') + '</div>' : i18nSpin());
      return;
    }
    var label = mt('msg.placeholder').replace('{name}', msgFirst(who));
    el.innerHTML = head + '<div class="wsx-dm__log" id="wsxMsgLog" role="log" aria-live="polite"></div>'
      + '<form class="wsx-dm__compose" id="wsxMsgForm"><textarea class="wsx-dm__ta" id="wsxMsgText" rows="1" maxlength="' + MSG_MAX + '" enterkeyhint="send" placeholder="' + esc(label) + '" aria-label="' + esc(label) + '"></textarea>'
      + '<button class="wsx-abtn wsx-abtn--primary wsx-dm__send" id="wsxMsgSend" type="submit">' + esc(mt('msg.send')) + '</button></form>'
      + '<p class="wsx-dm__err" id="wsxMsgErr" role="alert" hidden></p>';
    var ta = msgEl('wsxMsgText'); if (ta) { ta.value = msgDrafts[msgWith] || ''; msgGrow(ta); }
    msgPaintLog('bottom');
  }
  function msgLoadConv(id, quiet) {
    var my = ++msgReq;
    return msgFetch('/with/' + encodeURIComponent(id) + '?limit=' + MSG_PAGE).then(function (d) {
      if (my !== msgReq || id !== msgWith) return;
      var list = (d.messages || []).slice().reverse();
      if (quiet && msgConv && msgConv.id === id && msgConv.with) {
        var have = {}; msgConv.messages.forEach(function (m) { have[m.id] = 1; });
        var added = list.filter(function (m) { return !have[m.id]; });
        if (added.length) { msgConv.messages = msgConv.messages.concat(added); msgPaintLog('end'); }
        msgMarkRead(id, added.length > 0);
        return;
      }
      msgConv = { id: id, with: d.with, messages: list, more: list.length >= MSG_PAGE };
      msgPaintConv();
      msgPaintList();
      var ta = msgEl('wsxMsgText');
      if (ta && !quiet && window.matchMedia && window.matchMedia('(min-width: 721px)').matches) ta.focus();
      if (d.thread_id) msgMarkRead(id, true);
    }, function (e) {
      if (my !== msgReq || id !== msgWith || quiet) return;
      var gone = e && (e.code === 'RECIPIENT_NOT_FOUND' || e.status === 404);
      msgConv = { id: id, with: null, messages: [], failed: gone ? mt('msg.notMember') : mt('msg.convFailed'), retry: !gone };
      msgPaintConv();
    });
  }
  // Read on open (force), and on a poll only when something new came in. The badge and the bell
  // drop the count at once; the request runs behind.
  function msgMarkRead(id, force) {
    var th = msgThread(id), n = th ? th.unread || 0 : 0;
    if (!force && !n) return;
    if (n) { th.unread = 0; msgSetUnread({ unread: msgUnread.n - n, threads: msgThreads }); msgPaintList(); }
    fetch(msgBase() + '/with/' + encodeURIComponent(id) + '/read', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
  }
  function msgEarlier() {
    if (!msgConv || !msgConv.messages.length || msgConv.loadingMore) return;
    var id = msgConv.id, before = msgConv.messages[0].createdAt;
    msgConv.loadingMore = true;
    msgFetch('/with/' + encodeURIComponent(id) + '?limit=' + MSG_PAGE + '&before=' + encodeURIComponent(before)).then(function (d) {
      if (!msgConv || msgConv.id !== id) return;
      var older = (d.messages || []).slice().reverse();
      msgConv.messages = older.concat(msgConv.messages);
      msgConv.more = older.length >= MSG_PAGE;
      msgConv.loadingMore = false;
      msgPaintLog('prepend');
    }, function () { if (msgConv) msgConv.loadingMore = false; });
  }

  // ---- composer ----
  function msgGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
  function msgErr(s) { var el = msgEl('wsxMsgErr'); if (el) { el.textContent = s || ''; el.hidden = !s; } }
  function msgBusy(on) {
    var ta = msgEl('wsxMsgText'), btn = msgEl('wsxMsgSend');
    if (ta) ta.disabled = on;
    if (btn) { btn.disabled = on; btn.classList.toggle('is-busy', on); btn.textContent = mt(on ? 'msg.sending' : 'msg.send'); }
  }
  function msgSend() {
    var ta = msgEl('wsxMsgText');
    if (!ta || msgSending || !msgWith || !msgConv || !msgConv.with) return;
    var text = ta.value.trim();
    if (!text) { msgErr(mt('msg.err.MESSAGE_EMPTY')); return; }
    if (text.length > MSG_MAX) { msgErr(mt('msg.err.MESSAGE_TOO_LONG')); return; }
    var to = msgWith, who = msgConv.with;
    msgSending = true; msgErr(''); msgBusy(true);
    msgFetch('', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: to, text: text }) }).then(function (d) {
      msgSending = false;
      delete msgDrafts[to];
      var m = d.message;
      var th = msgThread(to), last = m ? { body: text.slice(0, 140), sentByMe: true, sentVia: m.sentVia || 'web', at: m.createdAt } : null;
      if (m && msgThreads) {
        if (th) msgThreads.splice(msgThreads.indexOf(th), 1);
        else th = { id: d.thread_id, with: who, unread: 0 };
        th.last = last; th.lastMessageAt = m.createdAt;
        msgThreads.unshift(th);
      }
      if (to !== msgWith || !msgConv || msgConv.id !== to) { msgPaintList(); return; }
      if (m) msgConv.messages.push(m);
      msgBusy(false);
      var box = msgEl('wsxMsgText'); if (box) { box.value = ''; msgGrow(box); box.focus(); }
      msgPaintLog('bottom');
      msgPaintList();
    }, function (e) {
      msgSending = false; msgBusy(false);
      var k = 'msg.err.' + (e && e.code);
      msgErr(MSG_COPY.en[k] ? mt(k) : e && e.status === 401 ? t('err.session') : mt('msg.err.send'));
      var box = msgEl('wsxMsgText'); if (box) box.focus();
    });
  }

  // ---- new message: pick a person ----
  function msgPicker() {
    var m = wsxModal(mt('msg.new'), '<input class="wsx-field__in wsx-dm__find" type="search" autocomplete="off" spellcheck="false" placeholder="' + esc(mt('msg.pickerSearch')) + '" aria-label="' + esc(mt('msg.pickerSearch')) + '"><div class="wsx-dm__people">' + i18nSpin() + '</div>');
    var inp = m.body.querySelector('.wsx-dm__find'), list = m.body.querySelector('.wsx-dm__people');
    function paint() {
      if (!msgPeople) return;
      var q = msgFold(inp.value.trim());
      var rows = msgPeople.filter(function (p) { return !q || msgFold(p.name).indexOf(q) >= 0 || msgFold(p.email).indexOf(q) >= 0; });
      list.innerHTML = !msgPeople.length ? '<p class="wsx-dm__none">' + esc(mt('msg.pickerAlone')) + '</p>'
        : !rows.length ? '<p class="wsx-dm__none">' + esc(mt('msg.pickerNone')) + '</p>'
        : rows.map(function (p) {
          return '<button class="wsx-dm__person" type="button" data-msg-person="' + esc(p.id) + '">' + msgAv(p) + '<span class="wsx-dm__who"><b>' + esc(msgName(p)) + '</b>' + (p.name && p.email ? '<span>' + esc(p.email) + '</span>' : '') + '</span></button>';
        }).join('');
    }
    function pick(id) { m.close(); msgOpen(id); }
    inp.addEventListener('input', paint);
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = list.querySelector('[data-msg-person]');
      if (first) { e.preventDefault(); pick(first.getAttribute('data-msg-person')); }
    });
    list.addEventListener('click', function (e) { var b = e.target.closest('[data-msg-person]'); if (b) pick(b.getAttribute('data-msg-person')); });
    setTimeout(function () { inp.focus(); }, 0);
    paint();
    msgFetch('/people').then(function (d) { msgPeople = d.people || []; paint(); }, function () {
      if (msgPeople) return;
      list.innerHTML = '<p class="wsx-dm__none">' + esc(mt('msg.peopleFailed')) + '</p>';
    });
  }

  // ---- routing, polling, wiring ----
  function msgOnScreen() {
    var v = ws.querySelector('.wsx__view[data-view="messages"]'), hp = msgEl('wsxHomePane');
    return !document.hidden && !!v && v.classList.contains('is-active') && (!hp || hp.classList.contains('is-active'));
  }
  function msgStartPoll() { if (!msgTimer) msgTimer = setInterval(function () { if (msgOnScreen()) msgLoadList(true); }, MSG_POLL_MS); }
  function msgStopPoll() { if (msgTimer) { clearInterval(msgTimer); msgTimer = null; } }
  function msgShowConv() {
    if (msgWith && (!msgConv || msgConv.id !== msgWith || msgConv.failed)) { msgConv = null; msgPaintConv(); msgLoadConv(msgWith, false); }
    else msgPaintConv();
  }
  // #l/messages/<userId> opens that conversation; '' is the list.
  function msgRoute(id) {
    id = id || '';
    var ta = msgEl('wsxMsgText');
    if (msgWith && ta) msgDrafts[msgWith] = ta.value;
    msgWith = id;
    if (!msgEl('wsxMsgConv')) return;
    msgErr('');
    msgPaintList();
    msgShowConv();
  }
  function msgOpen(id) { msgRoute(id); if (typeof syncHash === 'function') syncHash(); }
  function msgWire(root) {
    root.addEventListener('click', function (e) {
      var o = e.target.closest('[data-msg-open]'); if (o) { msgOpen(o.getAttribute('data-msg-open')); return; }
      if (e.target.closest('[data-msg-back]')) { msgOpen(''); return; }
      if (e.target.closest('[data-msg-new]')) { msgPicker(); return; }
      if (e.target.closest('[data-msg-earlier]')) { msgEarlier(); return; }
      if (e.target.closest('[data-msg-retry]')) { msgConv = null; msgShowConv(); }
    });
    root.addEventListener('submit', function (e) { if (e.target && e.target.id === 'wsxMsgForm') { e.preventDefault(); msgSend(); } });
    // Enter sends, Shift+Enter is a new line (not while an IME is composing).
    root.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'wsxMsgText' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); msgSend(); }
    });
    root.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'wsxMsgText') return;
      msgDrafts[msgWith] = e.target.value; msgGrow(e.target); msgErr('');
    });
    document.addEventListener('visibilitychange', function () { if (msgTimer && msgOnScreen()) msgLoadList(true); });
  }
  function loadMessages() {
    var root = msgEl('wsxMsgMount'); if (!root) return;
    if (!root.hasAttribute('data-wired')) { root.setAttribute('data-wired', '1'); msgWire(root); }
    var lang = document.documentElement.lang === 'es' ? 'es' : 'en';
    if (!msgEl('wsxMsgConv') || root.getAttribute('data-lang') !== lang) {
      root.setAttribute('data-lang', lang);
      msgPaintShell(); msgPaintList(); msgShowConv();
    }
    msgLoadList(false);
    msgStartPoll();
  }
`;
