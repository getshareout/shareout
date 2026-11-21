/** Direct messages in the boot shell: the unread count behind the rail badge and the bell, and the
 *  person chip both they and the Messages view use. The view itself is a lazy chunk
 *  (home-views/messages.ts). One request at boot; the bell reuses it while it is in flight, and
 *  the view paints its conversations at once and refreshes them behind. */
export const workspace_client_messages_badge_JS = `
  // ===== direct messages: unread count (rail badge + bell) =====
  var msgUnread = { n: 0, threads: [] };
  var msgUnreadReq = null;
  // Every conversation from the last boot/bell request (the Messages view's first paint).
  var msgBootThreads = null;
  function msgName(p) { return (p && (p.name || p.email)) || t('msg.someone'); }
  function msgAv(p, cls) {
    var c = 'wsx-dm__av' + (cls ? ' ' + cls : '');
    if (p && p.picture) return '<span class="' + c + '"><img src="' + esc(p.picture) + '" alt=""></span>';
    return '<span class="' + c + '" aria-hidden="true">' + esc((msgName(p).trim()[0] || '?').toUpperCase()) + '</span>';
  }
  // The Messages entry is only in the rail for internal members of a workspace.
  function msgOn() { return !!(window.WSX_WS && ws.querySelector('[data-lens="messages"]')); }
  function msgPaintNav() {
    var lb = ws.querySelector('[data-lens="messages"]'); if (!lb) return;
    var b = lb.querySelector('.wsx-lens__bdg');
    if (!b) { b = document.createElement('span'); b.className = 'wsx-lens__bdg'; lb.appendChild(b); }
    b.hidden = !msgUnread.n;
    b.textContent = msgUnread.n > 99 ? '99+' : String(msgUnread.n);
  }
  // d = { unread, threads } from GET …/messages (any filter): keeps the conversations with unread.
  function msgSetUnread(d) {
    msgUnread = { n: Math.max(0, Number(d && d.unread) || 0), threads: ((d && d.threads) || []).filter(function (x) { return x && x.unread > 0; }) };
    msgPaintNav();
    document.dispatchEvent(new CustomEvent('wsx:msg-unread'));
  }
  function msgFetchUnread() {
    if (!msgOn()) return Promise.resolve(msgUnread);
    if (msgUnreadReq) return msgUnreadReq;
    msgUnreadReq = fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/messages?limit=50', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { msgBootThreads = d.threads || []; msgSetUnread(d); } return msgUnread; }, function () { return msgUnread; })
      .then(function (u) { msgUnreadReq = null; return u; });
    return msgUnreadReq;
  }
  // Open the conversation with one person (#l/messages/<userId>), as the Telegram notice does.
  function msgGo(id) {
    var h = '#l/messages/' + encodeURIComponent(id);
    if (location.hash === h) applyHash(); else location.hash = h;
  }
  msgFetchUnread();
  // Fetch the view's code on the way to a click, so opening Messages waits on nothing.
  (function () {
    var lb = ws.querySelector('[data-lens="messages"]'); if (!lb) return;
    function warm() { wsxChunk('messages'); }
    lb.addEventListener('pointerenter', warm, { once: true });
    lb.addEventListener('focus', warm, { once: true });
  })();

`;
