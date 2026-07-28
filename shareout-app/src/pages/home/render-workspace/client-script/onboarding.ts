/**
 * Onboarding checklist (work/033) — renders inside the agent dock. Kickoff is fully
 * client-driven (no model call): fetch GET /v1/home/onboarding, greet, render the
 * checklist with real action buttons. Completion is caught by re-fetching the
 * derived status on window focus / tab return (the only signal that survives an
 * external Telegram/Slack connect flow). Copy is localized via t('onb.*').
 *
 * Runs after agent-dock in the shared IIFE, so makeCol/openDock/agentAsk/scrollEnd/
 * el/esc/t/ws are all in scope.
 */
export const workspace_client_onboarding_JS = `  // ===== onboarding checklist =====
  var ONB_API = '/v1/home/onboarding';
  var ONB_SKIP_LS = 'wsx_onb_skip_' + SCOPE;
  var onbCard = null, onbGreeted = false, onbCelebrated = false, onbDone = {}, onbBusy = false;

  function onbQs() { return (SCOPE && SCOPE !== 'personal') ? ('?workspace=' + encodeURIComponent(SCOPE)) : ''; }
  function onbSkipped() { try { return JSON.parse(localStorage.getItem(ONB_SKIP_LS) || '[]'); } catch (e) { return []; } }
  function onbSkip(key) { var s = onbSkipped(); if (s.indexOf(key) < 0) s.push(key); try { localStorage.setItem(ONB_SKIP_LS, JSON.stringify(s)); } catch (e) {} }

  function onbRing(pct) {
    var C = 100.53; // 2*pi*16
    var off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
    var svg = '<svg class="wsx-onb__ring" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">'
      + '<circle class="wsx-onb__ringbg" cx="20" cy="20" r="16"></circle>'
      + '<circle class="wsx-onb__ringfg" cx="20" cy="20" r="16" style="stroke-dasharray:' + C + ';stroke-dashoffset:' + off + '"></circle>'
      + '</svg>';
    return svg;
  }

  function onbDispatch(action) {
    if (!action) return;
    if (action.kind === 'ask') { if (typeof agentAsk === 'function') agentAsk(t(action.seedKey), true); }
    else if (action.kind === 'nav') { var b = ws.querySelector('[data-lens=\"' + action.target + '\"]'); if (b) b.click(); }
    else if (action.kind === 'page') { window.open(action.url, '_blank', 'noopener'); }
    else if (action.kind === 'skill') {
      fetch(ONB_API + '/skill-ack' + onbQs(), { method: 'POST', credentials: 'same-origin' }).then(function () { refreshOnb(false); }).catch(function () {});
      var lb = ws.querySelector('[data-lens=\"library\"]'); if (lb) lb.click();
    }
  }

  function renderOnb(s, kickoff) {
    if (kickoff && !onbGreeted) {
      onbGreeted = true;
      var nm = (window.WSX_NAME || '').trim();
      var greet = nm ? t('onb.greet').replace('{name}', nm) : t('onb.greetNoName');
      var gcol = makeCol('bot'); var gb = el('div', 'wsx-msg bot'); gb.innerHTML = mdToHtml(greet); gcol.appendChild(gb);
      openDock(); scrollEnd(true);
    }
    var skipped = onbSkipped();
    var tasks = (s.tasks || []).filter(function (tk) { return skipped.indexOf(tk.key) < 0; });
    var doneCount = tasks.filter(function (tk) { return tk.done; }).length;
    var full = s.pct >= 100;

    if (!onbCard) {
      var col = makeCol('bot');
      onbCard = el('div', 'wsx-onb'); onbCard.setAttribute('role', 'status'); onbCard.setAttribute('aria-live', 'polite');
      col.appendChild(onbCard); scrollEnd(true);
    }
    onbCard.innerHTML = '';
    onbCard.classList.toggle('is-full', full);

    var head = el('div', 'wsx-onb__head');
    var ring = el('div', 'wsx-onb__ringwrap'); ring.innerHTML = onbRing(s.pct);
    var htext = el('div', 'wsx-onb__htext');
    var ttl = el('b', 'wsx-onb__title'); ttl.textContent = full ? t('onb.doneTitle') : t('onb.title');
    var prog = el('span', 'wsx-onb__progress');
    prog.textContent = full ? t('onb.doneBody') : t('onb.progress').replace('{done}', String(doneCount)).replace('{total}', String(tasks.length));
    htext.appendChild(ttl); htext.appendChild(prog);
    head.appendChild(ring); head.appendChild(htext);
    if (!full) {
      var hide = el('button', 'wsx-onb__hide'); hide.type = 'button'; hide.textContent = t('onb.hide');
      hide.addEventListener('click', function () {
        fetch(ONB_API + '/dismiss' + onbQs(), { method: 'POST', credentials: 'same-origin' }).catch(function () {});
        var row = onbCard.closest ? onbCard.closest('.wsx-row') : null; if (row) row.remove(); else onbCard.remove(); onbCard = null;
      });
      head.appendChild(hide);
    }
    onbCard.appendChild(head);

    if (!full) {
      var list = el('ul', 'wsx-onb__list');
      tasks.forEach(function (tk) {
        var li = el('li', 'wsx-onb__item' + (tk.done ? ' is-done' : ''));
        if (tk.done && !onbDone[tk.key]) li.classList.add('is-justdone');
        var chk = el('span', 'wsx-onb__check'); chk.setAttribute('aria-hidden', 'true'); chk.textContent = tk.done ? '\\u2713' : '\\u25CB';
        var body = el('span', 'wsx-onb__body');
        var lab = el('span', 'wsx-onb__label'); lab.textContent = t('onb.task.' + tk.key);
        var why = el('span', 'wsx-onb__why'); why.textContent = t('onb.why.' + tk.key);
        body.appendChild(lab); body.appendChild(why);
        li.appendChild(chk); li.appendChild(body);
        if (!tk.done) {
          var cta = el('button', 'wsx-onb__cta'); cta.type = 'button'; cta.textContent = t('onb.cta.' + tk.key);
          cta.addEventListener('click', function () { onbDispatch(tk.action); });
          li.appendChild(cta);
          if (tk.skippable) {
            var sk = el('button', 'wsx-onb__skipbtn'); sk.type = 'button'; sk.textContent = t('onb.skip');
            sk.addEventListener('click', function () { onbSkip(tk.key); refreshOnb(false); });
            li.appendChild(sk);
          }
        }
        list.appendChild(li);
      });
      onbCard.appendChild(list);
    }

    onbDone = {}; tasks.forEach(function (tk) { if (tk.done) onbDone[tk.key] = 1; });

    if (full && !s.celebrated && !onbCelebrated) {
      onbCelebrated = true;
      onbCard.classList.add('is-celebrate');
      if (announcer) announcer.announce(t('onb.doneTitle'), { now: true });
      fetch(ONB_API + '/celebrate' + onbQs(), { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    }
    scrollEnd();
  }

  // mode: true = kickoff (auto-open only if eligible); 'force' = always render (agent asked);
  // false = focus refetch (only updates an already-open checklist).
  function refreshOnb(mode) {
    if (onbBusy) return; onbBusy = true;
    fetch(ONB_API + onbQs(), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        onbBusy = false;
        if (!s || !s.track) return;
        if (mode === true) { if (!s.eligible) return; }
        else if (mode !== 'force' && !onbCard) { return; }
        renderOnb(s, mode === true || mode === 'force');
      })
      .catch(function () { onbBusy = false; });
  }
  // Agent-triggered surfacing (show_onboarding tool → ui_action). Hoisted, so the dock's
  // ui_action handler can call it even though this fragment loads after agent-dock.
  function onbForce() { openDock(); refreshOnb('force'); }

  // Kickoff: only for a fresh session (no open thread), and only auto-opens if eligible.
  // Fires for a workspace home (WSX_WS set) or the personal home (SCOPE === 'personal').
  if (!currentThreadId && (window.WSX_WS || SCOPE === 'personal')) refreshOnb(true);

  // Completion refresh: the user leaves to connect Telegram/Slack in another tab, then
  // returns — that tab-return is the only reliable client signal. Re-derive on focus.
  var onbLastCheck = 0;
  function onbMaybeRefresh() {
    if (!onbCard) return;
    var now = Date.now(); if (now - onbLastCheck < 1500) return; onbLastCheck = now;
    refreshOnb(false);
  }
  window.addEventListener('focus', onbMaybeRefresh);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) onbMaybeRefresh(); });

`;
