import { SRCDOC_THROTTLE_JS } from '../../../srcdoc-throttle';

/** Create with AI flow. */
export const workspace_client_create_ai_JS = `  // ===== Create with AI (in-Studio; reuses /v1/create/generate) =====
  var createMode = false;
  // Create with AI lives entirely in the chat: open the composer in create mode with idea chips.
  function enterCreate() {
    createMode = true;
    ws.classList.add('is-create');
    ask.placeholder = t('create.placeholder');
    threadList.innerHTML = ''; openComposer('sheet');
    addMsg('bot', t('create.greeting'));
    renderSuggestions(t('create.ideas').split('|'));
    ask.focus();
  }
  function exitCreate() {
    if (!createMode) return;
    createMode = false; ws.classList.remove('is-create');
    ask.placeholder = t('composer.placeholder');
  }

  function createSend(text) { if (!text) return; addMsg('user', text); createPlan(text); }
  function createPlan(prompt) {
    var typing = addMsg('bot', '\\u2026'); typing.classList.add('is-typing');
    fetch('/v1/create/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'plan', prompt: prompt }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        removeRow(rowOf(typing));
        if (!d || !d.ok) { addMsg('bot', t('create.planFail')); return; }
        if (d.message) addMsg('bot', d.message);
        if (d.type === 'clarify' && d.questions && d.questions.length) renderClarify(d.questions, prompt);
        else if (d.type === 'confirm' && d.confirm) renderConfirm(d.confirm);
        else if (d.type === 'build') createBuild(prompt);
        if (d.suggestions && d.suggestions.length) renderSuggestions(d.suggestions);
      })
      .catch(function () { removeRow(rowOf(typing)); addMsg('bot', t('create.connDropped')); });
  }
  function renderClarify(questions, basePrompt) {
    var answers = []; var qi = 0;
    var box = document.createElement('div'); box.className = 'wsx-clarify'; threadList.appendChild(box);
    function renderQ() {
      if (qi >= questions.length) {
        addMsg('user', answers.join(' \\u00B7 '));
        createBuild(basePrompt + ' \\u2014 ' + answers.join(', '));
        return;
      }
      var q = questions[qi];
      box.innerHTML = '<div class="wsx-clarify__q">' + esc(q.q) + '</div><div class="wsx-clarify__opts">'
        + (q.options || []).map(function (o) { return '<button class="wsx-chip" data-opt="' + esc(o) + '" type="button">' + esc(o) + '</button>'; }).join('') + '</div>';
      box.querySelectorAll('[data-opt]').forEach(function (b) { b.addEventListener('click', function () { answers.push(b.getAttribute('data-opt')); qi++; renderQ(); }); });
      threadWrap.scrollTop = threadWrap.scrollHeight;
    }
    renderQ();
  }
  function renderConfirm(c) {
    var box = document.createElement('div'); box.className = 'wsx-confirm';
    var p = document.createElement('div'); p.className = 'wsx-confirm__p'; p.textContent = c.label || t('create.confirmReady');
    var row = document.createElement('div'); row.className = 'wsx-confirm__row';
    var ok = document.createElement('button'); ok.className = 'wsx-confirm__ok'; ok.textContent = t('create.buildIt');
    row.appendChild(ok); box.appendChild(p); box.appendChild(row); threadList.appendChild(box);
    ok.addEventListener('click', function () { ok.disabled = true; ok.textContent = t('create.building'); createBuild(c.prompt); });
  }
  function renderSuggestions(s) {
    var box = document.createElement('div'); box.className = 'wsx__chips wsx-suggest';
    box.innerHTML = s.map(function (t) { return '<button class="wsx-chip" data-sg="' + esc(t) + '" type="button">' + esc(t) + '</button>'; }).join('');
    threadList.appendChild(box);
    box.querySelectorAll('[data-sg]').forEach(function (b) { b.addEventListener('click', function () { createSend(b.getAttribute('data-sg')); }); });
  }
  // ----- build: watch the page come together in a live tab, then swap in the real artifact -----
  // The live tab is a scripts-only sandbox fed by srcdoc (never same-origin), repainted at
  // most every 250 ms. It is never saved and never offers View/Edit; closing it aborts.
  var liveSeq = 0;
  var pillText = pill ? pill.querySelector('.wsx__pill-text') : null;
  function setPillStep(key) {
    if (!pillText) return;
    key = key || 'composer.pill';
    pillText.setAttribute('data-i18n', key);
    pillText.textContent = t(key);
  }
  function liveName(prompt) { var s = String(prompt).trim(); return s.length > 28 ? s.slice(0, 27) + '\\u2026' : s; }
  function makeLiveView(prompt, label) {
    var pane = document.createElement('div');
    pane.className = 'wsx__pane wsx__pane--art wsx__pane--live';
    pane.innerHTML = '<p class="wsx-live__status" role="status"></p>'
      + '<iframe class="wsx__stageframe" sandbox="allow-scripts"></iframe>'
      + '<div class="wsx-live__err" role="alert" hidden><p class="wsx-live__msg"></p>'
      + '<button class="wsx-live__retry" type="button"></button></div>';
    var v = { key: 'live:' + (++liveSeq), pane: pane, frame: pane.querySelector('iframe'), status: pane.querySelector('.wsx-live__status'),
      err: pane.querySelector('.wsx-live__err'), msg: pane.querySelector('.wsx-live__msg'), retry: pane.querySelector('.wsx-live__retry') };
    v.frame.setAttribute('title', label);
    v.retry.textContent = t('create.retry');
    v.retry.addEventListener('click', function () { createBuild(prompt, v); });
    return v;
  }
  function addRetry(prompt) {
    var row = document.createElement('div'); row.className = 'wsx-confirm__row';
    var b = document.createElement('button'); b.className = 'wsx-confirm__ok'; b.type = 'button'; b.textContent = t('create.retry');
    b.addEventListener('click', function () { b.disabled = true; createBuild(prompt); });
    row.appendChild(b); threadList.appendChild(row); scrollEnd();
  }
  function createBuild(prompt, view) {
    var label = t('create.buildingTab').replace('{name}', function () { return liveName(prompt); });
    var prog = addMsg('bot', t('create.buildingPage'));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var job = { view: view || null, armed: false, stopped: false, settled: false };
    var full = '';
    var paint = srcdocThrottle(function (html) { if (job.view) job.view.frame.srcdoc = html; }, 250);
    function live() { return job.view && livePanes[job.view.key]; }
    function stop() {
      if (job.settled) return;
      job.stopped = true; paint.cancel();
      if (ctl) ctl.abort();
      prog.textContent = t('create.buildStopped');
      setPillStep(null);
    }
    // Show the live tab (new, or the failed one being retried) and fold the chat to the pill.
    function arm() {
      job.armed = true;
      if (!live()) { job.view = makeLiveView(prompt, label); openLiveTab(job.view.key, label, job.view.pane, stop); }
      else { livePanes[job.view.key].onClose = stop; job.view.err.hidden = true; }
      job.view.status.textContent = t('create.buildingLive');
      prog.textContent = t('create.buildingLive');
      setPillStep('create.buildingLive');
      var hadFocus = composer.contains(document.activeElement);
      setComposer('resting');
      if (hadFocus && pill) { try { pill.focus({ preventScroll: true }); } catch (e) { pill.focus(); } }
    }
    function fail(text) {
      if (job.stopped || job.settled) return;
      job.settled = true; paint.cancel();
      prog.textContent = text;
      setPillStep(null);
      if (live()) {
        livePanes[job.view.key].onClose = null;
        job.view.status.textContent = '';
        job.view.msg.textContent = text;
        job.view.err.hidden = false;
      } else addRetry(prompt);
    }
    if (live()) arm();
    fetch('/v1/create/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'build', prompt: prompt }), signal: ctl ? ctl.signal : undefined })
      .then(function (resp) {
        if (!resp.ok || !resp.body) {
          return resp.json().catch(function () { return {}; }).then(function (d) {
            fail(d && d.error ? t('create.buildFailed') + d.error : t('create.buildUnavailable'));
          });
        }
        return readStream(resp, function (ev) {
          if (job.stopped || job.settled) return;
          if (ev.type === 'delta') {
            full += ev.text || '';
            if (!job.armed) arm();
            paint.push(full);
          } else if (ev.type === 'done') {
            if (!ev.slug) { fail(t('create.buildUnavailable')); return; }
            job.settled = true; paint.cancel();
            var mod = ev.moderation;
            prog.textContent = t(mod ? (mod.status === 'blocked' ? 'create.buildBlocked' : 'create.buildHeld') : (ev.visibility === 'private' ? 'create.buildPrivate' : 'create.buildDone'));
            setPillStep(null);
            openArtifact(ev.slug, '\\u2728 ' + String(prompt).slice(0, 28), ev.artifactId, 'html', job.view ? job.view.key : null);
            setComposer('resting');
            exitCreate();
          } else if (ev.type === 'error') { fail(t('create.buildFailed') + (ev.error || 'unknown')); }
        }).then(function () { fail(t('create.connDroppedBuild')); });
      })
      .catch(function () { fail(t('create.connDroppedBuild')); });
  }
${SRCDOC_THROTTLE_JS}`;
