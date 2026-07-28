/** Edit-Lite inline editing. */
import { colors } from '@shareout/design-tokens';

const EDIT_PLACEHOLDER_STYLE = `font:400 14px/1.5 system-ui,sans-serif;color:${colors.textTertiary};padding:24px;text-align:center`;

export const workspace_client_edit_lite_JS = `  // ===== Edit-Lite: single-player inline text editing =====
  var TEXT_SEL = 'p,h1,h2,h3,h4,h5,h6,span,a,li,td,th,label,button';
  var EDIT_CSS = '<style data-wsx-edit="1">'
    + '[data-wsx-hover]{outline:1.5px dashed color-mix(in srgb, ${colors.primary} 33%, transparent);outline-offset:2px;cursor:text}'
    + '[contenteditable="true"]{outline:2px solid ${colors.primary};outline-offset:2px;border-radius:2px}'
    + '*{caret-color:${colors.primary}}</style>';
  // ---- source-mapped model: render scripts-ON for fidelity (charts/JS render like View),
  // but edits target a separate stamped SOURCE doc — that's what we save (never the live
  // DOM). Only authored (data-wsx-id) elements are editable; JS-generated nodes are read-only.
  function stampTree(doc, n) {
    var els = doc.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var t = els[i].tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'HEAD' || t === 'META' || t === 'LINK' || t === 'TITLE' || t === 'BASE' || t === 'HTML' || t === 'BODY') continue;
      if (!els[i].getAttribute('data-wsx-id')) els[i].setAttribute('data-wsx-id', String(n++));
    }
    return n;
  }
  function stampFresh(rec, node) {
    if (node.setAttribute) node.setAttribute('data-wsx-id', String(rec.idCounter++));
    if (node.querySelectorAll) node.querySelectorAll('*').forEach(function (el) { var t = el.tagName; if (t === 'SCRIPT' || t === 'STYLE') return; el.setAttribute('data-wsx-id', String(rec.idCounter++)); });
  }
  function srcOf(rec, liveEl) {
    var id = liveEl && liveEl.getAttribute && liveEl.getAttribute('data-wsx-id');
    return (id != null && rec.srcDoc) ? rec.srcDoc.querySelector('[data-wsx-id="' + id + '"]') : null;
  }
  function syncLiveToSource(rec, liveEl) {
    var s = srcOf(rec, liveEl); if (!s) return;
    if (liveEl.hasAttribute('style')) s.setAttribute('style', liveEl.getAttribute('style')); else s.removeAttribute('style');
    ['src', 'href', 'alt', 'target'].forEach(function (a) { if (liveEl.hasAttribute(a)) s.setAttribute(a, liveEl.getAttribute(a)); else s.removeAttribute(a); });
    s.innerHTML = liveEl.innerHTML;
  }
  function renderLive(rec) {
    if (!rec.srcDoc) return;
    var html = injectEditBase('<!DOCTYPE html>' + rec.srcDoc.documentElement.outerHTML, rec.art.slug);
    rec.editframe.onload = function () { rec.editframe.onload = null; wireEditDoc(rec); };
    rec.editframe.srcdoc = html;
  }
  function reselectById(rec, id) {
    if (id == null) { setSel(rec, null); return; }
    var doc = rec.editframe.contentDocument; var el = doc && doc.querySelector('[data-wsx-id="' + id + '"]');
    if (el) setSel(rec, { type: el.tagName === 'IMG' ? 'img' : (el.tagName === 'A' ? 'link' : 'text'), el: el }); else setSel(rec, null);
  }
  function setModeButtons(rec) {
    syncTabMode();
    rec.pane.classList.toggle('is-editing', rec.mode === 'edit');
    rec.publishBtn.hidden = rec.mode !== 'edit';
    rec.fullEdit.hidden = rec.mode !== 'edit';
    rec.undoBtn.hidden = rec.mode !== 'edit';
    rec.redoBtn.hidden = rec.mode !== 'edit';
    rec.mobileBtn.hidden = rec.mode !== 'edit';
    rec.discardBtn.hidden = rec.mode !== 'edit';
    if (rec.mode === 'edit') updateUndoButtons(rec); else { rec.sel = null; }
  }
  function setSaveStatus(rec, text, cls) { rec.savestat.textContent = text || ''; rec.savestat.className = 'wsx__savestat js-savestat' + (cls ? ' ' + cls : ''); }
  function setEditMode(rec, mode) {
    if (rec.mode === mode) return;
    rec.mode = mode; setModeButtons(rec);
    if (mode === 'edit' && !rec.loaded) loadEditSource(rec);
    if (panes[activeKey] === rec) paintRail();
  }
  function loadEditSource(rec) {
    if (!rec.art.id) { rec.editframe.removeAttribute('srcdoc'); rec.editframe.srcdoc = '<div style="${EDIT_PLACEHOLDER_STYLE}">Open this page from your library to edit it.</div>'; rec.publishBtn.hidden = true; return; }
    setSaveStatus(rec, 'Loading\\u2026');
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 403) {
          rec.publishBtn.hidden = true; setSaveStatus(rec, '');
          return r.json().catch(function () { return {}; }).then(function (j) {
            var msg = (j && j.code === 'FEATURE_DISABLED')
              ? 'Live Studio editing is turned off for this workspace.'
              : 'You have view-only access \\u2014 ask an editor to grant you edit rights.';
            rec.editframe.srcdoc = '<div style="${EDIT_PLACEHOLDER_STYLE}">' + msg + '</div>';
            throw 'forbidden';
          });
        }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !d.editor) { setSaveStatus(rec, 'Could not load', 'warn'); return; }
        rec.baseUpdatedAt = d.editor.draftUpdatedAt || null;
        rec.loaded = true;
        rec.srcDoc = new DOMParser().parseFromString(d.editor.html || '<!DOCTYPE html><html><head></head><body></body></html>', 'text/html');
        rec.idCounter = stampTree(rec.srcDoc, 0);
        rec.history = []; rec.histIdx = -1; rec.pendingSel = null;
        renderLive(rec);
        setSaveStatus(rec, d.editor.hasDraft ? 'Editing your draft' : 'Ready to edit');
      })
      .catch(function (e) { if (e !== 'forbidden') setSaveStatus(rec, 'Could not load', 'warn'); });
  }
  // Inject base + edit CSS + (if missing) the SDK so scripts-on artifacts render with data.
  function injectEditBase(html, slug) {
    var add = '<base href="/a/' + slug + '/">' + EDIT_CSS;
    if (!/\\/sdk\\/shareout(\\.v1)?\\.js/.test(html)) add += '<script src="/sdk/shareout.js"><\\/script>';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1>' + add);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, '<html$1><head>' + add + '</head>');
    return '<head>' + add + '</head>' + html;
  }
  function wireTextEl(rec, el) {
    if (el.querySelector && el.querySelector(TEXT_SEL)) return; // leaf text only
    el.addEventListener('mouseenter', function () { if (el.getAttribute('contenteditable') !== 'true') el.setAttribute('data-wsx-hover', '1'); });
    el.addEventListener('mouseleave', function () { el.removeAttribute('data-wsx-hover'); });
    el.addEventListener('click', function (e) {
      if (el.tagName === 'A') { e.preventDefault(); setSel(rec, { type: 'link', el: el }); }
      else setSel(rec, { type: 'text', el: el });
      el.removeAttribute('data-wsx-hover'); el.setAttribute('contenteditable', 'true'); el.focus();
    });
    el.addEventListener('input', function () { markDirty(rec, el); });
    el.addEventListener('blur', function () { el.removeAttribute('contenteditable'); syncLiveToSource(rec, el); });
  }
  function wireImgEl(rec, img) {
    img.addEventListener('mouseenter', function () { img.setAttribute('data-wsx-hover', '1'); });
    img.addEventListener('mouseleave', function () { img.removeAttribute('data-wsx-hover'); });
    img.addEventListener('click', function (e) { e.preventDefault(); img.removeAttribute('data-wsx-hover'); setSel(rec, { type: 'img', el: img }); });
  }
  // Only AUTHORED elements (data-wsx-id) are editable; JS-generated nodes stay read-only.
  function wireSubtree(rec, root) {
    function consider(el) {
      if (!el.getAttribute || el.getAttribute('data-wsx-id') == null) return;
      if (el.matches(TEXT_SEL)) wireTextEl(rec, el);
      else if (el.matches('img')) wireImgEl(rec, el);
    }
    if (root.nodeType === 1) consider(root);
    if (root.querySelectorAll) root.querySelectorAll('[data-wsx-id]').forEach(consider);
  }
  function wireEditDoc(rec) {
    var doc = rec.editframe.contentDocument; if (!doc) { setSaveStatus(rec, 'Could not open editor', 'warn'); return; }
    if (!doc.body) return;
    wireSubtree(rec, doc.body);
    doc.body.addEventListener('click', function (e) { if (e.target === doc.body || e.target === doc.documentElement) setSel(rec, null); });
    doc.addEventListener('keydown', function (e) { editKeydown(rec, e); });
    if (rec.pendingSel !== undefined && rec.pendingSel !== null) { var id = rec.pendingSel; rec.pendingSel = null; reselectById(rec, id); }
    else if (rec.pendingSel === null) { rec.pendingSel = undefined; setSel(rec, null); }
    if (!rec.history.length) pushHistory(rec); // baseline on first render
  }
  function editKeydown(rec, e) {
    if (e.key === 'Escape') { var a = (rec.editframe.contentDocument || {}).activeElement; if (a && a.blur) a.blur(); setSel(rec, null); return; }
    var mod = e.metaKey || e.ctrlKey; if (!mod) return;
    var k = (e.key || '').toLowerCase();
    if (k === 's') { e.preventDefault(); publishEdit(rec); }
    else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(rec); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redoEdit(rec); }
  }
  // Structural ops mutate the SOURCE doc, then re-render the live preview (re-runs scripts).
  function duplicateSel(rec) {
    var s = srcOf(rec, rec.sel && rec.sel.el); if (!s || !s.parentNode) return;
    var c = s.cloneNode(true); stampFresh(rec, c);
    s.parentNode.insertBefore(c, s.nextSibling);
    rec.pendingSel = c.getAttribute('data-wsx-id'); markDirty(rec); renderLive(rec);
  }
  function deleteSel(rec) {
    var s = srcOf(rec, rec.sel && rec.sel.el); if (!s) return;
    s.remove(); rec.pendingSel = null; markDirty(rec); renderLive(rec);
  }
  function moveSel(rec, dir) {
    var s = srcOf(rec, rec.sel && rec.sel.el); if (!s || !s.parentNode) return;
    if (dir < 0) { var prev = s.previousElementSibling; if (prev) s.parentNode.insertBefore(s, prev); }
    else { var next = s.nextElementSibling; if (next) s.parentNode.insertBefore(next, s); }
    rec.pendingSel = s.getAttribute('data-wsx-id'); markDirty(rec); renderLive(rec);
  }
  function convertTag(rec, liveEl, tag) {
    var s = srcOf(rec, liveEl); if (!s || !s.parentNode || s.tagName.toLowerCase() === tag) return;
    var n = rec.srcDoc.createElement(tag);
    n.innerHTML = s.innerHTML;
    if (s.getAttribute('style')) n.setAttribute('style', s.getAttribute('style'));
    n.setAttribute('data-wsx-id', s.getAttribute('data-wsx-id'));
    s.parentNode.replaceChild(n, s);
    rec.pendingSel = n.getAttribute('data-wsx-id'); markDirty(rec); renderLive(rec);
  }
  // ----- AI on selection (reuses the editor's /editor/chat/normal contract) -----
  var AI_PRESET = {
    rewrite: 'Rewrite the selected text to be clearer and more engaging. Keep the same meaning.',
    shorten: 'Make the selected text shorter and punchier without losing the key point.',
    grammar: 'Fix spelling and grammar in the selected text. Keep the wording and tone.',
  };
  function aiSectionHtml() {
    return '<div class="wsx-edit__ai">'
      + '<div class="lbl">\\u2728 Ask AI</div>'
      + '<div class="wsx-edit__aibtns"><button data-ai="rewrite" type="button">Rewrite</button><button data-ai="shorten" type="button">Shorten</button><button data-ai="grammar" type="button">Fix grammar</button><button data-ai="translate" type="button">Translate</button></div>'
      + '<div class="wsx-edit__airow"><input id="wsxAiPrompt" placeholder="Tell AI what to change\\u2026"><button class="wsx-edit__btn" id="wsxAiGo" type="button">Go</button></div>'
      + '<div class="wsx-edit__aistat" id="wsxAiStat"></div></div>';
  }
  function wireAi(rec, el) {
    rbodyEl.querySelectorAll('[data-ai]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-ai');
        if (k === 'translate') { var lang = window.prompt('Translate to which language?', 'Spanish'); if (!lang) return; aiAssist(rec, el, 'Translate the selected text to ' + lang + '. Keep its formatting.'); return; }
        aiAssist(rec, el, AI_PRESET[k]);
      });
    });
    var inp = document.getElementById('wsxAiPrompt'), go = document.getElementById('wsxAiGo');
    function run() { var v = inp.value.trim(); if (v) aiAssist(rec, el, v); }
    go.addEventListener('click', run);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  }
  var aiBusy = false;
  function aiSetEnabled(on) { rbodyEl.querySelectorAll('[data-ai], #wsxAiGo').forEach(function (b) { try { b.disabled = !on; } catch (e) {} }); }
  function aiAssist(rec, el, instruction) {
    if (aiBusy) return;
    if (!rec.srcDoc || !rec.art.id) return;
    var src = srcOf(rec, el); if (!src) return;
    aiBusy = true; aiSetEnabled(false);
    var stat = document.getElementById('wsxAiStat'); if (stat) stat.textContent = '\\u2728 Working\\u2026';
    var hadId = !!src.id; if (!src.id) src.id = 'wsxAiTarget';
    var selector = '#' + src.id, meta = metaCache[rec.art.id] || {};
    var body = { prompt: 'Only modify the selected element. ' + instruction, context: {
      documentHtml: rec.srcDoc.documentElement.outerHTML,
      artifact: { id: rec.art.id, name: rec.art.name || meta.name || 'Page', slug: rec.art.slug, description: meta.description || '' },
      selection: { selector: selector, tagName: src.tagName.toLowerCase(), id: src.id, classes: [].slice.call(src.classList), textPreview: (src.textContent || '').slice(0, 200) },
      selectedElements: [selector], htmlMode: 'full'
    } };
    function finish(msg) { aiBusy = false; var t = rec.srcDoc.getElementById('wsxAiTarget'); if (t && !hadId) t.removeAttribute('id'); if (msg) toast(msg); }
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/chat/normal', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (resp) {
        if (!resp.ok || !resp.body) { if (stat) stat.textContent = 'AI editing isn\\u2019t available for this page.'; aiBusy = false; aiSetEnabled(true); return; }
        var applied = false, message = '';
        return readStream(resp, function (ev) {
          if (ev.type === 'done') {
            applyAi(rec, ev.response); applied = true; message = (ev.response && ev.response.message) || '';
            if (ev.changeId) fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/chat/apply', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeId: ev.changeId }) }).catch(function () {});
          } else if (ev.type === 'error') { if (stat) stat.textContent = ev.message || 'AI couldn\\u2019t do that.'; }
        }).then(function () { if (applied) { rec.pendingSel = null; markDirty(rec); pushHistory(rec); renderLive(rec); } finish(applied ? (message || 'Applied \\u2728') : ''); });
      })
      .catch(function () { aiBusy = false; aiSetEnabled(true); if (stat) stat.textContent = 'Connection dropped.'; });
  }
  // AI edits apply to the SOURCE doc; aiAssist re-renders the live preview after.
  function applyAi(rec, resp) {
    var sdoc = rec.srcDoc; if (!sdoc || !resp) return;
    if (resp.html) {
      try { var parsed = new DOMParser().parseFromString(resp.html, 'text/html'); if (parsed.body) sdoc.body.innerHTML = parsed.body.innerHTML; } catch (e) {}
    } else if (resp.patches && resp.patches.length) {
      resp.patches.forEach(function (p) {
        var t = null; try { t = sdoc.querySelector(p.selector); } catch (e) {}
        if (!t) t = sdoc.getElementById('wsxAiTarget');
        if (!t) return;
        try {
          if (p.action === 'replace') t.outerHTML = p.content || '';
          else if (p.action === 'insert') t.insertAdjacentHTML('beforeend', p.content || '');
          else if (p.action === 'delete') t.remove();
          else if (p.action === 'setAttribute') t.setAttribute(p.attribute, p.value);
          else if (p.action === 'setStyle') t.style[p.attribute] = p.value;
        } catch (e) {}
      });
    }
    var tgt = sdoc.getElementById('wsxAiTarget'); if (tgt) tgt.removeAttribute('id');
    rec.idCounter = stampTree(sdoc, rec.idCounter || 0); // stamp any AI-added nodes
  }
  var INSERT_MAP = { p: '<p>New text</p>', h2: '<h2>New heading</h2>', img: '<img alt="" style="max-width:100%">', button: '<button>Button</button>', hr: '<hr>' };
  function insertBlock(rec, kind) {
    if (!rec.srcDoc) return;
    var tmp = rec.srcDoc.createElement('div'); tmp.innerHTML = INSERT_MAP[kind] || ''; var node = tmp.firstElementChild; if (!node) return;
    stampFresh(rec, node);
    var ref = srcOf(rec, rec.sel && rec.sel.el);
    if (ref && ref.parentNode) ref.parentNode.insertBefore(node, ref.nextSibling); else rec.srcDoc.body.appendChild(node);
    rec.pendingSel = (kind === 'hr') ? null : node.getAttribute('data-wsx-id');
    markDirty(rec); renderLive(rec);
  }
  var INSERT_SECTION = '<div class="wsx-edit__sec"><div class="lbl" data-inslbl>Insert below</div><div class="wsx-edit__palette">'
    + '<button data-ins="p" type="button">+ Text</button><button data-ins="h2" type="button">+ Heading</button>'
    + '<button data-ins="img" type="button">+ Image</button><button data-ins="button" type="button">+ Button</button>'
    + '<button data-ins="hr" type="button">+ Divider</button></div></div>';
  function wireInsert(rec) { rbodyEl.querySelectorAll('[data-ins]').forEach(function (b) { b.addEventListener('click', function () { insertBlock(rec, b.getAttribute('data-ins')); }); }); }
  function boxSectionHtml(includeAlign) {
    return '<div class="wsx-edit__sec"><div class="lbl">Background</div><div class="wsx-edit__inrow"><input type="color" id="wsxBg" title="Background color"><button class="wsx-edit__btn" id="wsxBgClear" type="button">Clear</button></div></div>'
      + '<div class="wsx-edit__sec"><div class="lbl">Padding</div><select class="wsx-edit__sel" id="wsxPad"><option value="">Default</option><option value="4px">XS</option><option value="8px">S</option><option value="16px">M</option><option value="24px">L</option><option value="40px">XL</option></select></div>'
      + (includeAlign ? '<div class="wsx-edit__sec"><div class="lbl">Align</div><div class="wsx-edit__fmt"><button data-al="left" title="Left" type="button">\\u2190</button><button data-al="center" title="Center" type="button">\\u2194</button><button data-al="right" title="Right" type="button">\\u2192</button></div></div>' : '');
  }
  function wireBox(rec, el, includeAlign) {
    var bg = document.getElementById('wsxBg');
    try { bg.value = rgbToHex(rec.editframe.contentWindow.getComputedStyle(el).backgroundColor) || '#ffffff'; } catch (e) { bg.value = '#ffffff'; }
    bg.addEventListener('input', function () { el.style.backgroundColor = bg.value; markDirty(rec, el); });
    document.getElementById('wsxBgClear').addEventListener('click', function () { el.style.backgroundColor = ''; markDirty(rec, el); });
    var pad = document.getElementById('wsxPad'); pad.value = el.style.padding || '';
    pad.addEventListener('change', function () { el.style.padding = pad.value; markDirty(rec, el); });
    if (includeAlign) rbodyEl.querySelectorAll('[data-al]').forEach(function (b) { b.addEventListener('mousedown', function (e) { e.preventDefault(); }); b.addEventListener('click', function () { el.style.textAlign = b.getAttribute('data-al'); markDirty(rec, el); }); });
  }
  // Selection drives the right-rail Edit panel (the "editing sidebar").
  function setSel(rec, sel) { rec.sel = sel; if (panes[activeKey] === rec && rec.mode === 'edit') renderEditPanel(rec); }
  function renderEditPanel(rec) {
    var sel = rec.sel;
    if (!sel) {
      rbodyEl.innerHTML = '<div class="wsx-edit"><div class="wsx-edit__hint">Click any <b>text</b>, <b>image</b> or <b>link</b> on the page to edit it \\u2014 or add a block below. Edits autosave to a private draft; hit <b>Publish</b> (top) to go live.</div>'
        + INSERT_SECTION.replace('Insert below', 'Add to the page') + '</div>';
      wireInsert(rec);
      return;
    }
    if (sel.type === 'img') return editPanelImg(rec, sel.el);
    if (sel.type === 'link') return editPanelLink(rec, sel.el);
    return editPanelText(rec, sel.el);
  }
  var EDIT_ACTIONS = '<div class="wsx-edit__sec"><div class="lbl">Element</div><div class="wsx-edit__inrow">'
    + '<button class="wsx-edit__btn sq" data-eact="up" title="Move up" type="button">\\u2191</button>'
    + '<button class="wsx-edit__btn sq" data-eact="down" title="Move down" type="button">\\u2193</button>'
    + '<button class="wsx-edit__btn" data-eact="dup" type="button">Duplicate</button>'
    + '<button class="wsx-edit__btn danger" data-eact="del" type="button">Delete</button></div></div>';
  function wireEditActions(rec) {
    var bk = rbodyEl.querySelector('[data-eback]'); if (bk) bk.addEventListener('click', function () { setSel(rec, null); });
    var up = rbodyEl.querySelector('[data-eact="up"]'); if (up) up.addEventListener('click', function () { moveSel(rec, -1); });
    var dn = rbodyEl.querySelector('[data-eact="down"]'); if (dn) dn.addEventListener('click', function () { moveSel(rec, 1); });
    var d = rbodyEl.querySelector('[data-eact="dup"]'); if (d) d.addEventListener('click', function () { duplicateSel(rec); });
    var x = rbodyEl.querySelector('[data-eact="del"]'); if (x) x.addEventListener('click', function () { deleteSel(rec); });
  }
  function rgbToHex(c) {
    var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c || ''); if (!m) return '';
    function h(n) { n = parseInt(n, 10).toString(16); return n.length < 2 ? '0' + n : n; }
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }
  function editHeader(label, tag) {
    return '<div class="wsx-edit__hdr"><button class="wsx-edit__back" data-eback type="button" title="Deselect">' + isvg('<path d="M15 18l-6-6 6-6"/>') + '</button>'
      + '<div class="wsx-edit__type">' + esc(label) + (tag ? ' <span class="wsx-edit__tag">' + esc(tag) + '</span>' : '') + '</div></div>';
  }
  function editPanelText(rec, el) {
    rbodyEl.innerHTML = '<div class="wsx-edit">'
      + editHeader('Text', el.tagName.toLowerCase())
      + '<div class="wsx-edit__sec"><div class="lbl">Format</div><div class="wsx-edit__fmt">'
        + '<button data-fmt="bold" type="button" title="Bold"><b>B</b></button>'
        + '<button data-fmt="italic" type="button" title="Italic"><i>I</i></button>'
        + '<button data-fmt="underline" type="button" title="Underline"><u>U</u></button>'
        + '<button data-fmt="strikeThrough" type="button" title="Strikethrough"><s>S</s></button>'
        + '<button data-fmt="__link" type="button" title="Make a link">' + isvg('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>') + '</button>'
        + '<button data-fmt="removeFormat" type="button" title="Clear formatting">\\u2715</button>'
        + '</div></div>'
      + '<div class="wsx-edit__sec"><div class="lbl">Block</div><select class="wsx-edit__sel" id="wsxConv"><option value="">Convert to\\u2026</option><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></select></div>'
      + '<div class="wsx-edit__sec"><div class="lbl">Color &amp; size</div><div class="wsx-edit__inrow"><input type="color" id="wsxTxtColor" title="Text color"><select class="wsx-edit__sel" id="wsxTxtSize"><option value="">Default size</option><option value="0.85em">Small</option><option value="1em">Normal</option><option value="1.25em">Large</option><option value="1.6em">X-Large</option></select></div></div>'
      + '<div class="wsx-edit__hint">Type on the page to change the words. Select text first, then format it.</div>'
      + aiSectionHtml()
      + boxSectionHtml(true) + INSERT_SECTION + EDIT_ACTIONS + '</div>';
    rbodyEl.querySelectorAll('[data-fmt]').forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        var cmd = b.getAttribute('data-fmt');
        try {
          if (cmd === '__link') { var u = window.prompt('Link URL', 'https://'); if (u) rec.editframe.contentDocument.execCommand('createLink', false, u); else return; }
          else rec.editframe.contentDocument.execCommand(cmd, false, null);
          markDirty(rec, el);
        } catch (e) {}
      });
    });
    var conv = document.getElementById('wsxConv');
    conv.addEventListener('change', function () { if (conv.value) convertTag(rec, el, conv.value); });
    var color = document.getElementById('wsxTxtColor');
    try { color.value = rgbToHex(rec.editframe.contentWindow.getComputedStyle(el).color) || '#000000'; } catch (e) { color.value = '#000000'; }
    color.addEventListener('input', function () { el.style.color = color.value; markDirty(rec, el); });
    var size = document.getElementById('wsxTxtSize'); size.value = el.style.fontSize || '';
    size.addEventListener('change', function () { el.style.fontSize = size.value; markDirty(rec, el); });
    wireAi(rec, el); wireBox(rec, el, true); wireInsert(rec); wireEditActions(rec);
  }
  function editPanelLink(rec, a) {
    var blank = a.getAttribute('target') === '_blank';
    rbodyEl.innerHTML = '<div class="wsx-edit">'
      + editHeader('Link', '')
      + '<div class="wsx-edit__sec"><div class="lbl">URL</div><div class="wsx-edit__inrow"><input type="url" id="wsxLinkHref" placeholder="https://\\u2026"><button class="wsx-edit__btn" id="wsxLinkApply" type="button">Apply</button></div></div>'
      + '<label class="wsx-edit__check"><input type="checkbox" id="wsxLinkBlank"' + (blank ? ' checked' : '') + '> Open in a new tab</label>'
      + '<div class="wsx-edit__hint">Type on the page to edit the link text.</div>'
      + boxSectionHtml(false) + INSERT_SECTION + EDIT_ACTIONS + '</div>';
    var inp = document.getElementById('wsxLinkHref'); inp.value = a.getAttribute('href') || '';
    function apply() { a.setAttribute('href', inp.value.trim()); markDirty(rec, a); }
    document.getElementById('wsxLinkApply').addEventListener('click', apply);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    document.getElementById('wsxLinkBlank').addEventListener('change', function (e) { if (e.target.checked) a.setAttribute('target', '_blank'); else a.removeAttribute('target'); markDirty(rec, a); });
    wireBox(rec, a, false); wireInsert(rec); wireEditActions(rec);
  }
  function editPanelImg(rec, img) {
    rbodyEl.innerHTML = '<div class="wsx-edit">'
      + editHeader('Image', '')
      + '<img class="wsx-edit__thumb" src="' + esc(img.getAttribute('src') || '') + '" alt="">'
      + '<div class="wsx-edit__sec"><div class="lbl">Source URL</div><div class="wsx-edit__inrow"><input type="url" id="wsxImgSrc" placeholder="Image URL\\u2026"><button class="wsx-edit__btn" id="wsxImgRep" type="button">Set</button></div></div>'
      + '<button class="wsx-edit__btn full" id="wsxImgUp" type="button">Upload an image\\u2026</button>'
      + '<div class="wsx-edit__sec"><div class="lbl">Alt text</div><input type="text" id="wsxImgAlt" placeholder="Describe the image"></div>'
      + boxSectionHtml(false) + INSERT_SECTION + EDIT_ACTIONS + '</div>';
    var srcEl = document.getElementById('wsxImgSrc'); srcEl.value = img.getAttribute('src') || '';
    var thumb = rbodyEl.querySelector('.wsx-edit__thumb');
    function setSrc(v) { img.setAttribute('src', v); thumb.src = v; markDirty(rec, img); }
    document.getElementById('wsxImgRep').addEventListener('click', function () { var v = srcEl.value.trim(); if (v) setSrc(v); });
    srcEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = srcEl.value.trim(); if (v) setSrc(v); } });
    var altEl = document.getElementById('wsxImgAlt'); altEl.value = img.getAttribute('alt') || '';
    altEl.addEventListener('input', function () { img.setAttribute('alt', altEl.value); markDirty(rec, img); });
    document.getElementById('wsxImgUp').addEventListener('click', function () {
      var f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
      f.addEventListener('change', function () {
        var file = f.files && f.files[0]; if (!file) return;
        var fd = new FormData(); fd.append('file', file); setSaveStatus(rec, 'Uploading\\u2026');
        fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/upload', { method: 'POST', credentials: 'same-origin', body: fd })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (j && j.url) { srcEl.value = j.url; setSrc(j.url); } else setSaveStatus(rec, 'Upload failed', 'warn'); })
          .catch(function () { setSaveStatus(rec, 'Upload failed', 'warn'); });
      });
      f.click();
    });
    wireBox(rec, img, false); wireInsert(rec); wireEditActions(rec);
  }
  function markDirty(rec, el) {
    if (el) syncLiveToSource(rec, el);
    var was = rec.dirty; rec.dirty = true; setSaveStatus(rec, 'Editing\\u2026');
    if (!was) renderTabs();
    if (rec.saveTimer) clearTimeout(rec.saveTimer);
    rec.saveTimer = setTimeout(function () { autosaveDraft(rec); }, 2000);
    if (rec.histTimer) clearTimeout(rec.histTimer);
    rec.histTimer = setTimeout(function () { pushHistory(rec); }, 700);
  }
  // Serialize the SOURCE doc (the saved truth) — never the live rendered DOM.
  function serializeClean(rec) {
    if (!rec.srcDoc) return null;
    var clone = rec.srcDoc.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-wsx-id]').forEach(function (el) { el.removeAttribute('data-wsx-id'); });
    clone.querySelectorAll('[contenteditable]').forEach(function (el) { el.removeAttribute('contenteditable'); });
    clone.querySelectorAll('[data-wsx-hover]').forEach(function (el) { el.removeAttribute('data-wsx-hover'); });
    clone.querySelectorAll('base, style[data-wsx-edit], [data-shareout-editor]').forEach(function (el) { el.remove(); });
    return '<!DOCTYPE html>' + clone.outerHTML;
  }
  function autosaveDraft(rec) {
    var html = serializeClean(rec); if (html == null) return;
    setSaveStatus(rec, 'Saving\\u2026');
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/draft', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: html, baseUpdatedAt: rec.baseUpdatedAt || undefined }) })
      .then(function (r) {
        if (r.status === 409) { setSaveStatus(rec, 'Reloaded \\u2014 a newer draft existed', 'warn'); rec.loaded = false; loadEditSource(rec); return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (j) { if (!j) { if (rec.savestat.textContent === 'Saving\\u2026') setSaveStatus(rec, 'Save failed', 'warn'); return; } rec.baseUpdatedAt = j.draftUpdatedAt || rec.baseUpdatedAt; rec.dirty = false; renderTabs(); setSaveStatus(rec, 'Saved \\u00b7 draft', 'ok'); })
      .catch(function () { setSaveStatus(rec, 'Save failed', 'warn'); });
  }
  function publishEdit(rec) {
    var html = serializeClean(rec); if (html == null) return;
    if (rec.saveTimer) clearTimeout(rec.saveTimer);
    rec.publishBtn.disabled = true; setSaveStatus(rec, 'Publishing\\u2026');
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/publish', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: html, commitMessage: 'Quick edit in Studio', baseUpdatedAt: rec.baseUpdatedAt || undefined }) })
      .then(function (r) {
        if (r.status === 409) { rec.publishBtn.disabled = false; setSaveStatus(rec, 'Reloaded \\u2014 a newer draft existed', 'warn'); rec.loaded = false; loadEditSource(rec); return { __conflict: true }; }
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (j && j.__conflict) return;
        rec.publishBtn.disabled = false;
        if (!j || !j.success) { setSaveStatus(rec, 'Publish failed', 'warn'); return; }
        rec.dirty = false; rec.baseUpdatedAt = null; renderTabs();
        if (j.tests && j.tests.pending) { setSaveStatus(rec, 'Published \\u2014 tests running', 'ok'); toast('Published \\u2014 tests running'); }
        else { setSaveStatus(rec, 'Published v' + (j.versionNo || ''), 'ok'); toast('Published v' + (j.versionNo || '')); }
        metaCache[rec.art.id] = undefined;
        try { rec.iframe.src = '/a/' + encodeURIComponent(rec.art.slug) + '/?wsx=1&t=' + Date.now(); } catch (e) {}
      })
      .catch(function () { rec.publishBtn.disabled = false; setSaveStatus(rec, 'Publish failed', 'warn'); });
  }
  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'wsx__toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('is-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-show'); }, 2600);
  }

`;
