/** Knowledge curation — the team's hand on what Knowledge learned. Owners and admins confirm,
 *  rename, retype, merge and discard entities, connect them, keep or drop facts, and write
 *  the types, glossary and rules the learner follows (the Rules view). Members see the same
 *  pages read-only. API: src/router/api/knowledge-curation.ts. Shares scope with
 *  knowledge.ts + knowledge-map.ts (same lazy chunk). */
export const workspace_client_home_views_knowledgeCurate_JS = `  // ----- Knowledge curation — edit the graph, write the rules -----
  var kcState = { schema: null, rules: null, discarded: null, relTypes: [] };
  function kcAdmin() { return !!window.WSX_ADMIN; }
  function kcToast(msg, type, action) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'success', action ? { action: action } : undefined); }
  function kcFail(e) { kcToast((e && e.message) || t('kcur.error'), 'error'); }
  function kcApi(method, path, body) {
    return fetch(knBase() + path, { method: method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error((d && d.error) || t('kcur.error')); e.status = r.status; e.body = d; throw e; }
          return d;
        });
      });
  }
  // After any change: drop what the map cached and show the entity again.
  function kcRefresh(id) {
    kmState.gcache = {}; kmState.dcache = {}; kcState.schema = null;
    kmLoadTypes(function () { kmPaintFinder(); kmGo(id || kmState.focus || (kmState.top[0] && kmState.top[0].id), 'none'); });
  }
  function kcRelTypes() {
    var seen = {}, out = [];
    (kcState.relTypes || []).concat(['part_of', 'responsible_for', 'uses', 'applies_to', 'defines', 'measures', 'related_to']).forEach(function (r) { if (r && !seen[r]) { seen[r] = true; out.push(r); } });
    return out;
  }
  function kcTypes(current) {
    var list = [], seen = {};
    var add = function (ty) { if (ty && !seen[ty]) { seen[ty] = true; list.push(ty); } };
    ((kcState.schema && kcState.schema.types) || []).forEach(function (x) { if (!x.ignored) add(x.type); });
    (kmState.types || []).forEach(add);
    add(current);
    return list;
  }
  function kcLoadSchema(cb) {
    if (kcState.schema) { cb(kcState.schema); return; }
    fetch(knBase() + '/schema', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { kcState.schema = s || { types: [], teamOnly: false, relationTypes: [] }; kcState.relTypes = kcState.schema.relationTypes || []; cb(kcState.schema); })
      .catch(function () { cb({ types: [], teamOnly: false, relationTypes: [] }); });
  }

  // ---- Popover: one at a time, closes on Escape or a click outside ----
  function kcClosePop() { var p = document.getElementById('kcPop'); if (p) p.remove(); document.removeEventListener('mousedown', kcOutside, true); document.removeEventListener('keydown', kcEsc, true); }
  function kcOutside(ev) { var p = document.getElementById('kcPop'); if (p && !p.contains(ev.target)) kcClosePop(); }
  function kcEsc(ev) { if (ev.key === 'Escape') kcClosePop(); }
  function kcPop(x, y, title, bodyHtml) {
    kcClosePop();
    var p = document.createElement('div'); p.className = 'kc-pop'; p.id = 'kcPop'; p.setAttribute('role', 'dialog');
    p.innerHTML = '<div class="kc-pop__t">' + esc(title) + '</div>' + bodyHtml;
    document.body.appendChild(p);
    var w = p.offsetWidth, h = p.offsetHeight;
    p.style.left = Math.max(12, Math.min(x, window.innerWidth - w - 12)) + 'px';
    p.style.top = Math.max(12, Math.min(y, window.innerHeight - h - 12)) + 'px';
    setTimeout(function () { document.addEventListener('mousedown', kcOutside, true); document.addEventListener('keydown', kcEsc, true); }, 0);
    var f = p.querySelector('input, select, textarea'); if (f) f.focus();
    return p;
  }
  function kcRow(okLabel) { return '<div class="kc-pop__row"><button class="so-c-btn so-c-btn--sm" type="button" data-kc-x>' + esc(t('kcur.cancel')) + '</button><button class="so-c-btn so-c-btn--sm so-c-btn--primary" type="button" data-kc-ok>' + esc(okLabel) + '</button></div>'; }
  function kcBindRow(p, onOk) {
    p.querySelector('[data-kc-x]').addEventListener('click', kcClosePop);
    var ok = p.querySelector('[data-kc-ok]'); ok.addEventListener('click', function () { onOk(ok); });
    p.querySelectorAll('input').forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); onOk(ok); } }); });
  }
  function kcTypeSelect(id, sel) { return '<select class="so-c-select kc-pop__in" id="' + id + '">' + kcTypes(sel).map(function (ty) { return '<option value="' + esc(ty) + '"' + (ty === sel ? ' selected' : '') + '>' + esc(kmTypeLabel(ty)) + '</option>'; }).join('') + '</select>'; }
  function kcRelInput(id) { return '<input class="so-c-input kc-pop__in" id="' + id + '" list="' + id + 'L" placeholder="' + esc(t('kcur.relationPh')) + '" autocomplete="off"><datalist id="' + id + 'L">' + kcRelTypes().map(function (r) { return '<option value="' + esc(kmRelLabel(r)) + '">'; }).join('') + '</datalist>'; }

  // Entity picker: type to search, click a result.
  function kcPicker(host, exclude, onPick) {
    host.innerHTML = '<input class="so-c-input kc-pop__in" type="search" data-kc-q placeholder="' + esc(t('kcur.searchEntity')) + '" autocomplete="off"><div class="kc-pick" data-kc-res></div>';
    var q = host.querySelector('[data-kc-q]'), res = host.querySelector('[data-kc-res]'), timer = null, req = 0;
    var paint = function (list) {
      list = (list || []).filter(function (e) { return e.id !== exclude; }).slice(0, 8);
      res.innerHTML = list.length ? list.map(function (e) { return '<button type="button" class="km__item" data-kc-pick="' + esc(e.id) + '" data-kc-name="' + esc(e.name) + '">' + kmDot(e.type) + '<span class="km__iname">' + esc(e.name) + '</span><span class="km__itype">' + esc(kmTypeLabel(e.type)) + '</span></button>'; }).join('') : '<div class="km__none">' + esc(t('kmap.noResults')) + '</div>';
      res.querySelectorAll('[data-kc-pick]').forEach(function (b) { b.addEventListener('click', function () { res.querySelectorAll('.is-on').forEach(function (x) { x.classList.remove('is-on'); }); b.classList.add('is-on'); onPick(b.getAttribute('data-kc-pick'), b.getAttribute('data-kc-name')); }); });
    };
    paint(kmState.top);
    q.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      var v = q.value.trim();
      if (!v) { paint(kmState.top); return; }
      timer = setTimeout(function () {
        var my = ++req;
        fetch(knBase() + '/entities?limit=12&q=' + encodeURIComponent(v), { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { if (my === req) paint((d && d.entities) || []); })
          .catch(function () {});
      }, 160);
    });
  }
  function kcRelValue(id) { var v = ((document.getElementById(id) || {}).value || '').trim().toLowerCase(); return v.replace(/[^\\p{L}\\p{N}]+/gu, '_').replace(/^_|_$/g, ''); }

  // ---- Actions ----
  function kcConfirm(id) {
    kcApi('PATCH', '/entities/' + encodeURIComponent(id), { confirm: true })
      .then(function () { kcToast(t('kcur.tConfirmed')); kcRefresh(id); }).catch(kcFail);
  }
  function kcCreateAt(x, y, linkTo) {
    kcLoadSchema(function () {
      var p = kcPop(x, y, t('kcur.newEntity'),
        '<label class="kc-pop__l">' + esc(t('kcur.name')) + '</label><input class="so-c-input kc-pop__in" id="kcName" autocomplete="off">'
        + '<label class="kc-pop__l">' + esc(t('kcur.type')) + '</label>' + kcTypeSelect('kcType', (kcTypes()[0] || 'Organization'))
        + (linkTo ? '<label class="kc-pop__chk"><input type="checkbox" id="kcLink" checked> ' + esc(t('kcur.linkTo').replace('{n}', kmName(linkTo))) + '</label>' : '')
        + kcRow(t('kcur.create')));
      kcBindRow(p, function (ok) {
        var name = (document.getElementById('kcName').value || '').trim(); if (!name) return;
        ok.disabled = true;
        kcApi('POST', '/entities', { name: name, type: document.getElementById('kcType').value })
          .then(function (d) {
            var link = linkTo && document.getElementById('kcLink') && document.getElementById('kcLink').checked;
            return (link ? kcApi('POST', '/relations', { from: linkTo, type: 'related_to', to: d.id }) : Promise.resolve()).then(function () { return d; });
          })
          .then(function (d) { kcClosePop(); kcToast(t('kcur.tCreated')); kmState.trail = kmState.trail.concat([d.id]).slice(-6); kcRefresh(d.id); })
          .catch(function (e) { ok.disabled = false; kcFail(e); });
      });
    });
  }
  function kcConnect(from, to, x, y) {
    var p = kcPop(x, y, t('kcur.connect'), '<div class="kc-pop__pair"><b>' + esc(kmName(from)) + '</b> \\u2192 <b>' + esc(kmName(to)) + '</b></div>'
      + '<label class="kc-pop__l">' + esc(t('kcur.relation')) + '</label>' + kcRelInput('kcRel') + kcRow(t('kcur.connect')));
    kcBindRow(p, function (ok) {
      var type = kcRelValue('kcRel'); if (!type) return;
      ok.disabled = true;
      kcApi('POST', '/relations', { from: from, type: type, to: to })
        .then(function () { kcClosePop(); kcToast(t('kcur.tConnected')); kcRefresh(kmState.focus); })
        .catch(function (e) { ok.disabled = false; kcFail(e); });
    });
  }
  function kcConnectPick(from, x, y) {
    kcLoadSchema(function () {
      var picked = '';
      var p = kcPop(x, y, t('kcur.addConn'), '<label class="kc-pop__l">' + esc(t('kcur.connWith')) + '</label><div id="kcPick"></div>'
        + '<label class="kc-pop__l">' + esc(t('kcur.relation')) + '</label>' + kcRelInput('kcRel') + kcRow(t('kcur.connect')));
      kcPicker(document.getElementById('kcPick'), from, function (id) { picked = id; });
      kcBindRow(p, function (ok) {
        var type = kcRelValue('kcRel'); if (!picked || !type) return;
        ok.disabled = true;
        kcApi('POST', '/relations', { from: from, type: type, to: picked })
          .then(function () { kcClosePop(); kcToast(t('kcur.tConnected')); kcRefresh(from); })
          .catch(function (e) { ok.disabled = false; kcFail(e); });
      });
    });
  }
  function kcMergeAsk(from, into, intoName) {
    var a = kmName(from), b = intoName || kmName(into);
    var mo = wsxModal(t('kcur.mergeTitle'), '<p>' + esc(t('kcur.mergeBody').replace(/\\{a\\}/g, a).replace(/\\{b\\}/g, b)) + '</p>'
      + '<div class="kc-modal__row"><button class="so-c-btn" type="button" data-kc-no>' + esc(t('kcur.cancel')) + '</button><button class="so-c-btn so-c-btn--primary" type="button" data-kc-yes>' + esc(t('kcur.merge')) + '</button></div>');
    mo.body.querySelector('[data-kc-no]').addEventListener('click', function () { mo.close(); if (kmState.lay) kmPaintCanvas(); });
    mo.body.querySelector('[data-kc-yes]').addEventListener('click', function (ev) {
      ev.target.disabled = true;
      kcApi('POST', '/entities/' + encodeURIComponent(from) + '/merge', { into: into })
        .then(function () { mo.close(); kcToast(t('kcur.tMerged')); kmState.trail = kmState.trail.filter(function (x) { return x !== from; }); kcRefresh(into); })
        .catch(function (e) { ev.target.disabled = false; kcFail(e); });
    });
  }
  function kcMergePick(from, x, y) {
    var picked = '', pickedName = '';
    var p = kcPop(x, y, t('kcur.mergeInto'), '<div id="kcPick"></div>' + kcRow(t('kcur.merge')));
    kcPicker(document.getElementById('kcPick'), from, function (id, name) { picked = id; pickedName = name; });
    kcBindRow(p, function () { if (!picked) return; kcClosePop(); kcMergeAsk(from, picked, pickedName); });
  }
  var KC_REASONS = ['noint', 'wrong', 'notent', 'dup'];
  function kcDiscardAsk(e, x, y) {
    var why = '';
    var p = kcPop(x, y, t('kcur.discardTitle').replace('{n}', e.name), '<p class="kc-pop__p">' + esc(t('kcur.discardBody')) + '</p><div class="km__chips">'
      + KC_REASONS.map(function (r) { return '<button class="km__chip" type="button" data-kc-why="' + r + '">' + esc(t('kcur.why.' + r)) + '</button>'; }).join('') + '</div>'
      + '<div class="kc-pop__row"><button class="so-c-btn so-c-btn--sm" type="button" data-kc-x>' + esc(t('kcur.cancel')) + '</button><button class="so-c-btn so-c-btn--sm so-c-btn--danger" type="button" data-kc-ok>' + esc(t('kcur.discard')) + '</button></div>');
    p.querySelectorAll('[data-kc-why]').forEach(function (b) { b.addEventListener('click', function () { p.querySelectorAll('[data-kc-why]').forEach(function (x) { x.classList.remove('is-on'); }); b.classList.add('is-on'); why = b.getAttribute('data-kc-why'); }); });
    kcBindRow(p, function (ok) {
      ok.disabled = true;
      kcApi('DELETE', '/entities/' + encodeURIComponent(e.id) + (why ? '?reason=' + why : ''))
        .then(function () {
          kcClosePop(); kcToast(t('kcur.tDiscarded'));
          kmState.trail = kmState.trail.filter(function (x) { return x !== e.id; });
          var next = kmState.trail[kmState.trail.length - 1] || '';
          kmState.focus = next; kcRefresh(next);
          // "Not relevant" on a whole kind of thing: offer to ignore the type.
          if (why === 'noint') kcOfferIgnoreType(e.type);
        })
        .catch(function (err) { ok.disabled = false; kcFail(err); });
    });
  }
  function kcOfferIgnoreType(type) {
    var mo = wsxModal(t('kcur.ignoreTypeTitle').replace('{t}', kmTypeLabel(type)), '<p>' + esc(t('kcur.ignoreTypeBody')) + '</p>'
      + '<div class="kc-modal__row"><button class="so-c-btn" type="button" data-kc-no>' + esc(t('kcur.onlyThis')) + '</button><button class="so-c-btn so-c-btn--primary" type="button" data-kc-yes>' + esc(t('kcur.ignoreType')) + '</button></div>');
    mo.body.querySelector('[data-kc-no]').addEventListener('click', mo.close);
    mo.body.querySelector('[data-kc-yes]').addEventListener('click', function () {
      kcApi('PUT', '/schema/types/' + encodeURIComponent(type), { ignored: true })
        .then(function () { mo.close(); kcToast(t('kcur.tIgnored').replace('{t}', kmTypeLabel(type))); kmState.type = ''; kcRefresh(''); })
        .catch(kcFail);
    });
  }
  // A correction can become a rule the learner reads before every document.
  function kcOfferRule(text) {
    var mo = wsxModal(t('kcur.ruleTitle'), '<p>' + esc(t('kcur.ruleBody')) + '</p><textarea class="so-c-input kc-rule__ta" id="kcRuleTa" rows="3">' + esc(text) + '</textarea>'
      + '<div class="kc-modal__row"><button class="so-c-btn" type="button" data-kc-no>' + esc(t('kcur.onlyThis')) + '</button><button class="so-c-btn so-c-btn--primary" type="button" data-kc-yes>' + esc(t('kcur.saveRule')) + '</button></div>');
    mo.body.querySelector('[data-kc-no]').addEventListener('click', mo.close);
    mo.body.querySelector('[data-kc-yes]').addEventListener('click', function () {
      var v = (document.getElementById('kcRuleTa').value || '').trim(); if (!v) return;
      kcApi('POST', '/rules', { kind: 'rule', text: v }).then(function () { mo.close(); kcState.rules = null; kcToast(t('kcur.tRule')); }).catch(kcFail);
    });
  }
  function kcPatch(id, body, okMsg, after) {
    return kcApi('PATCH', '/entities/' + encodeURIComponent(id), body)
      .then(function () { if (okMsg) kcToast(okMsg); kcRefresh(id); if (after) after(); })
      .catch(function (e) {
        // Renamed onto another entity's name: offer the merge instead.
        var m = e && e.status === 409 && e.body && /"into":"([^"]+)"/.exec(e.body.suggestion || '');
        if (m) { kcMergeAsk(id, m[1]); return; }
        kcFail(e); kmLoadDetail();
      });
  }

  // ---- Evidence panel: the team's controls (admins), the status line (everyone) ----
  function kcPanelTop(d) {
    var e = d.entity || {}, admin = kcAdmin(), draft = e.status !== 'confirmed', n = (e.sources || []).length;
    var box = draft
      ? '<div class="kc-prop"><div class="kc-prop__t">' + esc(t(n === 1 ? 'kcur.proposedOne' : 'kcur.proposed').replace('{n}', n)) + '</div>'
        + (admin ? '<div class="kc-prop__row"><button class="so-c-btn so-c-btn--sm so-c-btn--primary" type="button" data-kc-confirm>\\u2713 ' + esc(t('kcur.confirm')) + '</button><button class="so-c-btn so-c-btn--sm" type="button" data-kc-discard>\\u2715 ' + esc(t('kcur.discard')) + '</button></div>' : '') + '</div>'
      : '<div class="kc-ok">\\u2713 ' + esc(t('kcur.confirmedBy')) + '</div>';
    var team = (e.teamAliases || []);
    var aliases = admin
      ? '<div class="kc-aka">' + team.map(function (a, i) { return '<span class="kc-tag">' + esc(a) + '<button type="button" data-kc-ral="' + i + '" aria-label="' + esc(t('kcur.remove')) + '">\\u00D7</button></span>'; }).join('')
        + (e.aliases || []).filter(function (a) { return team.indexOf(a) < 0; }).slice(0, 6).map(function (a) { return '<span class="kc-tag kc-tag--seen">' + esc(a) + '</span>'; }).join('')
        + '<button class="kc-addl" type="button" data-kc-alias>' + esc(t('kcur.addAlias')) + '</button></div>'
      : '';
    var def = e.description || admin
      ? '<section class="km__sec"><h4 class="km__h4">' + esc(t('kcur.definition')) + '</h4><div class="kc-def' + (e.description ? '' : ' is-empty') + (admin ? ' is-edit' : '') + '" data-kc-def>' + esc(e.description || t('kcur.definitionEmpty')) + '</div></section>'
      : '';
    return { box: box, aliases: aliases, def: def };
  }
  function kcBindPanel(host, d) {
    var e = d.entity || {}; if (!kcAdmin()) return;
    var on = function (sel, fn) { host.querySelectorAll(sel).forEach(function (b) { b.addEventListener('click', fn); }); };
    on('[data-kc-confirm]', function () { kcConfirm(e.id); });
    on('[data-kc-discard], [data-kc-discard2]', function (ev) { var r = ev.currentTarget.getBoundingClientRect(); kcDiscardAsk(e, r.left, r.bottom + 6); });
    on('[data-kc-merge]', function (ev) { var r = ev.currentTarget.getBoundingClientRect(); kcMergePick(e.id, r.left, r.bottom + 6); });
    on('[data-kc-conn]', function (ev) { var r = ev.currentTarget.getBoundingClientRect(); kcConnectPick(e.id, r.left - 200, r.bottom + 6); });
    on('[data-kc-fact]', function (ev) {
      var r = ev.currentTarget.getBoundingClientRect();
      var p = kcPop(r.left - 200, r.bottom + 6, t('kcur.addFact'), '<label class="kc-pop__l">' + esc(t('kcur.factWhat')) + '</label><input class="so-c-input kc-pop__in" id="kcFk" autocomplete="off">'
        + '<label class="kc-pop__l">' + esc(t('kcur.factValue')) + '</label><input class="so-c-input kc-pop__in" id="kcFv" autocomplete="off">' + kcRow(t('kcur.add')));
      kcBindRow(p, function (ok) {
        var k = document.getElementById('kcFk').value.trim(), v = document.getElementById('kcFv').value.trim(); if (!k || !v) return;
        ok.disabled = true;
        kcApi('POST', '/entities/' + encodeURIComponent(e.id) + '/facts', { predicate: k, value: v })
          .then(function () { kcClosePop(); kcToast(t('kcur.tSaved')); kcRefresh(e.id); })
          .catch(function (err) { ok.disabled = false; kcFail(err); });
      });
    });
    host.querySelectorAll('[data-kc-fok]').forEach(function (b) { b.addEventListener('click', function () { kcApi('POST', '/facts/' + encodeURIComponent(b.getAttribute('data-kc-fok')) + '/confirm').then(function () { kcToast(t('kcur.tSaved')); kcRefresh(e.id); }).catch(kcFail); }); });
    host.querySelectorAll('[data-kc-fno]').forEach(function (b) { b.addEventListener('click', function () { kcApi('DELETE', '/facts/' + encodeURIComponent(b.getAttribute('data-kc-fno'))).then(function () { kcToast(t('kcur.tDiscarded')); kcRefresh(e.id); }).catch(kcFail); }); });
    host.querySelectorAll('[data-kc-rok]').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); kcApi('POST', '/relations/' + encodeURIComponent(b.getAttribute('data-kc-rok')) + '/confirm').then(function () { kcToast(t('kcur.tConfirmed')); kcRefresh(e.id); }).catch(kcFail); }); });
    host.querySelectorAll('[data-kc-rno]').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); kcApi('DELETE', '/relations/' + encodeURIComponent(b.getAttribute('data-kc-rno'))).then(function () { kcToast(t('kcur.tDiscarded')); kcRefresh(e.id); }).catch(kcFail); }); });
    // Type: a correction the learner can be taught.
    var ty = host.querySelector('[data-kc-type]');
    if (ty) ty.addEventListener('change', function () {
      var old = e.type, nt = ty.value;
      kcPatch(e.id, { type: nt }, t('kcur.tSaved'), function () { if (old !== nt) kcOfferRule(t('kcur.ruleRetype').replace('{n}', e.name).replace('{t}', kmTypeLabel(nt)).replace('{o}', kmTypeLabel(old))); });
    });
    // Name: click to rename; the old name stays an alias.
    var nm = host.querySelector('[data-kc-name]');
    if (nm) nm.addEventListener('click', function () {
      if (nm.querySelector('input')) return;
      nm.innerHTML = '<input class="so-c-input kc-name__in" value="' + esc(e.name) + '" aria-label="' + esc(t('kcur.name')) + '">';
      var i = nm.querySelector('input'), done = false; i.focus(); i.select();
      var save = function () { if (done) return; done = true; var v = i.value.trim(); if (v && v !== e.name) kcPatch(e.id, { name: v }, t('kcur.tRenamed')); else kmPaintPanel(d); };
      i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') { done = true; kmPaintPanel(d); } });
      i.addEventListener('blur', save);
    });
    host.querySelectorAll('[data-kc-ral]').forEach(function (b) { b.addEventListener('click', function () {
      var list = (e.teamAliases || []).slice(); list.splice(Number(b.getAttribute('data-kc-ral')), 1); kcPatch(e.id, { aliases: list }, t('kcur.tSaved'));
    }); });
    on('[data-kc-alias]', function (ev) {
      var b = ev.currentTarget, i = document.createElement('input'); i.className = 'kc-addl kc-addl--in'; i.placeholder = t('kcur.aliasPh');
      b.replaceWith(i); i.focus();
      i.addEventListener('keydown', function (k) { if (k.key === 'Enter' && i.value.trim()) kcPatch(e.id, { aliases: (e.teamAliases || []).concat([i.value.trim()]) }, t('kcur.tSaved')); if (k.key === 'Escape') kmPaintPanel(d); });
      i.addEventListener('blur', function () { if (!i.value.trim()) kmPaintPanel(d); });
    });
    var df = host.querySelector('[data-kc-def]');
    if (df) df.addEventListener('click', function () {
      if (df.querySelector('textarea')) return;
      df.classList.remove('is-empty');
      df.innerHTML = '<textarea class="so-c-input kc-def__ta" rows="4">' + esc(e.description || '') + '</textarea><div class="kc-pop__row"><button class="so-c-btn so-c-btn--sm" type="button" data-kc-dx>' + esc(t('kcur.cancel')) + '</button><button class="so-c-btn so-c-btn--sm so-c-btn--primary" type="button" data-kc-ds>' + esc(t('kcur.save')) + '</button></div>';
      var ta = df.querySelector('textarea'); ta.focus();
      df.querySelector('[data-kc-dx]').addEventListener('click', function (ev) { ev.stopPropagation(); kmPaintPanel(d); });
      df.querySelector('[data-kc-ds]').addEventListener('click', function (ev) { ev.stopPropagation(); kcPatch(e.id, { description: ta.value.trim() }, t('kcur.tSaved')); });
    });
    kcLoadHistory(e.id);
  }
  // What the team did to this entity (admins).
  function kcLoadHistory(id) {
    var host = document.getElementById('kcHist'); if (!host) return;
    fetch(knBase() + '/history?limit=8&entity=' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var h = (d && d.history) || [];
        if (id !== kmState.focus) return;
        host.innerHTML = h.length ? h.map(function (x) {
          var k = 'kcur.h.' + x.action, label = t(k) === k ? x.action : t(k);
          var det = x.detail || {}, extra = det.name && det.name.from ? ' \\u00AB' + det.name.from + '\\u00BB \\u2192 \\u00AB' + det.name.to + '\\u00BB' : det.merged ? ' \\u00AB' + det.merged + '\\u00BB' : det.type && x.action.indexOf('relation') === 0 ? ' (' + kmRelLabel(det.type) + ')' : det.predicate ? ' (' + kmHuman(det.predicate) + ': ' + (det.value || '') + ')' : '';
          return '<div class="kc-hist"><span>' + esc(label + extra) + '</span><span class="kc-hist__when">' + esc(typeof adRelDate === 'function' ? adRelDate(x.at) : x.at) + '</span></div>';
        }).join('') : '<div class="km__none">' + esc(t('kcur.nothing')) + '</div>';
      })
      .catch(function () {});
  }

  // ---- Rules view: structure (types), glossary, rules, discarded ----
  function kcRenderRules(m, topHtml) {
    m.innerHTML = topHtml + '<div class="kc-rules" id="kcRules">' + i18nLoad() + '</div>';
    knBindShell(m);
    var admin = kcAdmin();
    var reqs = [
      fetch(knBase() + '/schema', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch(knBase() + '/rules', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
      admin ? fetch(knBase() + '/discarded?limit=50', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null)
    ];
    Promise.all(reqs).then(function (res) {
      kcState.schema = res[0] || { types: [], teamOnly: false, relationTypes: [] }; kcState.relTypes = kcState.schema.relationTypes || [];
      kcState.rules = (res[1] && res[1].rules) || [];
      kcState.discarded = (res[2] && res[2].discarded) || [];
      kcPaintRules();
    }).catch(function () { var h = document.getElementById('kcRules'); if (h) h.innerHTML = i18nError('knowledge.couldNotLoad'); });
  }
  function kcPaintRules() {
    var host = document.getElementById('kcRules'); if (!host) return;
    var admin = kcAdmin(), s = kcState.schema;
    var sw = function (on, attr, label) { return '<button class="kc-switch' + (on ? ' is-on' : '') + '" type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + attr + (admin ? '' : ' disabled') + ' aria-label="' + esc(label) + '"></button>'; };
    var types = (s.types || []).map(function (x) {
      return '<div class="kc-trow' + (x.ignored ? ' is-off' : '') + '">' + kmDot(x.type) + '<span class="kc-trow__n"><b>' + esc(kmTypeLabel(x.type)) + '</b>'
        + (x.description ? '<span class="kc-trow__d">' + esc(x.description) + '</span>' : (x.team ? '' : '<span class="kc-trow__d">' + esc(t('kcur.fromModel')) + '</span>')) + '</span>'
        + '<span class="kc-trow__c">' + esc(t('kcur.inGraph').replace('{n}', Number(x.count || 0).toLocaleString())) + '</span>'
        + '<span class="kc-trow__s">' + esc(t(x.ignored ? 'kcur.ignored' : 'kcur.active')) + sw(!x.ignored, 'data-kc-tog="' + esc(x.type) + '"', t('kcur.ignoreType') + ' ' + x.type) + '</span></div>';
    }).join('') || '<div class="km__none">' + esc(t('kcur.nothing')) + '</div>';
    var gl = kcState.rules.filter(function (r) { return r.kind === 'glossary'; });
    var rs = kcState.rules.filter(function (r) { return r.kind !== 'glossary'; });
    var del = function (id) { return admin ? '<button class="kc-x" type="button" data-kc-rmr="' + esc(id) + '" aria-label="' + esc(t('kcur.remove')) + '">\\u2715</button>' : ''; };
    var ro = admin ? '' : '<p class="kc-ro">' + esc(t('kcur.readOnly')) + '</p>';
    host.innerHTML = ro
      + '<section class="kc-card"><h3>' + esc(t('kcur.structure')) + '</h3><p class="kc-sub">' + esc(t('kcur.structureSub')) + '</p>'
      + '<div class="kc-swl">' + sw(!!s.teamOnly, 'data-kc-only', t('kcur.teamOnly')) + '<span>' + esc(t('kcur.teamOnly')) + '</span></div>' + types
      + (admin ? '<div class="kc-add"><input class="so-c-input" id="kcNewType" placeholder="' + esc(t('kcur.newType')) + '"><input class="so-c-input" id="kcNewTypeD" placeholder="' + esc(t('kcur.newTypeD')) + '"><button class="so-c-btn so-c-btn--sm" type="button" id="kcAddType">' + esc(t('kcur.addType')) + '</button></div>' : '')
      + ((s.relationTypes || []).length ? '<h4 class="km__h4 kc-mt">' + esc(t('kcur.relations')) + '</h4><div class="kc-aka">' + s.relationTypes.map(function (r) { return '<span class="kc-tag kc-tag--seen">' + esc(kmRelLabel(r)) + '</span>'; }).join('') + '</div>' : '')
      + '</section>'
      + '<div class="kc-col"><section class="kc-card"><h3>' + esc(t('kcur.glossary')) + '</h3><p class="kc-sub">' + esc(t('kcur.glossarySub')) + '</p>'
      + (gl.length ? gl.map(function (r) { return '<div class="kc-gl"><b>' + esc(r.term) + '</b><span>' + esc(r.text) + '</span>' + del(r.id) + '</div>'; }).join('') : '<div class="km__none">' + esc(t('kcur.nothing')) + '</div>')
      + (admin ? '<div class="kc-add"><input class="so-c-input kc-add__term" id="kcGt" placeholder="' + esc(t('kcur.term')) + '"><input class="so-c-input" id="kcGd" placeholder="' + esc(t('kcur.meaning')) + '"><button class="so-c-btn so-c-btn--sm" type="button" id="kcAddG">' + esc(t('kcur.add')) + '</button></div>' : '')
      + '</section>'
      + '<section class="kc-card"><h3>' + esc(t('kcur.rules')) + '</h3><p class="kc-sub">' + esc(t('kcur.rulesSub')) + '</p>'
      + (rs.length ? rs.map(function (r) { return '<div class="kc-rule"><span>' + esc(r.text) + '</span>' + del(r.id) + '</div>'; }).join('') : '<div class="km__none">' + esc(t('kcur.nothing')) + '</div>')
      + (admin ? '<div class="kc-add"><input class="so-c-input" id="kcRt" placeholder="' + esc(t('kcur.rulePh')) + '"><button class="so-c-btn so-c-btn--sm" type="button" id="kcAddR">' + esc(t('kcur.addRule')) + '</button></div>' : '')
      + '<p class="kc-note">' + esc(t('kcur.retrain')) + '</p></section>'
      + (admin ? '<section class="kc-card"><h3>' + esc(t('kcur.discarded')) + '</h3><p class="kc-sub">' + esc(t('kcur.discardedSub')) + '</p>'
        + (kcState.discarded.length ? kcState.discarded.map(function (x) { return '<div class="kc-rule"><span>' + esc(x.label) + (x.reason ? ' <span class="kc-trow__d">\\u00B7 ' + esc(t('kcur.why.' + x.reason) === 'kcur.why.' + x.reason ? x.reason : t('kcur.why.' + x.reason)) + '</span>' : '') + '</span><button class="so-c-btn so-c-btn--sm" type="button" data-kc-restore="' + esc(x.kind) + '" data-kc-key="' + esc(x.key) + '">' + esc(t('kcur.restore')) + '</button></div>'; }).join('') : '<div class="km__none">' + esc(t('kcur.nothing')) + '</div>')
        + '</section>' : '')
      + '</div>';
    if (!admin) return;
    var reload = function (msg) { if (msg) kcToast(msg); kmState.gcache = {}; kmState.dcache = {}; kmState.types = []; var m = knMount(); if (m) knRenderShell(m); };
    host.querySelectorAll('[data-kc-tog]').forEach(function (b) { b.addEventListener('click', function () {
      var ty = b.getAttribute('data-kc-tog'), ignore = b.classList.contains('is-on');
      kcApi('PUT', '/schema/types/' + encodeURIComponent(ty), { ignored: ignore }).then(function () { reload(ignore ? t('kcur.tIgnored').replace('{t}', kmTypeLabel(ty)) : t('kcur.tSaved')); }).catch(kcFail);
    }); });
    var only = host.querySelector('[data-kc-only]');
    if (only) only.addEventListener('click', function () { kcApi('PUT', '/schema', { teamOnly: !only.classList.contains('is-on') }).then(function () { reload(t('kcur.tSaved')); }).catch(kcFail); });
    var addType = document.getElementById('kcAddType');
    if (addType) addType.addEventListener('click', function () {
      var v = document.getElementById('kcNewType').value.trim(); if (!v) return;
      kcApi('PUT', '/schema/types/' + encodeURIComponent(v), { description: document.getElementById('kcNewTypeD').value.trim(), ignored: false }).then(function () { reload(t('kcur.tSaved')); }).catch(kcFail);
    });
    var addG = document.getElementById('kcAddG');
    if (addG) addG.addEventListener('click', function () {
      var term = document.getElementById('kcGt').value.trim(), text = document.getElementById('kcGd').value.trim(); if (!term || !text) return;
      kcApi('POST', '/rules', { kind: 'glossary', term: term, text: text }).then(function () { reload(t('kcur.tRule')); }).catch(kcFail);
    });
    var addR = document.getElementById('kcAddR');
    if (addR) addR.addEventListener('click', function () {
      var text = document.getElementById('kcRt').value.trim(); if (!text) return;
      kcApi('POST', '/rules', { kind: 'rule', text: text }).then(function () { reload(t('kcur.tRule')); }).catch(kcFail);
    });
    host.querySelectorAll('[data-kc-rmr]').forEach(function (b) { b.addEventListener('click', function () { kcApi('DELETE', '/rules/' + encodeURIComponent(b.getAttribute('data-kc-rmr'))).then(function () { reload(t('kcur.tSaved')); }).catch(kcFail); }); });
    host.querySelectorAll('[data-kc-restore]').forEach(function (b) { b.addEventListener('click', function () {
      kcApi('POST', '/discarded/restore', { kind: b.getAttribute('data-kc-restore'), key: b.getAttribute('data-kc-key') }).then(function () { reload(t('kcur.tRestored')); }).catch(kcFail);
    }); });
    host.querySelectorAll('.kc-add input').forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { var btn = i.parentNode.querySelector('button'); if (btn) btn.click(); } }); });
  }
`;
