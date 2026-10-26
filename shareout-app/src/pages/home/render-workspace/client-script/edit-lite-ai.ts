/** Quick edit AI: point at an element (or the page), ask, preview the change in place as a
 *  proposal, keep or discard it. Part of the Edit-Lite lazy chunk (shares its scope). */
import { colors } from '@shareout/design-tokens';

export const workspace_client_edit_lite_ai_JS = `  // ===== Edit-Lite AI: point, ask, preview, keep =====
  // Requests use the full editor's /editor/chat/normal contract. The model targets
  // [data-editor-id="w{n}"], which maps back to our data-wsx-id n.
  var AI_PRESET = {
    rewrite: 'Rewrite the selected text to be clearer and more engaging. Keep the same meaning and language.',
    shorten: 'Make the selected text shorter and punchier without losing the key point. Keep the same language.',
    grammar: 'Fix spelling and grammar in the selected text. Keep the wording, tone and language.',
    tidy: 'Tidy the spacing of the selected block: consistent padding, margins and gaps between its children on a simple 4/8px rhythm. Do not change any text, colors or images.',
    card: 'Turn the selected block into a card: a subtle background, a thin border, rounded corners, comfortable padding and a soft shadow. Keep its content exactly as it is.',
    alt: 'Write concise, descriptive alt text for the selected image (at most 125 characters, in the language of the page), using its file name and the surrounding content. Set only its alt attribute.',
  };
  var AI_LABEL = { rewrite: 'edit.aiRewrite', shorten: 'edit.aiShorten', grammar: 'edit.aiGrammar', translate: 'edit.aiTranslate', tidy: 'edit.aiTidy', card: 'edit.aiCard', alt: 'edit.aiAlt' };
  var AI_PRESETS = { text: ['rewrite', 'shorten', 'grammar', 'translate'], box: ['tidy', 'card'], img: ['alt'], link: [], page: [] };
  var AI_MAX_HTML = 40000;
  var AI_SECTION = 'section,article,main,header,footer,nav,aside,form,table';
  var AI_OUTLINE = '{outline:2px solid ${colors.primary} !important;outline-offset:2px}';

  function repaintEdit(rec) { if (panes[activeKey] === rec && rec.mode === 'edit') renderEditPanel(rec); }
  function aiNoteHtml(rec) {
    if (rec.aiBusy) return esc(t('edit.aiWorking'));
    var n = rec.aiNote; if (!n) return '';
    if (n.kind === 'error') return '<span class="is-err">' + esc(n.text) + '</span> <button type="button" class="wsx-link" data-ai-retry>' + esc(t('edit.aiTryAgain')) + '</button>';
    return '<div class="wsx-edit__aireply">' + esc(n.text)
      + (n.missed ? '<div class="wsx-edit__aiwarn">' + esc(t('edit.aiMissed')) + '</div>' : '')
      + '<button type="button" class="wsx-edit__aix" data-ai-dismiss aria-label="' + esc(t('common.close')) + '">\\u00D7</button></div>';
  }
  function aiSectionHtml(rec, kind) {
    var off = rec.aiBusy ? ' disabled' : '', presets = AI_PRESETS[kind] || [];
    return '<div class="wsx-edit__ai" data-ai-box>'
      + '<div class="lbl">\\u2728 ' + esc(t('edit.askAi')) + '</div>'
      + (presets.length ? '<div class="wsx-edit__aibtns">' + presets.map(function (k) { return '<button data-ai="' + k + '" type="button"' + off + '>' + esc(t(AI_LABEL[k])) + '</button>'; }).join('') + '</div>' : '')
      + '<div class="wsx-edit__airow"><input id="wsxAiPrompt" aria-label="' + esc(t('edit.askAi')) + '" placeholder="' + esc(t(kind === 'page' ? 'edit.aiPagePh' : 'edit.aiPromptPh')) + '"' + off + '><button class="wsx-edit__btn" id="wsxAiGo" type="button"' + off + '>' + esc(t('edit.aiGo')) + '</button></div>'
      + '<div class="wsx-edit__aistat" id="wsxAiStat" role="status">' + aiNoteHtml(rec) + '</div></div>';
  }
  // el: the selected live element, or null for the whole page.
  function wireAi(rec, el) {
    var box = rbodyEl.querySelector('[data-ai-box]'); if (!box) return;
    var id = el ? el.getAttribute('data-wsx-id') : null;
    box.querySelectorAll('[data-ai]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-ai');
        if (k === 'translate') { var lang = window.prompt(t('edit.translatePrompt'), t('edit.translateDefault')); if (!lang) return; aiAssist(rec, id, 'Translate the selected text to ' + lang + '. Keep its formatting.', t(AI_LABEL[k]) + ' \\u2192 ' + lang); return; }
        aiAssist(rec, id, AI_PRESET[k], t(AI_LABEL[k]));
      });
    });
    var inp = box.querySelector('#wsxAiPrompt'), go = box.querySelector('#wsxAiGo');
    function run() { var v = inp.value.trim(); if (v) aiAssist(rec, id, v, v); }
    go.addEventListener('click', run);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    var rt = box.querySelector('[data-ai-retry]'); if (rt) rt.addEventListener('click', function () { var l = rec.aiLast; if (l) aiAssist(rec, l.id, l.instruction, l.label); });
    var dx = box.querySelector('[data-ai-dismiss]'); if (dx) dx.addEventListener('click', function () { rec.aiNote = null; repaintEdit(rec); });
  }
  // Pending typing becomes its own undo step first, so Keep \\u2192 Undo is exactly the AI change.
  function flushEdits(rec) {
    var fd = rec.editframe && rec.editframe.contentDocument, a = fd && fd.activeElement;
    if (a && a.getAttribute && a.getAttribute('contenteditable') === 'true') syncLiveToSource(rec, a);
    if (rec.histTimer) { clearTimeout(rec.histTimer); rec.histTimer = 0; }
    pushHistory(rec);
  }
  function aiAssist(rec, id, instruction, label) {
    if (rec.aiBusy || rec.proposal || !rec.srcDoc || !rec.art.id) return;
    if (id != null && !rec.srcDoc.querySelector('[data-wsx-id="' + id + '"]')) return;
    flushEdits(rec);
    var req = aiRequest(rec, id, instruction);
    rec.aiLast = { id: id, instruction: instruction, label: label };
    rec.aiBusy = true; rec.aiNote = null; repaintEdit(rec);
    var done = null, failed = '';
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/chat/normal', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) })
      .then(function (resp) {
        if (!resp.ok || !resp.body) return resp.json().catch(function () { return {}; }).then(function (j) { failed = resp.status === 403 ? t('edit.aiUnavailable') : (j && j.error) || t('edit.aiFailed'); });
        return readStream(resp, function (ev) {
          if (ev.type === 'done') done = ev;
          else if (ev.type === 'error') failed = ev.error || ev.message || t('edit.aiFailed');
        });
      })
      .catch(function () { failed = failed || t('create.connDropped'); })
      .then(function () {
        rec.aiBusy = false;
        if (done && !failed) aiDone(rec, req, done, label);
        else { rec.aiNote = { kind: 'error', text: failed || t('edit.aiFailed') }; repaintEdit(rec); }
      });
  }
  // The copy the model sees: the source doc with data-editor-id="w{n}" beside data-wsx-id.
  // A big page sends the selection's nearest section only.
  function aiRequest(rec, id, instruction) {
    var root = rec.srcDoc.documentElement.cloneNode(true);
    root.querySelectorAll('[data-wsx-id]').forEach(function (el) { if (!el.hasAttribute('data-editor-id')) el.setAttribute('data-editor-id', 'w' + el.getAttribute('data-wsx-id')); });
    var full = root.outerHTML, html = full, mode = 'full';
    var src = id != null ? root.querySelector('[data-wsx-id="' + id + '"]') : null;
    if (src && full.length > AI_MAX_HTML) {
      var sec = src.closest(AI_SECTION), up = src;
      if (!sec) { for (var i = 0; i < 3 && up.parentElement && up.parentElement.localName !== 'body'; i++) up = up.parentElement; sec = up; }
      html = sec.outerHTML; mode = 'subtree';
    }
    var meta = metaCache[rec.art.id] || {};
    var context = { documentHtml: html, htmlMode: mode, artifact: { id: rec.art.id, name: rec.art.name || meta.name || 'Page', slug: rec.art.slug, description: meta.description || '' } };
    if (src) {
      var sel = '[data-editor-id="' + src.getAttribute('data-editor-id') + '"]';
      context.selection = { selector: sel, tagName: src.localName, id: src.id || undefined, classes: [].slice.call(src.classList), textPreview: (src.textContent || '').trim().slice(0, 200) };
      context.selectedElements = [sel];
    }
    return { id: id, whole: mode === 'full' && full.length <= AI_MAX_HTML, body: { prompt: (src ? 'Only modify the selected element. ' : '') + instruction, context: context } };
  }
  function postChange(rec, kind, changeId) {
    if (!changeId) return;
    fetch('/v1/artifacts/' + encodeURIComponent(rec.art.id) + '/editor/chat/' + kind, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeId: changeId }) }).catch(function () {});
  }
  function aiDone(rec, req, ev, label) {
    var resp = ev.response || {}, reply = resp.message || '';
    var p = buildProposal(rec, req, resp);
    if (!p.differs) {
      // A reply with no change (a question, or nothing could be placed) stays visible.
      if (p.tried) postChange(rec, 'reject', ev.changeId);
      rec.aiNote = { kind: 'reply', text: reply || t('edit.aiFailed'), missed: p.missed };
      repaintEdit(rec); return;
    }
    rec.proposal = { doc: p.doc, changed: p.changed, idCounter: p.idCounter, missed: p.missed, reply: reply, label: label, changeId: ev.changeId, selId: req.id, view: 'after' };
    rec.sel = null;
    setLocked(rec, true);
    renderProposalFrame(rec);
    repaintEdit(rec);
  }
  // Model selectors name data-editor-id="w{n}"; ours are data-wsx-id. Never the body or head.
  function aiTarget(rec, doc, selector) {
    if (!selector || typeof selector !== 'string') return null;
    var s = selector.replace(/\\[\\s*data-editor-id\\s*=\\s*["']?w(\\d+)["']?\\s*\\]/g, '[data-wsx-id="$1"]'), el = null;
    try { el = doc.querySelector(s); } catch (e) { return null; }
    if (!el || el === doc.body || !doc.body.contains(el)) return null;
    if (rec.md && (!mdRoot(doc).contains(el) || el === mdRoot(doc) || el.closest('[data-md-lock]'))) return null;
    return el;
  }
  function applyPatch(el, p) {
    if (p.action === 'replace') el.outerHTML = p.content || '';
    else if (p.action === 'insert') el.insertAdjacentHTML('beforeend', p.content || '');
    else if (p.action === 'delete') el.remove();
    else if (p.action === 'setAttribute' && p.attribute) el.setAttribute(p.attribute, p.value == null ? '' : String(p.value));
    else if (p.action === 'setStyle' && p.attribute) { if (p.attribute.indexOf('-') > 0) el.style.setProperty(p.attribute, p.value); else el.style[p.attribute] = p.value; }
    else return false;
    return true;
  }
  // Apply the reply to a CLONE of the source doc. A patch whose target can't be found is
  // skipped and counted — never redirected to the selected element.
  function buildProposal(rec, req, resp) {
    var doc = new DOMParser().parseFromString('<!DOCTYPE html>' + rec.srcDoc.documentElement.outerHTML, 'text/html');
    var before = doc.body.innerHTML, tried = 0, missed = 0;
    if (resp.html) {
      tried++;
      if (!req.whole) missed++; // only a whole, untruncated page may be replaced wholesale
      else {
        var parsed = new DOMParser().parseFromString(resp.html, 'text/html'), pr = rec.md && parsed.querySelector('[data-md-root]');
        if (rec.md) mdRoot(doc).innerHTML = pr ? pr.innerHTML : parsed.body.innerHTML; else doc.body.innerHTML = parsed.body.innerHTML;
      }
    } else (resp.patches || []).forEach(function (p) {
      tried++;
      var el = p && aiTarget(rec, doc, p.selector), ok = false;
      if (el) { try { ok = applyPatch(el, p); } catch (e) { ok = false; } }
      if (!ok) missed++;
    });
    var idCounter = mapAiIds(doc, rec.idCounter || 0);
    var differs = doc.body.innerHTML !== before;
    return { doc: doc, tried: tried, missed: missed, differs: differs, idCounter: idCounter, changed: differs ? changedIds(rec.srcDoc, doc) : [] };
  }
  // data-editor-id="w{n}" back to data-wsx-id n; duplicates and new nodes get fresh ids.
  function mapAiIds(doc, counter) {
    doc.querySelectorAll('[data-editor-id]').forEach(function (el) {
      var m = /^w(\\d+)$/.exec(el.getAttribute('data-editor-id') || ''); if (!m) return;
      if (!el.hasAttribute('data-wsx-id')) el.setAttribute('data-wsx-id', m[1]);
      el.removeAttribute('data-editor-id');
    });
    var seen = {};
    doc.querySelectorAll('[data-wsx-id]').forEach(function (el) {
      var id = el.getAttribute('data-wsx-id'), n = parseInt(id, 10);
      if (seen[id] || !(n >= 0)) { el.removeAttribute('data-wsx-id'); return; }
      seen[id] = 1; if (n >= counter) counter = n + 1;
    });
    return stampTree(doc, counter);
  }
  function elSig(el) {
    var a = [], txt = '';
    for (var i = 0; i < el.attributes.length; i++) { var n = el.attributes[i].name; if (n.indexOf('data-wsx-') !== 0) a.push(n + '=' + el.attributes[i].value); }
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) txt += c.nodeValue;
    return el.localName + '|' + a.sort().join('|') + '|' + txt;
  }
  // The outermost elements that are new or whose own tag, attributes or text changed.
  function changedIds(orig, doc) {
    var map = {}, out = [];
    orig.querySelectorAll('[data-wsx-id]').forEach(function (el) { map[el.getAttribute('data-wsx-id')] = el; });
    (function walk(el, under) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        var id = c.getAttribute('data-wsx-id'), ch = id != null && (!map[id] || elSig(map[id]) !== elSig(c));
        if (ch && !under) out.push(id);
        walk(c, under || ch);
      }
    })(doc.body, false);
    return out;
  }
  // ---- the open proposal: shown in place, everything else locked until Keep or Discard ----
  function setLocked(rec, on) {
    if (on) { rec.undoBtn.disabled = true; rec.redoBtn.disabled = true; rec.publishBtn.disabled = true; rec.discardBtn.disabled = true; return; }
    updateUndoButtons(rec); rec.publishBtn.disabled = false; rec.discardBtn.disabled = false;
  }
  function closeProposal(rec) { rec.proposal = null; setLocked(rec, false); }
  function renderProposalFrame(rec) {
    var p = rec.proposal; if (!p) return;
    var after = p.view === 'after', doc = after ? p.doc : rec.srcDoc;
    var css = after && p.changed.length ? p.changed.map(function (id) { return '[data-wsx-id="' + id + '"]'; }).join(',') + AI_OUTLINE : '';
    rec.editframe.onload = function () {
      rec.editframe.onload = null;
      var d = rec.editframe.contentDocument; if (!d) return;
      d.addEventListener('keydown', function (e) { editKeydown(rec, e); });
      var first = p.changed[0] != null && d.querySelector('[data-wsx-id="' + p.changed[0] + '"]');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
    };
    rec.editframe.srcdoc = editFrameHtml(doc, rec.art.slug, css);
  }
  function renderProposalPanel(rec) {
    var p = rec.proposal, after = p.view === 'after';
    rbodyEl.innerHTML = '<div class="wsx-edit"><div class="wsx-prop" data-prop>'
      + '<div class="wsx-prop__lbl">\\u2728 ' + esc(t('edit.aiProposal')) + '</div>'
      + (p.label ? '<div class="wsx-prop__ask">' + esc(p.label) + '</div>' : '')
      + (p.reply ? '<div class="wsx-prop__reply">' + esc(p.reply) + '</div>' : '')
      + (p.missed ? '<div class="wsx-edit__aiwarn">' + esc(t('edit.aiMissed')) + '</div>' : '')
      + '<div class="wsx-prop__seg" role="group" aria-label="' + esc(t('edit.aiCompare')) + '">'
      + '<button type="button" data-pview="before" aria-pressed="' + !after + '">' + esc(t('edit.aiBefore')) + '</button>'
      + '<button type="button" data-pview="after" aria-pressed="' + after + '">' + esc(t('edit.aiAfter')) + '</button></div>'
      + '<div class="wsx-prop__acts"><button type="button" class="wsx-prop__keep" data-pact="keep">' + esc(t('edit.aiKeep')) + '</button>'
      + '<button type="button" class="wsx-edit__btn" data-pact="retry">' + esc(t('edit.aiTryAgain')) + '</button>'
      + '<button type="button" class="wsx-edit__btn" data-pact="discard">' + esc(t('edit.aiDiscard')) + '</button></div>'
      + '</div></div>';
    var box = rbodyEl.querySelector('[data-prop]');
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); discardProposal(rec); } });
    box.querySelectorAll('[data-pview]').forEach(function (b) {
      b.addEventListener('click', function () { var v = b.getAttribute('data-pview'); if (!rec.proposal || rec.proposal.view === v) return; rec.proposal.view = v; renderProposalFrame(rec); renderProposalPanel(rec); var nb = rbodyEl.querySelector('[data-pview="' + v + '"]'); if (nb) nb.focus(); });
    });
    box.querySelector('[data-pact="keep"]').addEventListener('click', function () { keepProposal(rec); });
    box.querySelector('[data-pact="retry"]').addEventListener('click', function () { retryProposal(rec); });
    box.querySelector('[data-pact="discard"]').addEventListener('click', function () { discardProposal(rec); });
    if (!box.contains(document.activeElement)) box.querySelector('[data-pact="keep"]').focus();
  }
  function proposalKeydown(rec, e) {
    if (e.key === 'Escape') { e.preventDefault(); discardProposal(rec); return; }
    var k = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (k === 's' || k === 'z' || k === 'y')) e.preventDefault(); // locked
  }
  // Keep: commit to the source doc, one undo step, save now.
  function keepProposal(rec) {
    var p = rec.proposal; if (!p) return;
    if (rec.histTimer) { clearTimeout(rec.histTimer); rec.histTimer = 0; }
    pushHistory(rec);
    rec.srcDoc.body.innerHTML = p.doc.body.innerHTML;
    rec.idCounter = Math.max(rec.idCounter || 0, p.idCounter);
    closeProposal(rec);
    pushHistory(rec);
    rec.pendingSel = p.selId != null && rec.srcDoc.querySelector('[data-wsx-id="' + p.selId + '"]') ? p.selId : null;
    rec.dirty = true; renderTabs();
    if (rec.saveTimer) { clearTimeout(rec.saveTimer); rec.saveTimer = 0; }
    autosaveDraft(rec);
    renderLive(rec);
    postChange(rec, 'apply', p.changeId);
  }
  // Discard: the source doc was never touched; show it again as it was.
  function discardProposal(rec) {
    var p = rec.proposal; if (!p) return;
    closeProposal(rec);
    rec.pendingSel = p.selId;
    renderLive(rec);
    postChange(rec, 'reject', p.changeId);
  }
  function retryProposal(rec) {
    var p = rec.proposal, l = rec.aiLast; if (!p) return;
    discardProposal(rec);
    if (l) aiAssist(rec, l.id, l.instruction, l.label);
  }
`;
