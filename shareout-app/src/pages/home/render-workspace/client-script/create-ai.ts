/** Create with AI flow. */
export const workspace_client_create_ai_JS = `  // ===== Create with AI (in-Studio; reuses /v1/create/generate) =====
  var SOURCES = ['Google Sheets', 'Google Analytics', 'Shopify', 'Snowflake', 'A CSV upload'];
  var createMode = false;
  function renderCreatePanels() {
    var idEl = document.getElementById('wsxIdeas');
    if (idEl) {
      var ideas = t('create.ideas').split('|');
      idEl.innerHTML = ideas.map(function (x) { return '<button class="wsx-chip" data-idea="' + esc(x) + '" type="button">' + esc(x) + '</button>'; }).join('');
      idEl.querySelectorAll('[data-idea]').forEach(function (b) { b.addEventListener('click', function () { createSend(b.getAttribute('data-idea')); }); });
    }
    var scEl = document.getElementById('wsxSources');
    if (scEl) {
      scEl.innerHTML = SOURCES.map(function (x) { return '<button class="wsx-chip" data-source="' + esc(x) + '" type="button">' + esc(x) + '</button>'; }).join('');
      scEl.querySelectorAll('[data-source]').forEach(function (b) { b.addEventListener('click', function () { createSend(t('create.sourcePrompt').replace('{source}', b.getAttribute('data-source'))); }); });
    }
  }
  function enterCreate() {
    createMode = true;
    lenses.forEach(function (x) { x.classList.remove('is-active'); });
    activateTab('home'); show('create'); renderCreatePanels();
    ws.classList.add('is-create');
    ask.placeholder = t('create.placeholder');
    threadList.innerHTML = ''; openComposer('sheet');
    addMsg('bot', t('create.greeting'));
    ask.focus();
  }
  function exitCreate() {
    if (!createMode) return;
    createMode = false; ws.classList.remove('is-create');
    ask.placeholder = t('composer.placeholder');
  }
  var createBtn = document.getElementById('wsxCreateBtn');
  if (createBtn) createBtn.addEventListener('click', enterCreate);

  function createSend(text) { if (!text) return; addMsg('user', text); createPlan(text); }
  function createPlan(prompt) {
    var typing = addMsg('bot', '\\u2026'); typing.classList.add('is-typing');
    fetch('/v1/create/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'plan', prompt: prompt }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove();
        if (!d || !d.ok) { addMsg('bot', t('create.planFail')); return; }
        if (d.message) addMsg('bot', d.message);
        if (d.type === 'clarify' && d.questions && d.questions.length) renderClarify(d.questions, prompt);
        else if (d.type === 'confirm' && d.confirm) renderConfirm(d.confirm);
        else if (d.type === 'build') createBuild(prompt);
        if (d.suggestions && d.suggestions.length) renderSuggestions(d.suggestions);
      })
      .catch(function () { typing.remove(); addMsg('bot', t('create.connDropped')); });
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
  function createBuild(prompt) {
    var prog = addMsg('bot', t('create.buildingPage'));
    fetch('/v1/create/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'build', prompt: prompt }) })
      .then(function (resp) {
        if (!resp.ok || !resp.body) { prog.textContent = t('create.buildUnavailable'); return; }
        return readStream(resp, function (ev) {
          if (ev.type === 'done') {
            prog.textContent = t('create.buildDone');
            if (ev.slug) { openArtifact(ev.slug, '\\u2728 ' + String(prompt).slice(0, 28), ev.artifactId); setComposer('docked'); }
            exitCreate();
          } else if (ev.type === 'error') { prog.textContent = t('create.buildFailed') + (ev.error || 'unknown'); }
        });
      })
      .catch(function () { prog.textContent = t('create.connDroppedBuild'); });
  }
`;
