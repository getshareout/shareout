import { renderHtmlPage } from '../design-system/shell';
import { createPageStyles } from '../design-system/pages/create.css';
import { brandLockupHtml } from '../brand';
import { STARTER_PACKS } from './themes';

const arrowSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 6l6 6-6 6"/></svg>`;
const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
const googleSvg = `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Embed a value as a JS string literal that can't break out of <script>.
function jsString(s: string): string {
  return JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function renderCreatePage(
  rawPrompt: string,
  user: { id: string; email: string } | null,
  turnstileSiteKey?: string,
  // The mock URL bar shows where the page being built will live. Hardcoded to the
  // hosted domain it told every self-hoster their work would land somewhere else.
  platformHost = 'shareout.site',
): Response {
  const prompt = (rawPrompt || 'Build me something with my data').trim().slice(0, 400);
  const safe = escapeHtml(prompt);
  const loggedIn = !!user;

  const body = `<div class="creator">
  <aside class="chat glass">
    <div class="chat-head">
      ${brandLockupHtml({ markSize: 26, className: 'chat-brand', href: '/' })}
      <a class="chat-new" href="/">+ New</a>
    </div>
    <div class="chat-body" id="chatBody">
      <div class="msg user">${safe}</div>
    </div>
    <div class="chat-foot">
      <div class="chat-input">
        <input id="chatInput" type="text" autocomplete="off" ${loggedIn ? '' : 'disabled'} placeholder="${loggedIn ? 'Ask for changes…' : 'Save to edit & keep building…'}" aria-label="Ask for changes">
        <button id="chatSend" type="button" aria-label="Send">${arrowSvg}</button>
      </div>
    </div>
  </aside>

  <div class="hud glass">
    <div class="tabs">
      <span class="tab2 active" data-tab="preview">Preview</span>
      <span class="tab2" data-tab="code">Code</span>
    </div>
    <div class="url2" id="urlBar">${escapeHtml(platformHost)}/<b>your-project</b></div>
    <a class="share" id="shareBtn">Share</a>
  </div>

  <main class="stage">
    <div class="frame">
      <div class="frame-body">
        <div class="preview-empty" id="previewEmpty">Your page appears here the moment you’re in.</div>
        <div class="building" id="skeleton" hidden>
          <div class="spinner"></div>
          <div class="building-label">Designing your page…</div>
        </div>
        <iframe id="previewFrame" class="preview-frame" title="Live preview" hidden></iframe>
        <pre class="code-view" id="codeView" hidden></pre>
      </div>
    </div>
  </main>
