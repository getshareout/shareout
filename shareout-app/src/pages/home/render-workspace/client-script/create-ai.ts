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
  // Who can see the page the moment it goes live: private unless picked at "Build it".
  var createVis = 'private';
  function visChoice(box) {
    var wrap = document.createElement('div'); wrap.className = 'wsx-confirm__who';
    var opts = ['private'].concat(window.WSX_WS ? ['workspace'] : [], ['public']), names = { private: 'create.visPrivate', workspace: 'create.visTeam', public: 'create.visPublic' };
    wrap.innerHTML = '<div class="wsx-confirm__p">' + esc(t('create.whoCanSee')) + '</div><div class="wsx-confirm__row" role="radiogroup">'
      + opts.map(function (o) { var off = o === 'public' && window.WSX_OPEN_VIS === false; return '<button class="wsx-chip' + (o === createVis ? ' is-on' : '') + '" data-cv="' + o + '" role="radio" aria-checked="' + (o === createVis) + '" type="button"' + (off ? ' disabled title="' + esc(t('create.visPublicOff')) + '"' : '') + '>' + esc(t(names[o])) + '</button>'; }).join('') + '</div>'
      + (window.WSX_OPEN_VIS === false ? '<div class="wsx-confirm__p">' + esc(t('create.visPublicOff')) + '</div>' : '');
    wrap.querySelectorAll('[data-cv]').forEach(function (b) {
      b.addEventListener('click', function () {
        createVis = b.getAttribute('data-cv');
        wrap.querySelectorAll('[data-cv]').forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on); });
      });
    });
    box.appendChild(wrap);
  }
  function renderConfirm(c) {
    var box = document.createElement('div'); box.className = 'wsx-confirm';
    var p = document.createElement('div'); p.className = 'wsx-confirm__p'; p.textContent = c.label || t('create.confirmReady');
    visChoice(box);
    var row = document.createElement('div'); row.className = 'wsx-confirm__row';
    var ok = document.createElement('button'); ok.className = 'wsx-confirm__ok'; ok.textContent = t('create.buildIt');
    row.appendChild(ok); box.insertBefore(p, box.firstChild); box.appendChild(row); threadList.appendChild(box);
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
    var job = { view: view || null, armed: false, stopped: false, settled: false, id: null, tries: 0 };
    var full = '';
    var paint = srcdocThrottle(function (html) { if (job.view) job.view.frame.srcdoc = html; }, 250);
    function live() { return job.view && livePanes[job.view.key]; }
    function stop() {
      if (job.settled) return;
      job.stopped = true; paint.cancel();
      if (ctl) ctl.abort();
      // Closing the live tab stops the build; closing the browser does not (it runs on as a job).
      if (job.id) fetch('/v1/builds/' + encodeURIComponent(job.id) + '/cancel', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
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
    fetch('/v1/create/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'build', prompt: prompt, visibility: createVis, workspace_id: window.WSX_WS || undefined }), signal: ctl ? ctl.signal : undefined })
      .then(function (resp) {
        if (!resp.ok || !resp.body) {
          return resp.json().catch(function () { return {}; }).then(function (d) {
            fail(d && d.error ? t('create.buildFailed') + d.error : t('create.buildUnavailable'));
          });
        }
        return readStream(resp, onEv).then(dropped);
      })
      .catch(dropped);
    function onEv(ev) {
      if (job.stopped || job.settled) return;
      if (ev.type === 'job') { job.id = ev.id; }
      else if (ev.type === 'delta') {
        full += ev.text || '';
        if (!job.armed) arm();
        paint.push(full);
      } else if (ev.type === 'step') {
        // BUILD_AGENT: what the agent is doing now, already in the user's language.
        if (ev.label) prog.textContent = ev.label;
      } else if (ev.type === 'done') {
        if (!ev.slug) { fail(t('create.buildUnavailable')); return; }
        job.settled = true; paint.cancel();
        var mod = ev.moderation;
        prog.textContent = t(mod ? (mod.status === 'blocked' ? 'create.buildBlocked' : 'create.buildHeld') : (ev.visibility_downgraded ? 'create.buildPrivate' : 'create.buildDone'));
        setPillStep(null);
        openArtifact(ev.slug, '\\u2728 ' + String(prompt).slice(0, 28), ev.artifactId, 'html', job.view ? job.view.key : null);
        setComposer('resting');
        exitCreate();
      } else if (ev.type === 'error') { fail(t('create.buildFailed') + (ev.error || 'unknown')); }
    }
    // The stream ended before the build did. A durable job keeps building on the server: reattach
    // (it replays the steps and the page so far) a few times before giving up.
    function dropped() {
      if (job.stopped || job.settled) return;
      if (!job.id || ++job.tries > 3) { fail(t('create.connDroppedBuild')); return; }
      setTimeout(function () {
        full = '';
        fetch('/v1/builds/' + encodeURIComponent(job.id) + '/events', { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
          .then(function (r) { if (!r.ok || !r.body) throw new Error('reattach ' + r.status); return readStream(r, onEv).then(dropped); })
          .catch(dropped);
      }, 1500);
    }
  }
${SRCDOC_THROTTLE_JS}`;
