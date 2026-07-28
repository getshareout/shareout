/** Reusable JS modules and marketplace skills. */
export const workspace_client_home_views_library_JS = `  // ----- Library — reusable JS modules (workspace + personal) and marketplace skills -----
  var libTab = 'modules';
  var libAttached = {};                                  // skill id -> true (attached to my agent)
  var libSkillMap = {};                                  // skill id -> card object (for the viewer modal)
  var libAgentScope = (window.WSX_WS || '__personal');   // attach scope: workspace id, or personal
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
    var on = !!libAttached[id];
    return '<div class="wsx-sched__actions">'
      + '<button class="wsx-abtn" data-skill-view="' + esc(id) + '" type="button">' + esc(t('library.viewSkill')) + '</button>'
      + '<button class="wsx-abtn' + (on ? ' is-on' : '') + '" data-skill-attach="' + esc(id) + '" type="button">' + esc(on ? t('library.attachedAgent') : t('library.attachAgent')) + '</button>'
      + '</div>';
  }
  function libRecommendedCard(k) {
    return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(k.name) + '</div><span class="wsx-sched__badge ok">' + esc(t('library.official')) + '</span></div>'
      + (k.summary ? '<div class="wsx-sched__meta"><span>' + esc(k.summary) + '</span>' + (k.attribution ? '<span>' + esc(t('library.by')) + ' ' + esc(k.attribution) + '</span>' : '') + '</div>' : '')
      + (k.tags && k.tags.length ? '<div class="wsx-sched__flow">' + k.tags.slice(0, 4).map(function (tg) { return '<span class="wsx-sched__chip">' + esc(tg) + '</span>'; }).join('') + '</div>' : '')
      + libSkillActions(k) + '</div>';
  }
  function libWorkspaceSkillCard(k) {
    return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(k.name) + '</div><span class="wsx-sched__badge ' + (k.installed ? 'ok' : '') + '">' + (k.installed ? esc(t('library.saved')) : '\\u2191 ' + (k.upvotes || 0)) + '</span></div>'
      + (k.summary ? '<div class="wsx-sched__meta"><span>' + esc(k.summary) + '</span></div>' : '')
      + (k.tags && k.tags.length ? '<div class="wsx-sched__flow">' + k.tags.slice(0, 4).map(function (tg) { return '<span class="wsx-sched__chip">' + esc(tg) + '</span>'; }).join('') + '</div>' : '')
      + libSkillActions(k) + '</div>';
  }
  function loadLibSkills() {
    var m = document.getElementById('wsxLibMount'); m.innerHTML = i18nLoad();
    var calls = [
      fetch('/v1/skills/recommended', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/v1/workspaces/' + encodeURIComponent(libAgentScope) + '/agent-skills', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ];
    if (window.WSX_WS) calls.push(fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/skills?sort=top', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
    Promise.all(calls).then(function (res) {
      var rec = (res[0] && res[0].skills) || [], attached = (res[1] && res[1].skills) || [], wss = (res[2] && res[2].skills) || [];
      libAttached = {}; libSkillMap = {};
      attached.forEach(function (s) { libAttached[s.skill_artifact_id] = true; });
      rec.concat(wss).forEach(function (k) { var id = k.artifact_id || k.id; if (id) libSkillMap[id] = k; });
      var h = '';
      if (rec.length) {
        h += '<p class="wsx-lens__intro">' + esc(t('library.recommendedSub')) + '</p>';
        h += rec.map(libRecommendedCard).join('');
      }
      if (window.WSX_WS) {
        h += wss.length ? wss.map(libWorkspaceSkillCard).join('') : '<p class="wsx-lens__intro">' + esc(t('library.noSkills')) + '</p>';
      }
      m.innerHTML = h || i18nEmpty('library.noSkills');
      m.querySelectorAll('[data-skill-view]').forEach(function (b) { b.addEventListener('click', function () { openSkillModal(libSkillMap[b.getAttribute('data-skill-view')]); }); });
      m.querySelectorAll('[data-skill-attach]').forEach(function (b) { b.addEventListener('click', function () { toggleAttach(b.getAttribute('data-skill-attach'), b); }); });
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
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { btn.disabled = false; if (d) { libAttached[id] = true; paintAttachBtns(id, true); } })
        .catch(function () { btn.disabled = false; });
    }
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
        var pre = document.createElement('pre'); pre.className = 'wsx-skill__pre'; pre.textContent = md; mdEl.innerHTML = ''; mdEl.appendChild(pre);
        var on = !!libAttached[id];
        foot.innerHTML = '<span class="wsx-skill__hint">' + esc(t('library.installHint')) + '</span>'
          + '<div class="wsx-skill__btns">'
          + '<button class="wsx-abtn" id="skCopy" type="button">' + esc(t('library.copyMd')) + '</button>'
          + '<button class="wsx-abtn" id="skMd" type="button">' + esc(t('library.downloadMd')) + '</button>'
          + '<button class="wsx-abtn" id="skZip" type="button">' + esc(t('library.downloadZip')) + '</button>'
          + '<button class="wsx-abtn wsx-abtn--primary' + (on ? ' is-on' : '') + '" id="skAttach" data-skill-attach="' + esc(id) + '" type="button">' + esc(on ? t('library.attachedAgent') : t('library.attachAgent')) + '</button>'
          + '</div>';
        document.getElementById('skCopy').addEventListener('click', function () { copyText(md, this); });
        document.getElementById('skMd').addEventListener('click', function () { dlBlob(slug + '.md', new Blob([md], { type: 'text/markdown' })); });
        document.getElementById('skZip').addEventListener('click', function () { dlBlob(slug + '.zip', zipStore(slug + '/SKILL.md', md)); });
        document.getElementById('skAttach').addEventListener('click', function () { toggleAttach(id, this); });
      })
      .catch(function () { var mdEl = document.getElementById('wsxSkillMd'); if (mdEl) mdEl.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function loadLibrary() { if (libTab === 'skills') loadLibSkills(); else loadLibModules(); }
  ws.querySelectorAll('[data-lib-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      ws.querySelectorAll('[data-lib-tab]').forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.add('is-on'); libTab = b.getAttribute('data-lib-tab'); loadLibrary();
    });
  });

`;
