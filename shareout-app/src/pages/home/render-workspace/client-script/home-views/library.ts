/** Reusable JS modules and marketplace skills. */
export const workspace_client_home_views_library_JS = `  // ----- Library — marketplace skills (default) and reusable JS modules -----
  var libTab = 'skills';
  var libAttached = {};                                  // skill id -> pinned version info
  var libSkillMap = {};                                  // skill id -> card object (for the viewer modal)
  var libAgentScope = (window.WSX_WS || '__personal');   // attach scope: workspace id, or personal
  var skState = { q: '', cat: '', sort: 'top', items: [], rec: [] };
  function libModuleCard(x, scope) {
    var ex = (x.exports || []).slice(0, 5).join(', ');
    return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + isvg('<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>') + ' ' + esc(x.name) + ' <span class="wsx-sched__chip">v' + esc(x.version) + '</span></div><span class="wsx-sched__badge">' + esc(scope) + '</span></div>'
      + (ex ? '<div class="wsx-sched__meta"><span>' + esc(t('library.exports')) + ' <code>' + esc(ex) + '</code></span>' + (x.installs != null ? '<span>' + x.installs + ' ' + esc(t('library.imports')) + '</span>' : '') + '</div>' : '')
      + (x.import_url ? '<div class="wsx-sched__actions"><button class="wsx-abtn" data-lib-copy="' + esc(x.import_url) + '" type="button">' + esc(t('library.copyImport')) + '</button></div>' : '') + '</div>';
  }
  function loadLibModules() {
    var m = document.getElementById('wsxLibMount'); m.innerHTML = i18nLoad();
    var calls = [fetch('/v1/me/libraries', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })];
    if (window.WSX_WS) calls.push(fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/libraries', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
    Promise.all(calls).then(function (res) {
      var personal = (res[0] && res[0].modules) || [], wsmods = (res[1] && res[1].modules) || [];
      var h = '';
      if (wsmods.length) h += wsmods.map(function (x) { return libModuleCard(x, t('library.scopeWorkspace')); }).join('');
      if (personal.length) h += personal.map(function (x) { return libModuleCard(x, t('library.scopePersonal')); }).join('');
      h += '<div class="wsx-qa-grid wsx-qa-grid--lens"><button class="wsx-qa" id="wsxLibNew" type="button"><span class="wsx-qa__ic">' + isvg('<path d="M12 5v14M5 12h14"/>') + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('library.newModule')) + '</span><span class="wsx-qa__s">' + esc(t('library.newModuleSub')) + '</span></span></button></div>';
      m.innerHTML = (wsmods.length || personal.length) ? h : '<p class="wsx-lens__intro">' + esc(t('library.noModules')) + '</p>' + h;
      m.querySelectorAll('[data-lib-copy]').forEach(function (b) { b.addEventListener('click', function () { copyText(b.getAttribute('data-lib-copy'), b); b.textContent = t('library.copied'); }); });
      var ln = document.getElementById('wsxLibNew'); if (ln) ln.addEventListener('click', openModuleModal);
    });
  }
  // View + attach-to-my-agent actions, shared by official and workspace skill cards.
  function libSkillActions(k) {
    var id = k.artifact_id || k.id; if (!id) return '';
    var a = libAttached[id], on = !!a;
    // A pinned attach that is behind the published version is the bug users could not
    // see: the modal showed the new body while the agent kept loading the old one.
    var stale = on && a.outdated;
    return '<div class="wsx-sched__actions">'
      + '<button class="wsx-abtn" data-skill-view="' + esc(id) + '" type="button">' + esc(t('library.viewSkill')) + '</button>'
      + (k.official ? '' : '<button class="wsx-abtn' + (k.voted ? ' is-on' : '') + '" data-skill-vote="' + esc(id) + '" type="button">\\u2191 <span>' + (k.upvotes || 0) + '</span></button>')
      + '<button class="wsx-abtn' + (on ? ' is-on' : '') + '" data-skill-attach="' + esc(id) + '" type="button">' + esc(on ? t('library.attachedAgent') : t('library.attachAgent')) + '</button>'
      + (stale ? '<button class="wsx-abtn wsx-abtn--primary" data-skill-sync="' + esc(id) + '" type="button">' + esc(t('library.updateToV').replace('{v}', a.latest_version_no)) + '</button>' : '')
      + '</div>';
  }
  function libPolicyChip(p) {
    if (p === 'workspace') return '<span class="wsx-sched__chip">' + esc(t('library.policyWorkspace')) + '</span>';
    if (p === 'approval') return '<span class="wsx-sched__chip">' + esc(t('library.policyApproval')) + '</span>';
    return '';
  }
  function libRecommendedCard(k) {
    return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(k.name) + '</div><span class="wsx-sched__badge ok">' + esc(t('library.official')) + '</span></div>'
      + (k.summary ? '<div class="wsx-sched__meta"><span>' + esc(k.summary) + '</span>' + (k.attribution ? '<span>' + esc(t('library.by')) + ' ' + esc(k.attribution) + '</span>' : '') + '</div>' : '')
      + (k.tags && k.tags.length ? '<div class="wsx-sched__flow">' + k.tags.slice(0, 4).map(function (tg) { return '<span class="wsx-sched__chip">' + esc(tg) + '</span>'; }).join('') + '</div>' : '')
      + libSkillActions(k) + '</div>';
  }
  function libWorkspaceSkillCard(k) {
    var open = k.open_changes || 0;
    return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(k.name) + ' <span class="wsx-sched__chip">v' + (k.version_no || 1) + '</span>' + libPolicyChip(k.edit_policy) + '</div>'
      + '<span class="wsx-sched__badge ' + (open ? 'warn' : (k.installed ? 'ok' : '')) + '">' + (open ? esc(t('library.openChanges').replace('{n}', open)) : (k.installed ? esc(t('library.saved')) : '\\u2191 ' + (k.upvotes || 0))) + '</span></div>'
      + (k.summary ? '<div class="wsx-sched__meta"><span>' + esc(k.summary) + '</span></div>' : '')
      + ((k.tags && k.tags.length) || k.category ? '<div class="wsx-sched__flow">' + (k.category ? '<span class="wsx-sched__chip">' + esc(k.category) + '</span>' : '') + (k.tags || []).slice(0, 4).map(function (tg) { return '<span class="wsx-sched__chip">' + esc(tg) + '</span>'; }).join('') + '</div>' : '')
      + libSkillActions(k) + '</div>';
  }
  function skCategories() {
    var seen = {}, out = [];
    skState.items.forEach(function (k) { if (k.category && !seen[k.category]) { seen[k.category] = 1; out.push(k.category); } });
    return out.sort();
  }
  function skToolbar() {
    var cats = skCategories().map(function (c) { return '<option value="' + esc(c) + '"' + (skState.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var sorts = [['top', 'library.sortTop'], ['new', 'library.sortNew'], ['installs', 'library.sortInstalls']].map(function (s) {
      return '<option value="' + s[0] + '"' + (skState.sort === s[0] ? ' selected' : '') + '>' + esc(t(s[1])) + '</option>';
    }).join('');
    return '<div class="wsx-cat__controls"><div class="wsx-cat__bar">'
      + '<input class="wsx-cat__search" id="skSearch" type="search" placeholder="' + esc(t('library.searchPlaceholder')) + '" autocomplete="off">'
      + '<select class="wsx-admin__role wsx-cat__sel" id="skCat"><option value="">' + esc(t('library.allCategories')) + '</option>' + cats + '</select>'
      + '<select class="wsx-admin__role wsx-cat__sel" id="skSort">' + sorts + '</select>'
      + (window.WSX_WS ? '<button class="wsx-abtn wsx-abtn--primary" id="skNew" type="button">' + esc(t('library.newSkill')) + '</button><button class="wsx-abtn" id="skInstall" type="button">' + esc(t('library.installAll')) + '</button>' : '')
      + '<span class="wsx-cat__count" id="skCount"></span>'
      + '</div></div>';
  }
  function skFiltered() {
    var q = skState.q, cat = skState.cat;
    var out = skState.items.filter(function (k) {
      if (cat && k.category !== cat) return false;
      if (!q) return true;
      var hay = (k.name + ' ' + (k.summary || '') + ' ' + (k.category || '') + ' ' + (k.tags || []).join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (skState.sort === 'new') return out;                                        // server already returned newest-first
    if (skState.sort === 'installs') return out.slice().sort(function (a, b) { return (b.installs || 0) - (a.installs || 0); });
    return out;
  }
  function skRenderList() {
    var el = document.getElementById('skList'); if (!el) return;
    var list = skFiltered();
    el.innerHTML = list.length ? list.map(libWorkspaceSkillCard).join('') : '<p class="wsx-lens__intro">' + esc(t('library.noSkills')) + '</p>';
    var c = document.getElementById('skCount'); if (c) c.textContent = list.length ? String(list.length) : '';
    skBindCards(el);
  }
  function skBindCards(el) {
    el.querySelectorAll('[data-skill-view]').forEach(function (b) { b.addEventListener('click', function () { openSkillModal(libSkillMap[b.getAttribute('data-skill-view')]); }); });
    el.querySelectorAll('[data-skill-attach]').forEach(function (b) { b.addEventListener('click', function () { toggleAttach(b.getAttribute('data-skill-attach'), b); }); });
    el.querySelectorAll('[data-skill-sync]').forEach(function (b) { b.addEventListener('click', function () { syncAttached(b.getAttribute('data-skill-sync'), b); }); });
    el.querySelectorAll('[data-skill-vote]').forEach(function (b) { b.addEventListener('click', function () { toggleVote(b.getAttribute('data-skill-vote'), b); }); });
  }
  function loadLibSkills() {
    var m = document.getElementById('wsxLibMount'); m.innerHTML = i18nLoad();
    var calls = [
      fetch('/v1/skills/recommended', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/v1/workspaces/' + encodeURIComponent(libAgentScope) + '/agent-skills', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ];
    if (window.WSX_WS) calls.push(fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/skills?sort=' + encodeURIComponent(skState.sort) + '&limit=100', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
    Promise.all(calls).then(function (res) {
      skState.rec = (res[0] && res[0].skills) || [];
      var attached = (res[1] && res[1].skills) || [];
      skState.items = (res[2] && res[2].skills) || [];
      libAttached = {}; libSkillMap = {};
      attached.forEach(function (s) { libAttached[s.skill_artifact_id] = s; });
      skState.rec.concat(skState.items).forEach(function (k) { var id = k.artifact_id || k.id; if (id) libSkillMap[id] = k; });
      var h = '';
      if (skState.rec.length) {
        h += '<p class="wsx-lens__intro">' + esc(t('library.recommendedSub')) + '</p>';
        h += '<div id="skRec">' + skState.rec.map(libRecommendedCard).join('') + '</div>';
      }
      if (window.WSX_WS) h += skToolbar() + '<div id="skList"></div>';
      m.innerHTML = h || i18nEmpty('library.noSkills');
      var rec = document.getElementById('skRec'); if (rec) skBindCards(rec);
      var s = document.getElementById('skSearch');
      if (s) s.addEventListener('input', function () { skState.q = s.value.trim().toLowerCase(); skRenderList(); });
      var cat = document.getElementById('skCat'); if (cat) cat.addEventListener('change', function () { skState.cat = cat.value; skRenderList(); });
      var so = document.getElementById('skSort'); if (so) so.addEventListener('change', function () { skState.sort = so.value; loaded.library = 0; loadLibSkills(); });
      var nw = document.getElementById('skNew'); if (nw) nw.addEventListener('click', openNewSkillModal);
      var inst = document.getElementById('skInstall'); if (inst) inst.addEventListener('click', openInstallModal);
      if (window.WSX_WS) skRenderList();
    }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function paintAttachBtns(id, on) {
    document.querySelectorAll('[data-skill-attach="' + id + '"]').forEach(function (b) {
      b.classList.toggle('is-on', on); b.textContent = on ? t('library.attachedAgent') : t('library.attachAgent');
    });
  }
  function toggleAttach(id, btn) {
    if (!id || btn.disabled) return;
    var on = !!libAttached[id]; btn.disabled = true;
    var url = '/v1/workspaces/' + encodeURIComponent(libAgentScope) + '/agent-skills';
    if (on) {
      fetch(url + '/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { return r.ok; }).then(function (ok) { btn.disabled = false; if (ok) { delete libAttached[id]; paintAttachBtns(id, false); } })
        .catch(function () { btn.disabled = false; });
    } else {
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skill_artifact_id: id }) })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { btn.disabled = false; if (d) { libAttached[id] = { skill_artifact_id: id, version_no: d.version_no, latest_version_no: d.version_no, outdated: false }; paintAttachBtns(id, true); } })
        .catch(function () { btn.disabled = false; });
    }
  }
  // Re-pin an attached skill to the published version — the half that was missing.
  function syncAttached(id, btn) {
    if (!id || btn.disabled) return;
    btn.disabled = true;
    fetch('/v1/workspaces/' + encodeURIComponent(libAgentScope) + '/agent-skills/' + encodeURIComponent(id), { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        btn.disabled = false;
        if (!d) return;
        libAttached[id] = { skill_artifact_id: id, version_no: d.version_no, latest_version_no: d.version_no, outdated: false };
        btn.remove();
      })
      .catch(function () { btn.disabled = false; });
  }
  function toggleVote(id, btn) {
    var k = libSkillMap[id]; if (!k || btn.disabled) return;
    var on = !!k.voted; btn.disabled = true;
    fetch('/v1/artifacts/' + encodeURIComponent(id) + '/skill/vote', { method: on ? 'DELETE' : 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        btn.disabled = false; if (!d) return;
        k.voted = !on; k.upvotes = (d.upvotes != null ? d.upvotes : (k.upvotes || 0) + (on ? -1 : 1));
        btn.classList.toggle('is-on', k.voted);
        var n = btn.querySelector('span'); if (n) n.textContent = k.upvotes;
      })
      .catch(function () { btn.disabled = false; });
  }
  // Store-only ZIP (no compression) — a Claude skill folder is just <slug>/SKILL.md.
  // ponytail: store method + one file is plenty for a single markdown doc; no zip lib.
  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      var c = (crc ^ bytes[i]) & 0xFF;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(path, text) {
    var enc = new TextEncoder(), name = enc.encode(path), data = enc.encode(text), crc = crc32(data);
    function u16(n) { return [n & 255, (n >>> 8) & 255]; }
    function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    var local = new Uint8Array([].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
    var central = new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0)));
    var localSize = local.length + name.length + data.length, centralSize = central.length + name.length;
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(centralSize), u32(localSize), u16(0)));
    return new Blob([local, name, data, central, name, end], { type: 'application/zip' });
  }
  function dlBlob(filename, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function openNewSkillModal() {
    var body = '<div class="wsx-cform">' + fld(t('library.skillName'), 'sk_name', t('library.skillNamePh'))
      + fld(t('library.skillCategory'), 'sk_cat', t('library.skillCategoryPh'))
      + fta(t('library.skillBody'), 'sk_md', t('library.skillBodyPh'), 12)
      + '<p class="wsx-field__note">' + esc(t('library.skillBodyNote')) + '</p>'
      + '<div class="wsx-cform__err" id="sk_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="sk_submit" type="button">' + esc(t('library.publishSkill')) + '</button></div></div>';
    var modal = wsxModal(t('library.newSkill'), body);
    document.getElementById('sk_submit').addEventListener('click', function () {
      var sub = this, err = document.getElementById('sk_err'); err.textContent = '';
      var name = cv('sk_name'), md = cv('sk_md');
      if (!name) { err.textContent = t('library.enterSkillName'); return; }
      if (!md) { err.textContent = t('library.enterSkillBody'); return; }
      var b = { name: name, markdown: md }; var c = cv('sk_cat'); if (c) b.category = c;
      sub.disabled = true;
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/skills', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) { sub.disabled = false; if (!res.ok) { err.textContent = (res.d && res.d.error) || t('modal.failedPublish'); return; } modal.close(); loaded.library = 0; loadLibSkills(); })
        .catch(function () { sub.disabled = false; err.textContent = t('modal.networkError'); });
    });
  }
  // The re-sync story: one command that writes the whole catalog where the agent looks.
  function openInstallModal() {
    var cmd = 'curl -fsSL ' + location.origin + '/v1/skills/install.sh | sh -s -- --workspace ' + (window.WSX_WS || '');
    var body = '<div class="wsx-skill"><p class="wsx-lens__intro">' + esc(t('library.installIntro')) + '</p>'
      + '<pre class="wsx-skill__pre" id="skCmd">' + esc(cmd) + '</pre>'
      + '<p class="wsx-field__note">' + esc(t('library.installNote')) + '</p>'
      + '<div class="wsx-skill__btns"><button class="wsx-abtn wsx-abtn--primary" id="skCmdCopy" type="button">' + esc(t('library.copyCommand')) + '</button></div></div>';
    wsxModal(t('library.installAll'), body);
    document.getElementById('skCmdCopy').addEventListener('click', function () { copyText(cmd, this); });
  }
  function skPolicySelect(current) {
    return ['owner_only', 'workspace', 'approval'].map(function (p) {
      return '<option value="' + p + '"' + (current === p ? ' selected' : '') + '>' + esc(t('library.policy_' + p)) + '</option>';
    }).join('');
  }
  function skEditorPane(id, md, mode) {
    // mode 'edit' saves a new version; mode 'propose' opens a change request.
    return '<div class="wsx-cform"><label class="wsx-field"><span class="wsx-field__lbl">' + esc(t(mode === 'edit' ? 'library.editBody' : 'library.proposeBody')) + '</span>'
      + '<textarea class="wsx-field__in wsx-field__ta" id="skEditTa" rows="14"></textarea></label>'
      + (mode === 'propose' ? fld(t('library.proposeNote'), 'skEditNote', t('library.proposeNotePh')) : '')
      + '<div class="wsx-cform__err" id="skEditErr"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn" id="skEditCancel" type="button">' + esc(t('common.cancel')) + '</button>'
      + '<button class="wsx-abtn wsx-abtn--primary" id="skEditSave" type="button">' + esc(t(mode === 'edit' ? 'library.saveVersion' : 'library.sendProposal')) + '</button></div></div>';
  }
  function skRenderChanges(id, list, canReview) {
    if (!list.length) return '<p class="wsx-lens__intro">' + esc(t('library.noChanges')) + '</p>';
    return list.map(function (c) {
      var open = c.status === 'open';
      return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(c.title || t('library.changeUntitled')) + '</div>'
        + '<span class="wsx-sched__badge ' + (open ? 'warn' : 'ok') + '">' + esc(c.status) + '</span></div>'
        + '<div class="wsx-sched__meta"><span>' + esc(t('library.proposedBy')) + ' ' + esc(c.proposed_by || '\\u2014') + '</span><span>v' + c.base_version_no + '</span></div>'
        + (c.note ? '<div class="wsx-sched__meta"><span>' + esc(c.note) + '</span></div>' : '')
        + (open && canReview ? '<div class="wsx-sched__actions"><button class="wsx-abtn" data-ch-view="' + esc(c.id) + '" type="button">' + esc(t('library.viewProposal')) + '</button>'
          + '<button class="wsx-abtn wsx-abtn--primary" data-ch-merge="' + esc(c.id) + '" type="button">' + esc(t('library.merge')) + '</button>'
          + '<button class="wsx-abtn" data-ch-reject="' + esc(c.id) + '" type="button">' + esc(t('library.reject')) + '</button></div>' : '')
        + '</div>';
    }).join('');
  }
  function openSkillModal(k) {
    if (!k) return;
    var id = k.artifact_id || k.id, slug = k.slug || id;
    wsxModal(k.name, '<div class="wsx-skill"><div class="wsx-skill__md" id="wsxSkillMd">' + i18nLoad() + '</div><div class="wsx-skill__foot" id="wsxSkillFoot"></div></div>');
    fetch('/v1/skills/' + encodeURIComponent(id) + '/markdown', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var mdEl = document.getElementById('wsxSkillMd'), foot = document.getElementById('wsxSkillFoot'); if (!mdEl) return;
        if (!d || d.markdown == null) { mdEl.innerHTML = i18nError('common.couldNotLoad'); return; }
        var md = d.markdown;
        // Rendered server-side by src/skills/render.ts, which escapes the source before
        // it emits a single tag — never inject a skill body as raw markup here.
        function paintBody() { mdEl.innerHTML = '<div class="wsx-skill__doc">' + (d.html || '') + '</div>'; }
        paintBody();
        var on = !!libAttached[id];
        var actions = '<button class="wsx-abtn" id="skCopy" type="button">' + esc(t('library.copyMd')) + '</button>'
          + '<button class="wsx-abtn" id="skMd" type="button">' + esc(t('library.downloadMd')) + '</button>'
          + '<button class="wsx-abtn" id="skZip" type="button">' + esc(t('library.downloadZip')) + '</button>'
          + (d.can_edit ? '<button class="wsx-abtn" id="skEdit" type="button">' + esc(t('library.edit')) + '</button>' : '')
          + (d.can_propose ? '<button class="wsx-abtn" id="skPropose" type="button">' + esc(t('library.propose')) + '</button>' : '')
          + (d.can_review || d.can_propose ? '<button class="wsx-abtn" id="skChanges" type="button">' + esc(t('library.changes')) + '</button>' : '')
          + '<button class="wsx-abtn wsx-abtn--primary' + (on ? ' is-on' : '') + '" id="skAttach" data-skill-attach="' + esc(id) + '" type="button">' + esc(on ? t('library.attachedAgent') : t('library.attachAgent')) + '</button>';
        var policyRow = d.can_set_policy
          ? '<label class="wsx-field wsx-field--inline"><span class="wsx-field__lbl">' + esc(t('library.whoCanEdit')) + '</span><select class="wsx-field__in" id="skPolicy">' + skPolicySelect(d.edit_policy) + '</select></label>'
          : '<span class="wsx-skill__hint">' + esc(t('library.policy_' + (d.edit_policy || 'owner_only'))) + '</span>';
        foot.innerHTML = '<span class="wsx-skill__hint">v' + (d.version_no || 1) + ' \\u00b7 ' + esc(t('library.installHint')) + '</span>'
          + policyRow + '<div class="wsx-skill__btns">' + actions + '</div>';

        document.getElementById('skCopy').addEventListener('click', function () { copyText(md, this); });
        document.getElementById('skMd').addEventListener('click', function () { dlBlob(slug + '.md', new Blob([md], { type: 'text/markdown' })); });
        document.getElementById('skZip').addEventListener('click', function () { dlBlob(slug + '.zip', zipStore(slug + '/SKILL.md', md)); });
        document.getElementById('skAttach').addEventListener('click', function () { toggleAttach(id, this); });
        var pol = document.getElementById('skPolicy');
        if (pol) pol.addEventListener('change', function () {
          fetch('/v1/skills/' + encodeURIComponent(id) + '/policy', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edit_policy: pol.value }) })
            .then(function () { loaded.library = 0; }).catch(function () {});
        });

        function openEditor(mode) {
          mdEl.innerHTML = skEditorPane(id, md, mode);
          var ta = document.getElementById('skEditTa'); ta.value = md;
          document.getElementById('skEditCancel').addEventListener('click', paintBody);
          document.getElementById('skEditSave').addEventListener('click', function () {
            var sub = this, err = document.getElementById('skEditErr'); err.textContent = '';
            var next = ta.value.trim();
            if (!next) { err.textContent = t('library.enterSkillBody'); return; }
            sub.disabled = true;
            var req = mode === 'edit'
              ? fetch('/v1/skills/' + encodeURIComponent(id) + '/markdown', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: next }) })
              : fetch('/v1/skills/' + encodeURIComponent(id) + '/changes', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: next, note: cv('skEditNote') }) });
            req.then(function (r) { return r.json().then(function (j) { return { ok: r.ok, d: j }; }); })
              .then(function (res) {
                sub.disabled = false;
                if (!res.ok) { err.textContent = (res.d && res.d.error) || t('modal.failedPublish'); return; }
                loaded.library = 0;
                if (mode === 'edit') { md = next; d.markdown = next; }
                mdEl.innerHTML = '<p class="wsx-lens__intro">' + esc(t(mode === 'edit' ? 'library.savedVersion' : 'library.proposalSent')) + '</p>';
              })
              .catch(function () { sub.disabled = false; err.textContent = t('modal.networkError'); });
          });
        }
        var eb = document.getElementById('skEdit'); if (eb) eb.addEventListener('click', function () { openEditor('edit'); });
        var pb = document.getElementById('skPropose'); if (pb) pb.addEventListener('click', function () { openEditor('propose'); });
        var cb = document.getElementById('skChanges');
        if (cb) cb.addEventListener('click', function () {
          mdEl.innerHTML = i18nLoad();
          fetch('/v1/skills/' + encodeURIComponent(id) + '/changes', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (cd) {
              if (!cd) { mdEl.innerHTML = i18nError('common.couldNotLoad'); return; }
              mdEl.innerHTML = '<div class="wsx-skill__changes">' + skRenderChanges(id, cd.changes || [], cd.can_review) + '</div>'
                + '<div class="wsx-cform__foot"><button class="wsx-abtn" id="skBackBody" type="button">' + esc(t('library.backToSkill')) + '</button></div>';
              document.getElementById('skBackBody').addEventListener('click', paintBody);
              function review(changeId, action) {
                fetch('/v1/skills/' + encodeURIComponent(id) + '/changes/' + encodeURIComponent(changeId), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action }) })
                  .then(function () { loaded.library = 0; cb.click(); }).catch(function () {});
              }
              mdEl.querySelectorAll('[data-ch-merge]').forEach(function (b) { b.addEventListener('click', function () { review(b.getAttribute('data-ch-merge'), 'merge'); }); });
              mdEl.querySelectorAll('[data-ch-reject]').forEach(function (b) { b.addEventListener('click', function () { review(b.getAttribute('data-ch-reject'), 'reject'); }); });
              mdEl.querySelectorAll('[data-ch-view]').forEach(function (b) {
                b.addEventListener('click', function () {
                  fetch('/v1/skills/' + encodeURIComponent(id) + '/changes/' + encodeURIComponent(b.getAttribute('data-ch-view')), { credentials: 'same-origin' })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (one) {
                      if (!one) return;
                      var pre = document.createElement('pre'); pre.className = 'wsx-skill__pre'; pre.textContent = one.change.markdown || '';
                      mdEl.insertBefore(pre, mdEl.firstChild);
                    }).catch(function () {});
                });
              });
            }).catch(function () { mdEl.innerHTML = i18nError('common.couldNotLoad'); });
        });
      })
      .catch(function () { var mdEl = document.getElementById('wsxSkillMd'); if (mdEl) mdEl.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function loadLibrary() { if (libTab === 'modules') loadLibModules(); else loadLibSkills(); }
  ws.querySelectorAll('[data-lib-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      ws.querySelectorAll('[data-lib-tab]').forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.add('is-on'); libTab = b.getAttribute('data-lib-tab'); loadLibrary();
    });
  });

`;