</div>
<script src="/sdk/chat-core.js"></script>`;

  const clientPacks = STARTER_PACKS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, swatch: p.swatch }));

  const scripts = `(function(){
  var S = { prompt: ${jsString(prompt)}, loggedIn: ${loggedIn ? 'true' : 'false'} };
  var TS_KEY = ${jsString(turnstileSiteKey || '')};
  var PACKS = ${JSON.stringify(clientPacks).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
  var ARROW_SVG = ${jsString(arrowSvg)};
  var CHECK_SVG = ${jsString(checkSvg)};
  var GOOGLE_SVG = ${jsString(googleSvg)};

  var bodyEl = document.getElementById('chatBody');
  var creator = document.querySelector('.creator');
  var input = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSend');
  var frame = document.getElementById('previewFrame');
  var codeView = document.getElementById('codeView');
  var skeleton = document.getElementById('skeleton');
  var previewEmpty = document.getElementById('previewEmpty');
  var urlBar = document.getElementById('urlBar');
  var shareBtn = document.getElementById('shareBtn');

  var state = { slug: null, html: '', url: '', busy: false, authed: S.loggedIn, previewHtml: null, theme: null };

  // Shared message-list view (chat-core). Loaded via <script src="/sdk/chat-core.js">.
  var view = window.ChatCore.createChatView(bodyEl, { userClass: 'msg user', botClass: 'msg ai' });

  // Authed users build & publish; anonymous users get a live preview first (the value moment).
  function proceedBuild(prompt){ if (state.authed){ runBuild(prompt); } else { runPreview(prompt); } }

  function scrollDown(){ view.controller.stickToBottom(); }
  function esc(t){ var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }
  function textMsg(html){ return view.addBot().html(html).el; }
  function userMsg(text){ view.addUser(text); }

  // ---- Generating: lightweight "thinking" state (planning phase) ----
  function thinkingWidget(){
    var d = document.createElement('div');
    d.className = 'msg ai thinking';
    d.innerHTML = 'Thinking<span class="dots"><i></i><i></i><i></i></span>';
    bodyEl.appendChild(d); scrollDown();
    return d;
  }

  // ---- Generating: staged build widget (build phase) ----
  var STEPS = ['Understanding your request','Designing the layout','Wiring up your data','Publishing it live'];
  function buildingWidget(intro){
    var s = '';
    for (var i = 0; i < STEPS.length; i++){ s += '<div class="step" data-step><span class="tick"></span>' + STEPS[i] + '</div>'; }
    var d = textMsg((intro ? esc(intro) : 'On it — building this now.') + '<div class="steps">' + s + '</div>');
    var steps = d.querySelectorAll('[data-step]');
    var i = 0;
    function adv(){
      if (i > 0){ steps[i-1].classList.remove('active'); steps[i-1].classList.add('done'); }
      if (i < steps.length){ steps[i].classList.add('active'); i++; d._t = setTimeout(adv, 900); }
    }
    adv();
    d._steps = steps;
    return d;
  }
  function finishBuilding(d){
    if (!d) return;
    clearTimeout(d._t);
    var steps = d._steps || [];
    for (var i = 0; i < steps.length; i++){ steps[i].classList.remove('active'); steps[i].classList.add('done'); }
  }
  function stopBuilding(d){ if (d) clearTimeout(d._t); }

  // ---- Suggestion chips ----
  function suggestionsWidget(list){
    if (!list || !list.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'chips';
    for (var i = 0; i < list.length; i++){
      (function(text){
        var c = document.createElement('button');
        c.type = 'button'; c.className = 'chip'; c.textContent = text;
        c.addEventListener('click', function(){
          if (state.busy) return;
          wrap.remove();
          userMsg(text);
          handlePrompt(text);
        });
        wrap.appendChild(c);
      })(list[i]);
    }
    bodyEl.appendChild(wrap); scrollDown();
  }

  // ---- Clarifying questions (tappable, before the first build) ----
  function clarifyWidget(questions, basePrompt){
    if (!questions || !questions.length){ proceedBuild(basePrompt); return; }
    var answers = new Array(questions.length);
    var card = document.createElement('div');
    card.className = 'clarify-card';
    var html = '';
    for (var i = 0; i < questions.length; i++){
      var q = questions[i];
      html += '<div class="clarify-q"><div class="clarify-label">' + esc(q.q) + '</div><div class="clarify-opts">';
      for (var j = 0; j < (q.options || []).length; j++){
        html += '<button type="button" class="clarify-opt" data-qi="' + i + '" data-val="' + esc(q.options[j]) + '">' + esc(q.options[j]) + '</button>';
      }
      html += '</div></div>';
    }
    card.innerHTML = html;
    bodyEl.appendChild(card); scrollDown();

    function maybeDone(){
      for (var k = 0; k < questions.length; k++){ if (answers[k] == null) return; }
      card.classList.add('resolved');
      var parts = [];
      for (var k = 0; k < questions.length; k++){ parts.push(questions[k].q + ' ' + answers[k]); }
      userMsg(answers.join(' · '));
      proceedBuild(basePrompt + '\\n\\nUser preferences: ' + parts.join('. '));
    }

    var opts = card.querySelectorAll('.clarify-opt');
    for (var n = 0; n < opts.length; n++){
      (function(btn){
        btn.addEventListener('click', function(){
          if (state.busy || card.classList.contains('resolved')) return;
          var qi = parseInt(btn.getAttribute('data-qi'), 10);
          answers[qi] = btn.getAttribute('data-val');
          var sibs = card.querySelectorAll('.clarify-opt[data-qi="' + qi + '"]');
          for (var s = 0; s < sibs.length; s++){ sibs[s].classList.remove('selected'); }
          btn.classList.add('selected');
          maybeDone();
        });
      })(opts[n]);
    }
  }

  // ---- Starter-pack picker (shown before the first build) ----
  function showThemePicker(){
    previewEmpty.hidden = true;
    var frameBody = document.querySelector('.frame-body');
    var wrap = document.createElement('div');
    wrap.className = 'theme-picker';
    var html = '<div class="tp-head"><div class="tp-title">Pick a starting look</div>' +
      '<div class="tp-sub">I’ll design around it — change anything after.</div></div><div class="tp-grid">';
    for (var i = 0; i < PACKS.length; i++){
      var p = PACKS[i];
      html += '<button type="button" class="tp-card" data-id="' + esc(p.id) + '">' +
        '<span class="tp-swatch" style="background:' + esc(p.swatch[0]) + '">' +
          '<span class="tp-dot" style="background:' + esc(p.swatch[1]) + '"></span>' +
          '<span class="tp-dot" style="background:' + esc(p.swatch[2]) + '"></span>' +
        '</span>' +
        '<span class="tp-name">' + esc(p.name) + '</span>' +
        '<span class="tp-blurb">' + esc(p.blurb) + '</span>' +
        '</button>';
    }
    html += '<button type="button" class="tp-card tp-surprise" data-id="surprise">' +
      '<span class="tp-swatch tp-swatch-surprise">✦</span>' +
      '<span class="tp-name">Surprise me</span>' +
      '<span class="tp-blurb">Let ShareOut pick a bold direction.</span>' +
      '</button></div>';
    wrap.innerHTML = html;
    frameBody.appendChild(wrap);

    var cards = wrap.querySelectorAll('.tp-card');
    for (var n = 0; n < cards.length; n++){
      (function(card){
        card.addEventListener('click', function(){
          if (state.busy) return;
          state.theme = card.getAttribute('data-id');
          var label = card.querySelector('.tp-name').textContent;
          wrap.remove();
          previewEmpty.hidden = false;
          textMsg('Love it — going with <b>' + esc(label) + '</b>. One sec…');
          handlePrompt(S.prompt);
        });
      })(cards[n]);
    }
  }

  // ---- Confirmation widget ----
  function confirmWidget(confirm){
    var card = document.createElement('div');
    card.className = 'confirm-card';
    card.innerHTML =
      '<button class="confirm-btn yes" type="button">' + esc(confirm.label || 'Confirm') + '</button>' +
      '<button class="confirm-btn no" type="button">Cancel</button>';
    var yes = card.querySelector('.yes');
    var no = card.querySelector('.no');
    yes.addEventListener('click', function(){
      if (state.busy) return;
      card.classList.add('resolved');
      yes.disabled = true; no.disabled = true;
      proceedBuild(confirm.prompt || '');
    });
    no.addEventListener('click', function(){
      card.classList.add('resolved');
      yes.disabled = true; no.disabled = true;
      textMsg('No problem — I left it as it is.');
    });
    bodyEl.appendChild(card); scrollDown();
  }

  // ---- Result card ----
  function resultCard(d){
    var editUrl = '/a/' + encodeURIComponent(d.slug) + '/edit';
    var host = (d.url || '').replace(/^https?:\\/\\//, '');
    var caps = '';
    if (d.capabilities && d.capabilities.length){
      caps = '<div class="caps">';
      for (var i = 0; i < d.capabilities.length; i++){ caps += '<span class="cap">' + esc(d.capabilities[i]) + '</span>'; }
      caps += '</div>';
    }
    var card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML =
      '<div class="result-top"><span class="result-live"><span class="live-dot"></span>Live</span><span class="result-url">' + esc(host) + '</span></div>' +
      caps +
      '<div class="result-actions">' +
        '<a class="act primary" href="' + esc(d.url) + '" target="_blank" rel="noopener">Open live ↗</a>' +
        '<a class="act" href="' + esc(editUrl) + '" target="_blank" rel="noopener">Open in editor</a>' +
        '<button class="act copy" type="button">Copy link</button>' +
      '</div>';
    var copy = card.querySelector('.copy');
    copy.addEventListener('click', function(){
      if (navigator.clipboard && d.url){ navigator.clipboard.writeText(d.url); }
      var prev = copy.textContent; copy.textContent = 'Copied!'; setTimeout(function(){ copy.textContent = prev; }, 1400);
    });
    bodyEl.appendChild(card); scrollDown();
  }

  function showPreview(html, url, slug){
    skeleton.hidden = true;
    previewEmpty.hidden = true;
    frame.srcdoc = html;
    frame.hidden = false;
    codeView.textContent = html;
    state.slug = slug; state.html = html; state.url = url;
    urlBar.innerHTML = ${jsString(platformHost)} + '/<b>' + esc(slug) + '</b>';
  }

  function enableInput(){
    input.disabled = false;
    input.placeholder = 'Ask for changes…';
    input.focus();
  }

  // ---- Live streaming generation: render the page into the iframe as tokens arrive ----
  // Resolves with the final 'done' event; rejects with a parsed JSON error body (e.g. rate limit).
  function streamGenerate(phase, prompt, onDelta){
    state.busy = true;
    skeleton.hidden = false;
    previewEmpty.hidden = true;
    var full = '';
    var lastFlush = 0;
    var firstByte = false;
    function flush(){
      lastFlush = Date.now();
      if (!firstByte){ firstByte = true; skeleton.hidden = true; frame.hidden = false; }
      frame.srcdoc = full;
      codeView.textContent = full;
    }
    function schedule(){ if (Date.now() - lastFlush > 240){ flush(); } }

    return fetch('/v1/create/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: phase, prompt: prompt, slug: state.slug || undefined, html: state.html || undefined, theme: state.theme || undefined })
    }).then(function(resp){
      // A non-streaming JSON response means an error/limit before generation started.
      var ct = resp.headers.get('Content-Type') || '';
      if (!resp.ok || !resp.body || ct.indexOf('text/event-stream') < 0){
        return resp.json().catch(function(){ return { error: 'Something went wrong — try again.' }; })
          .then(function(d){ throw d; });
      }
      // chat-core decodes/splits/parses the SSE records; we own the event semantics.
      var it = window.ChatCore.readSSE(resp);
      var result = null;
      function pump(){
        return it.next().then(function(r){
          if (r.done){ return result; }
          var evt = r.value;
          if (evt.type === 'delta'){ full += evt.text; if (onDelta) onDelta(); schedule(); }
          else if (evt.type === 'done'){ flush(); result = evt; }
          else if (evt.type === 'error'){ throw { error: evt.error }; }
          return pump();
        });
      }
      return pump();
    });
  }

  // ---- Build phase (authed): stream live, publish server-side, then show the result ----
  function runBuild(prompt){
    if (state.busy) return;
    var widget = buildingWidget();
    streamGenerate('build', prompt).then(function(evt){
      state.busy = false;
      if (!evt){ stopBuilding(widget); textMsg('Something went wrong — try again.'); return; }
      finishBuilding(widget);
      showPreview(evt.html, evt.url, evt.slug);
      resultCard(evt);
    }).catch(function(d){
      state.busy = false; skeleton.hidden = true; stopBuilding(widget);
      if (d && d.code === 'UNAUTHENTICATED'){ askAuth(); return; }
      textMsg(esc((d && d.error) || 'Network hiccup reaching the builder — try again.'));
    });
  }

  // ---- Preview phase (anonymous): stream it live so they SEE it, gate the account after ----
  function showPreviewOnly(html){
    skeleton.hidden = true;
    previewEmpty.hidden = true;
    frame.srcdoc = html;
    frame.hidden = false;
    codeView.textContent = html;
    state.html = html;
    urlBar.innerHTML = ${jsString(platformHost)} + '/<b>your-project</b>';
  }

  function runPreview(prompt){
    if (state.busy) return;
    var widget = buildingWidget('Building a live preview — no account needed.');
    streamGenerate('preview', prompt).then(function(evt){
      state.busy = false;
      if (!evt){ stopBuilding(widget); textMsg('I couldn’t build that — try rephrasing.'); return; }
      finishBuilding(widget);
      state.previewHtml = evt.html;
      showPreviewOnly(evt.html);
      textMsg('Here’s your page ✨ Like it? Create a free account to save it, make it live, and keep editing.');
      askAuth();
    }).catch(function(d){
      state.busy = false; skeleton.hidden = true; stopBuilding(widget);
      textMsg(esc((d && d.error) || 'I couldn’t build that — try rephrasing.'));
      if (d && d.code === 'PREVIEW_LIMIT'){ askAuth(); }
    });
  }

  // After sign-up: publish the EXACT page they previewed — no regeneration.
  function publishPreview(){
    if (state.busy || !state.previewHtml) return;
    state.busy = true;
    skeleton.hidden = false;
    var widget = buildingWidget('Publishing your page live…');
    fetch('/v1/create/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'publish', prompt: S.prompt, html: state.previewHtml })
    }).then(function(r){ return r.json(); }).then(function(d){
      state.busy = false;
      skeleton.hidden = true;
      if (!d || !d.ok){ stopBuilding(widget); textMsg(esc((d && d.error) || 'Publishing failed — try again.')); return; }
      finishBuilding(widget);
      state.previewHtml = null;
      showPreview(d.html, d.url, d.slug);
      resultCard(d);
      suggestionsWidget(d.suggestions);
    }).catch(function(){
      state.busy = false; skeleton.hidden = true; stopBuilding(widget);
      textMsg('Network hiccup — try again.');
    });
  }

  // ---- Plan phase: route to reply / confirm / build ----
  function handlePrompt(prompt){
    if (state.busy) return;
    state.busy = true;
    var think = thinkingWidget();
    fetch('/v1/create/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'plan', prompt: prompt, slug: state.slug || undefined, html: state.html || undefined, theme: state.theme || undefined })
    }).then(function(r){ return r.json(); }).then(function(d){
      state.busy = false;
      think.remove();
      if (!d || !d.ok){ textMsg(esc((d && d.error) || 'Something went wrong — try again.')); return; }
      if (d.type === 'clarify'){
        if (d.message) textMsg(esc(d.message));
        clarifyWidget(d.questions || [], prompt);
      } else if (d.type === 'confirm'){
        if (d.message) textMsg(esc(d.message));
        confirmWidget(d.confirm || {});
        suggestionsWidget(d.suggestions);
      } else if (d.type === 'reply'){
        if (d.message) textMsg(esc(d.message));
        suggestionsWidget(d.suggestions);
      } else {
        if (d.message) textMsg(esc(d.message));
        proceedBuild(prompt);
      }
    }).catch(function(){
      state.busy = false; think.remove();
      textMsg('Network hiccup — try again.');
    });
  }

  function onAuthed(email){
    if (state.authed) return;
    state.authed = true;
    creator.classList.remove('gate');
    textMsg('You’re in' + (email ? ', <b>' + esc(email) + '</b>' : '') + ' 🎉');
    enableInput();
    // Publish what they already previewed; only regenerate if there's no preview.
    if (state.previewHtml){ publishPreview(); } else { handlePrompt(S.prompt); }
  }

  // ---- In-chat sign-up (CRO) ----
  function openGoogle(statusEl){
    var redirect = '/create?prompt=' + encodeURIComponent(S.prompt);
    var w = window.open('/auth/login?redirect=' + encodeURIComponent(redirect), 'so_auth', 'width=480,height=640');
    if (statusEl){ statusEl.className = 'auth-status'; statusEl.textContent = 'Opening Google…'; }
    var poll = setInterval(function(){
      fetch('/v1/auth/session', { headers: { 'Accept': 'application/json' } })
        .then(function(r){ return r.json(); })
        .then(function(d){ if (d && d.user){ clearInterval(poll); try { w && w.close(); } catch (e) {} onAuthed(d.user.email); } })
        .catch(function(){});
    }, 1500);
    setTimeout(function(){ clearInterval(poll); }, 180000);
  }

  function askAuth(){
    var card = document.createElement('div');
    card.className = 'auth-card';
    card.innerHTML =
      '<div class="auth-title">Save &amp; publish your page</div>' +
      '<div class="auth-sub">Free account · live in seconds · no credit card.</div>' +
      '<button class="g-btn" id="googleBtn" type="button">' + GOOGLE_SVG + 'Continue with Google</button>' +
      '<div class="auth-or">or</div>' +
      '<div class="field" id="emailRow">' +
        '<input id="emailInput" type="email" autocomplete="email" placeholder="you@email.com">' +
        '<button class="icon-btn" id="emailBtn" type="button" aria-label="Continue">' + ARROW_SVG + '</button>' +
      '</div>' +
      (TS_KEY ? '<div id="tsHost" style="margin:8px 0"></div>' : '') +
      '<div class="field" id="codeRow" hidden>' +
        '<input id="codeInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code">' +
        '<button class="icon-btn" id="codeBtn" type="button" aria-label="Verify">' + CHECK_SVG + '</button>' +
      '</div>' +
      '<button class="auth-link" id="resendBtn" type="button" hidden>Resend code</button>' +
      '<div class="auth-status" id="authStatus"></div>' +
      '<div class="trust">' +
        '<span>' + CHECK_SVG + 'Free forever</span>' +
        '<span>' + CHECK_SVG + 'No credit card</span>' +
        '<span>' + CHECK_SVG + 'Private by default</span>' +
      '</div>';
    bodyEl.appendChild(card);
    scrollDown();

    // Turnstile (anti-Sybil): explicit-render into the dynamically-built card.
    var tsHost = card.querySelector('#tsHost');
    function renderTs(){
      if (!TS_KEY || !tsHost || tsHost.dataset.rendered || !window.turnstile) return;
      try { window.turnstile.render(tsHost, { sitekey: TS_KEY, action: 'turnstile-spin-v1' }); tsHost.dataset.rendered = '1'; } catch (e) {}
    }
    if (TS_KEY && tsHost) {
      renderTs();
      if (!tsHost.dataset.rendered) {
        var tsPoll = setInterval(function(){ renderTs(); if (tsHost.dataset.rendered) clearInterval(tsPoll); }, 300);
        setTimeout(function(){ clearInterval(tsPoll); }, 10000);
      }
    }

    var emailRow = card.querySelector('#emailRow');
    var emailInput = card.querySelector('#emailInput');
    var emailBtn = card.querySelector('#emailBtn');
    var codeRow = card.querySelector('#codeRow');
    var codeInput = card.querySelector('#codeInput');
    var codeBtn = card.querySelector('#codeBtn');
    var resendBtn = card.querySelector('#resendBtn');
    var googleBtn = card.querySelector('#googleBtn');
    var status = card.querySelector('#authStatus');
    var pendingEmail = '';

    function setStatus(msg, kind){ status.className = 'auth-status' + (kind ? ' ' + kind : ''); status.textContent = msg || ''; }

    function startEmail(){
      var email = (emailInput.value || '').trim();
      if (!email){ setStatus('Enter your email to continue.', 'err'); return; }
      emailBtn.disabled = true; setStatus('Sending your code…');
      var tsToken = (TS_KEY && tsHost && window.turnstile) ? window.turnstile.getResponse(tsHost) : undefined;
      fetch('/v1/auth/email/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, turnstileToken: tsToken })
      }).then(function(r){ return r.json(); }).then(function(d){
        emailBtn.disabled = false;
        if (!d || !d.ok){ setStatus((d && d.error) || 'Couldn’t send a code. Try again.', 'err'); return; }
        pendingEmail = email;
        setStatus('');
        textMsg('Sent a 6-digit code to <b>' + esc(email) + '</b> 📧 — pop it in below.');
        emailRow.hidden = true;
        codeRow.hidden = false;
        resendBtn.hidden = false;
        codeInput.focus();
      }).catch(function(){ emailBtn.disabled = false; setStatus('Network error — try again.', 'err'); });
    }

    function verifyCode(){
      var code = (codeInput.value || '').trim();
      if (!/^[0-9]{6}$/.test(code)){ setStatus('Enter the 6-digit code.', 'err'); return; }
      codeBtn.disabled = true; setStatus('Verifying…');
      fetch('/v1/auth/email/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code: code })
      }).then(function(r){ return r.json(); }).then(function(d){
        codeBtn.disabled = false;
        if (!d || !d.ok){ setStatus((d && d.error) || 'That didn’t work. Try again.', 'err'); return; }
        setStatus('Verified', 'ok');
        onAuthed((d.user && d.user.email) || pendingEmail);
      }).catch(function(){ codeBtn.disabled = false; setStatus('Network error — try again.', 'err'); });
    }

    emailBtn.addEventListener('click', startEmail);
    emailInput.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); startEmail(); } });
    codeBtn.addEventListener('click', verifyCode);
    codeInput.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); verifyCode(); } });
    resendBtn.addEventListener('click', function(){ if (pendingEmail){ emailInput.value = pendingEmail; startEmail(); } });
    googleBtn.addEventListener('click', function(){ openGoogle(status); });
    emailInput.focus();
  }

  // ---- Follow-up chat (real) ----
  window.ChatCore.wireComposer({
    input: input,
    button: sendBtn,
    guard: function(){ return !input.disabled && !state.busy; },
    onSubmit: function(text){ userMsg(text); handlePrompt(text); }
  });

  // ---- Preview/Code tabs ----
  var tabs = document.querySelectorAll('.tab2');
  for (var t = 0; t < tabs.length; t++){
    (function(tab){
      tab.addEventListener('click', function(){
        for (var k = 0; k < tabs.length; k++){ tabs[k].classList.remove('active'); }
        tab.classList.add('active');
        var code = tab.getAttribute('data-tab') === 'code';
        if (!frame.hidden || !codeView.hidden){ frame.hidden = code; codeView.hidden = !code; }
      });
    })(tabs[t]);
  }

  // ---- Share (copy link) ----
  shareBtn.addEventListener('click', function(){
    if (!state.url) return;
    if (navigator.clipboard){ navigator.clipboard.writeText(state.url); }
    var prev = shareBtn.textContent; shareBtn.textContent = 'Copied!';
    setTimeout(function(){ shareBtn.textContent = prev; }, 1400);
  });

  // ---- Kickoff ----
  // Pick a starting look first, then the agent asks 1-2 quick questions and builds.
  showThemePicker();
})();`;

  return renderHtmlPage({
    title: 'Building with ShareOut',
    description: 'Watch your idea come to life — ShareOut builds it for you in real time.',
    pageStyles: createPageStyles,
    body,
    scripts,
    extraHead: turnstileSiteKey
      ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
      : '',
  });
}
