/** Right rail Inspector panels. */
export const workspace_client_inspector_JS = `  // ===== right rail = the working Inspector (Activity on Home; Details/Comments/Automate/History on a doc) =====
  var needsEvents = [], pulseEvents = [], WSX_WIN = '7d';
  var GEAR_SVG = isvg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
  var rtabsEl = document.getElementById('wsxRtabs');
  var rbodyEl = document.getElementById('wsxRbody');
  var rActive = 'activity';
  // Per-artifact caches so switching tabs doesn't refetch / flash a loader.
  var metaCache = {}, statsCache = {}, cmtCache = {}, autoCache = {};
  function isvg(p) { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var SVG_OPEN = '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>';
  var SVG_EDIT = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>';
  var SVG_LINK = '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.2-1.2"/>';
  var SVG_STAR = '<path d="M12 17.3l-5.5 3.3 1.5-6.3-4.9-4.2 6.4-.5L12 3.5l2.5 5.9 6.4.5-4.9 4.2 1.5 6.3z"/>';
  var SVG_TRASH = '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>';
  var SVG_EMOJI = '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><line x1="9" y1="9.2" x2="9.01" y2="9.2"/><line x1="15" y1="9.2" x2="15.01" y2="9.2"/>';
  var SVG_DOWNLOAD = '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>';
  var SVG_SEND = '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>';
  var EMOJI_SET = ['\\uD83D\\uDC4D','\\u2764\\uFE0F','\\uD83D\\uDE04','\\uD83C\\uDF89','\\uD83D\\uDC40','\\uD83D\\uDE4F','\\uD83D\\uDD25','\\u2705','\\u26A0\\uFE0F','\\uD83D\\uDE80','\\uD83D\\uDCA1','\\uD83D\\uDC4F','\\uD83E\\uDD14','\\uD83D\\uDE0D','\\uD83D\\uDE05','\\uD83D\\uDE0E','\\uD83D\\uDCAF','\\uD83D\\uDE4C','\\uD83D\\uDC4C','\\uD83D\\uDE2C'];

  document.addEventListener('click', function () { var m = rbodyEl.querySelector('.wsx__deliver-menu'); if (m) m.hidden = true; });

  // Activity-feed renderers (feedText, groupFeed, tlRow, pulseTlRow, renderActivity,
  // wireActivityControls) live in inspector-activity.ts — same IIFE scope, concatenated
  // just before this module (split out for the client-script size cap).
  function renderRTabs(items) {
    rtabsEl.innerHTML = items.map(function (t) {
      return '<button class="wsx__rtab' + (t.key === rActive ? ' is-active' : '') + '" data-rtab="' + t.key + '" type="button" title="' + esc(t.label) + '">' + (t.dot ? '<span class="wsx__live-dot"></span>' : '') + esc(t.label) + '</button>';
    }).join('');
    var on = rtabsEl.querySelector('.is-active'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    rtabsEl.querySelectorAll('[data-rtab]').forEach(function (b) { b.addEventListener('click', function () { rActive = b.getAttribute('data-rtab'); paintRail(); }); });
  }
  function paintRail() {
    if (!activeArt) {
      // Home: nothing to inspect — hide the right rail; Activity lives in a canvas widget.
      ws.classList.add('is-home');
      return;
    }
    ws.classList.remove('is-home');
    if (panes[activeKey] && panes[activeKey].mode === 'edit') {
      rActive = 'edit';
      renderRTabs([{ key: 'edit', label: t('inspector.editing') }]);
      renderEditPanel(panes[activeKey]);
    } else {
      // Data: what the page reads and where it comes from (lazy chunk 'data'); HTML pages only.
      var withData = !activeArt.type || activeArt.type === 'html';
      if (['details', 'comments', 'automate', 'history'].concat(withData ? ['data'] : []).indexOf(rActive) < 0) rActive = 'details';
      renderRTabs([{ key: 'details', label: t('inspector.details') }].concat(withData ? [{ key: 'data', label: t('inspector.data') }] : [], [{ key: 'comments', label: t('inspector.comments') }, { key: 'automate', label: t('inspector.automate') }, { key: 'history', label: t('inspector.history') }]));
      if (rActive !== 'data') dataClear();
      if (rActive === 'data') renderData(activeArt);
      else if (rActive === 'comments') renderComments(activeArt);
      else if (rActive === 'automate') renderAutomate(activeArt);
      else if (rActive === 'history') renderHistory(activeArt);
      else renderDetails(activeArt);
    }
  }

  // PATCH /v1/artifacts/:id → parsed JSON; rejects on a non-ok response (for optimistic()).
  function patchArtifact(id, body) {
    return fetch('/v1/artifacts/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return {}; }); });
  }
  function setTabLabel(key, label) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) { tabs[i].label = label; }
    renderTabs(); saveTabs();
  }

  // ----- Details -----
  // adoptMeta / fetchMeta (artifact meta + access, shared with the stage) live in inspector-details.ts.
  function railRetry(k, onRetry) {
    rbodyEl.innerHTML = '<div class="wsx__details"><div class="wsx-empty">' + esc(t(k)) + ' <button class="wsx-link" type="button" data-rail-retry>' + esc(t('common.retry')) + '</button></div></div>';
    rbodyEl.querySelector('[data-rail-retry]').addEventListener('click', onRetry);
  }
  function renderDetails(art) {
    if (art.id && metaCache[art.id]) { paintDetails(art, metaCache[art.id]); return; }
    rbodyEl.innerHTML = '<div class="wsx__details">' + i18nLoad() + '</div>';
    fetchMeta(art, function (d) {
      if (activeArt !== art) return;
      if (d) paintDetails(art, d); else railRetry('inspector.detailsFailed', function () { renderDetails(art); });
    });
  }
  function iconBtn(act, title, path, extra) {
    return '<button class="wsx-det__icon ' + (extra || '') + '" data-iact="' + act + '" type="button" data-tip="' + esc(title) + '" aria-label="' + esc(title) + '">' + isvg(path) + '</button>';
  }
  function fmtDate(s) { if (!s) return '\\u2014'; var ts = Date.parse(s); if (!ts) return '\\u2014'; var d = new Date(ts); return d.toLocaleDateString(locTag(), { year: 'numeric', month: 'short', day: 'numeric' }); }
  function visName(k) { return t('inspector.visName.' + k); }
  function visCaption(k) { return t('inspector.visCaption.' + k); }
  // Open visibility restricts external CDNs (CSP allowlist); nudge private+collaborators to lift it.
  function visSub(k) { var c = visCaption(k); return k === 'public' ? c + ' ' + t('inspector.visCdnHint') : c; }
  // "Shared with" empty-state title tracks visibility so it never contradicts the badge (Public but "only you see").
  function shareEmptyTitle(v) { return v === 'private' ? t('inspector.onlyYouSee') : visCaption(v === 'unlisted' ? 'public' : v); }
  // Visibility segmented control — shared by the Details rail and the Share popover.
  function visBlockHtml(editable, visOpts, visCur) {
    return editable
      ? '<div class="wsx-vis-seg" id="wsxVisSeg" role="radiogroup" aria-label="' + esc(t('inspector.visibility')) + '">'
        + visOpts.map(function (o) { return '<button data-vis="' + o + '" role="radio" aria-checked="' + (o === visCur ? 'true' : 'false') + '" type="button" class="' + (o === visCur ? 'is-sel vk-' + o : '') + '"><span class="dot"></span>' + esc(visName(o)) + '</button>'; }).join('')
        + '</div><div class="wsx-vis-seg__sub" id="wsxVisSub">' + esc(visSub(visCur)) + '</div>'
      : '<span class="wsx-det__type">' + esc(visName(visCur)) + '</span>';
  }
  function wireVis(root, art, visCur) {
    var seg = root.querySelector('#wsxVisSeg');
    if (seg) {
      var subEl = root.querySelector('#wsxVisSub');
      var applyVis = function (v) {
        seg.querySelectorAll('[data-vis]').forEach(function (b) { var o = b.getAttribute('data-vis'), on = o === v; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.className = on ? 'is-sel vk-' + o : ''; });
        if (subEl) subEl.textContent = visSub(v);
        var etEl = root.querySelector('#wsxShareEmptyT');
        if (etEl) etEl.textContent = shareEmptyTitle(v);
        if (metaCache[art.id]) metaCache[art.id].visibility = v;
      };
      seg.querySelectorAll('[data-vis]').forEach(function (b) {
        b.addEventListener('click', function () {
          var next = b.getAttribute('data-vis'), prev = visCur;
          seg.querySelectorAll('[data-vis]').forEach(function (x) { if (x.classList.contains('is-sel')) prev = x.getAttribute('data-vis'); });
          if (next === prev) return;
          optimistic({
            key: 'vis:' + art.id,
            apply: function () { applyVis(next); },
            rollback: function () { applyVis(prev); },
            request: function () { return patchArtifact(art.id, { visibility: next }); },
            error: t('cards.visFailed'),
            done: function (j) {
              var applied = (j && j.visibility) || next;
              if (j && j.message) wsxToast(j.message, true);
              else wsxToast(t('inspector.visToast.' + (applied === 'unlisted' ? 'public' : applied)));
              if (applied !== next) applyVis(applied); // server overrode (moderation)
            },
          });
        });
      });
    }
  }

  // Details helpers (sec, wireSecs, aboutHtml, wsxToast, copyText…) live in inspector-details.ts.
  function paintDetails(art, meta) {
    var editable = !!(meta && meta.can_edit);
    var name = (meta && meta.name) || art.name || t('inspector.artifact');
    var desc = (meta && meta.description) || '';
    var vis = (meta && meta.visibility) || '';
    var slug = (meta && meta.slug) || art.slug;
    var type = (meta && meta.artifact_type) || art.type || '';
    var openUrl = '/a/' + encodeURIComponent(slug) + '/';
    var fullUrl = (meta && meta.url) || (location.origin + openUrl);
    var fav = meta && meta.is_favorite;
    var ce = editable ? ' contenteditable="true" spellcheck="false"' : '';
    var hasWs = !!(meta && meta.workspace_id);
    var visOpts = ['private'].concat(hasWs ? ['workspace'] : [], ['public']);
    var visCur = (vis === 'unlisted' ? 'public' : vis) || 'private';

    var favTip = fav ? t('inspector.favRemove') : t('inspector.favAdd');
    var star = meta ? '<button class="wsx-det__star' + (fav ? ' is-on' : '') + '" data-iact="fav" type="button" data-tip="' + esc(favTip) + '" aria-label="' + esc(favTip) + '">' + isvg(SVG_STAR) + '</button>' : '';
    var visBlock = visBlockHtml(editable, visOpts, visCur);

    // 1 identity (title, description, meta) → 2 actions → 3 held notice → 4 sections.
    var h = '<div class="wsx__details"><div class="wsx-det__head">';
    h += '<div class="wsx-det__hrow"><div class="wsx-det__name"' + ce + ' data-edit="name">' + esc(name) + '</div>' + star + '</div>';
    if (desc || editable) h += '<div class="wsx-det__desc"' + ce + ' data-edit="description" data-ph="' + esc(t('inspector.addDescription')) + '">' + esc(desc) + '</div>';
    if (meta) h += aboutHtml(meta, type, vis);
    if (!editable) h += visBlock;
    h += '<div class="wsx-det__acts">'
      + iconBtn('open', t('inspector.act.open'), SVG_OPEN)
      + (editable ? iconBtn('edit', t('inspector.act.edit'), SVG_EDIT) : '')
      + iconBtn('copy', t('inspector.act.copy'), SVG_LINK)
      // A PDF has no viewer shell, so a converted deck's "Download original" lives here.
      + (meta && meta.original && type === 'pdf' ? iconBtn('original', t('inspector.act.original'), SVG_DOWNLOAD) : '')
      + (meta && meta.can_delete ? iconBtn('trash', t('inspector.act.trash'), SVG_TRASH, 'is-danger') : '')
      + '</div></div>';
    // Held banner: meta.moderation reaches only the owner/admin of a held page.
    if (meta && meta.moderation) {
      var mod = meta.moderation;
      h += '<div class="wsx-det__modnote' + (mod.status === 'blocked' ? ' is-err' : '') + '"><strong>' + esc(mod.status === 'blocked' ? t('inspector.modBlocked') : t('cards.underReview')) + '</strong>'
        + (mod.reason ? ' \\u00B7 ' + esc(mod.reason) : '') + '<div>' + esc(mod.message) + '</div></div>';
    }
    h += '<div class="wsx-det__secs" id="wsxSecs">'
      + sec('share', t('inspector.sharedWith'), t('inspector.sharedWithHelp'), (editable ? visBlock : '') + '<div class="wsx-det__chips wsx-det__sharecard" id="wsxShare"></div>')
      + sec('approvals', t('review.approvals'), t('review.approvalsHelp'), '<div id="wsxApprove"></div>')
      + pagesHtml(meta, art)
      + (editable ? sec('organize', t('inspector.organize'), t('inspector.organizeHelp'), '<div id="wsxFolder"></div><div class="wsx-det__chips" id="wsxTags"></div>') : '')
      + (editable ? sec('analytics', t('inspector.analytics'), t('inspector.analyticsHelp'), '<div id="wsxDetStats" class="wsx-det__stats"></div>') : '')
      + (editable ? sec('tests', t('inspector.tests'), t('inspector.testsHelp'), '<div id="wsxTests"></div>') : '')
      + sec('knowledge', t('inspector.knowledgeFrom'), t('inspector.knowledgeFromHelp'), '<div id="wsxKnFrom"></div>')
      + '</div></div>';
    rbodyEl.innerHTML = h;
    var root = rbodyEl.querySelector('.wsx__details');
    paintApprovals(art);

    // inline edits — click to type, Enter to save, blur to autosave
    var enterSaves = function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } }); };
    var nameEl = root.querySelector('[data-edit="name"]');
    if (nameEl && editable) {
      nameEl.addEventListener('blur', function () {
        var v = nameEl.textContent.trim(); if (!v || v === name) return; var prevName = name;
        var setName = function (n) { name = n; art.name = n; if (metaCache[art.id]) metaCache[art.id].name = n; if (panes[art.key]) panes[art.key].art.name = n; setTabLabel(art.key, n); if (nameEl.textContent.trim() !== n) nameEl.textContent = n; };
        optimistic({
          apply: function () { setName(v); },
          rollback: function () { setName(prevName); },
          request: function () { return patchArtifact(art.id, { name: v }); },
          error: t('inspector.saveNameFailed'),
        });
      });
      enterSaves(nameEl);
    }
    var descEl = root.querySelector('[data-edit="description"]');
    if (descEl && editable) {
      descEl.addEventListener('blur', function () {
        var v = descEl.textContent.trim(); if (v === desc) return; var prevDesc = desc;
        var setDesc = function (d) { desc = d; if (metaCache[art.id]) metaCache[art.id].description = d; if (descEl.textContent.trim() !== d) descEl.textContent = d; };
        optimistic({
          apply: function () { setDesc(v); },
          rollback: function () { setDesc(prevDesc); },
          request: function () { return patchArtifact(art.id, { description: v }); },
          error: t('inspector.saveDescFailed'),
        });
      });
      enterSaves(descEl);
    }

    // icon actions
    root.querySelectorAll('[data-iact]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-iact');
        if (act === 'open') { window.open(openUrl, '_blank', 'noopener'); }
        else if (act === 'edit') { window.open(openUrl + 'edit', '_blank', 'noopener'); }
        else if (act === 'copy') { copyText(fullUrl, b); }
        else if (act === 'fav') { toggleFav(art.id, b); var ft = b.classList.contains('is-on') ? t('inspector.favRemove') : t('inspector.favAdd'); b.setAttribute('data-tip', ft); b.setAttribute('aria-label', ft); }
        else if (act === 'trash') { trashArtifact(art); }
        else if (act === 'original') { var dl = document.createElement('a'); dl.href = '/a/' + encodeURIComponent(slug) + '/download'; dl.download = ''; document.body.appendChild(dl); dl.click(); dl.remove(); }
      });
    });

    wireVis(root, art, visCur);

    wireSecs(root);

    renderShare(art, meta, editable);
    renderKnowledgeFrom(art, meta);
    if (editable) { renderTags(art, (meta.tags || []).slice()); renderFolder(art, meta); renderTests(art); }
    var statsEl = root.querySelector('#wsxDetStats');
    if (art.id && statsEl) loadAnalytics(art.id, statsEl);
  }
  // Share-with: role-aware collaborators + always-visible workspace-member search (multi-add).
  var memberCache = {};
  var PEOPLE_SVG = '<svg class="wsx-share__emptyic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  function renderShare(art, meta, editable, host) {
    var box = host || rbodyEl.querySelector('#wsxShare'); if (!box) return;
    var wsId = (meta && meta.workspace_id) || '';
    var list = [];          // [{email, role}]
    var role = 'viewer';    // role for the next add

    function loadMembers(cb) {
      if (memberCache[wsId] !== undefined) { cb(memberCache[wsId]); return; }
      if (!wsId) { memberCache[wsId] = []; cb([]); return; }
      fetch('/v1/workspaces/' + encodeURIComponent(wsId) + '/members', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { memberCache[wsId] = (d && d.members) || []; cb(memberCache[wsId]); })
        .catch(function () { memberCache[wsId] = []; cb([]); });
    }
    function addEmails(emails) {
      if (!emails.length) return;
      var last = emails[emails.length - 1], r0 = role, added = [];
      optimistic({
        key: 'collab:add:' + art.id + ':' + emails.join(','),
        apply: function () {
          emails.forEach(function (em) { if (!list.some(function (c) { return c.email === em; })) { list.push({ email: em, role: r0 }); added.push(em); } });
          paint();
        },
        rollback: function () { list = list.filter(function (c) { return added.indexOf(c.email) < 0; }); added = []; paint(); },
        request: function () {
          return fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: emails, role: r0 }) })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        },
        success: t('inspector.inviteSent').replace('{email}', last),
        error: t('inspector.inviteFailed'),
        done: function (d) { if (d && d.collaborators) { list = d.collaborators; paint(); } metaCache[art.id] = undefined; },
      });
    }
    function paint() {
      var count = list.length;
      var countTxt = count === 0 ? '' : (count === 1 ? t('inspector.onePerson') : t('inspector.peopleCount').replace('{n}', count));
      var head = editable
        ? '<div class="wsx-share__head"><span class="wsx-share__count">' + esc(countTxt) + '</span>'
          + '<div class="wsx-share__roletog"><button data-role="viewer" type="button" class="' + (role === 'viewer' ? 'is-on' : '') + '">' + esc(t('inspector.viewer')) + '</button><button data-role="editor" type="button" class="' + (role === 'editor' ? 'is-on' : '') + '">' + esc(t('inspector.editor')) + '</button></div></div>'
        : '';
      var curVis = (metaCache[art.id] && metaCache[art.id].visibility) || (meta && meta.visibility) || 'private';
      var emptyState = (!count && editable)
        ? '<div class="wsx-share__empty">' + PEOPLE_SVG + '<div><div class="wsx-share__emptyt" id="wsxShareEmptyT">' + esc(shareEmptyTitle(curVis)) + '</div><div class="wsx-share__emptys">' + esc(t('inspector.addTeammates')) + '</div></div></div>'
        : '';
      var input = editable
        ? '<input class="wsx-share__search" id="wsxShareSearch" placeholder="' + esc(t('inspector.shareAddPeople')) + '" autocomplete="off"><div class="wsx-share__drop" id="wsxShareDrop"></div>'
        : '';
      var chips = list.map(function (c) {
        var ini = (c.email[0] || '?').toUpperCase();
        return '<span class="wsx-det__who" title="' + esc(c.email) + '"><span class="av">' + esc(ini) + '</span><span class="em">' + esc(c.email) + '</span> <span class="role">' + esc(c.role || t('inspector.viewer')) + '</span>' + (editable ? '<button data-rm="' + esc(c.email) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button>' : '') + '</span>';
      }).join('');
      if (!count && !editable) chips = '<span class="wsx-share__note">' + esc(t('inspector.privateToYou')) + '</span>';
      var chipWrap = chips ? '<div class="wsx-share__chips">' + chips + '</div>' : '';
      box.innerHTML = head + emptyState + input + chipWrap;
      box.querySelectorAll('[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          var em = b.getAttribute('data-rm'), idx = -1, removed = null;
          optimistic({
            key: 'collab:rm:' + art.id + ':' + em,
            apply: function () { list.forEach(function (c, i) { if (c.email === em) { idx = i; removed = c; } }); list = list.filter(function (c) { return c.email !== em; }); paint(); },
            rollback: function () { if (removed && !list.some(function (c) { return c.email === em; })) list.splice(idx < 0 ? list.length : idx, 0, removed); paint(); },
            request: function () { return fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators/' + encodeURIComponent(em), { method: 'DELETE', credentials: 'same-origin' }); },
            error: t('inspector.removeCollabFailed'),
            done: function () { metaCache[art.id] = undefined; },
          });
        });
      });
      box.querySelectorAll('[data-role]').forEach(function (b) {
        b.addEventListener('click', function () { role = b.getAttribute('data-role'); box.querySelectorAll('[data-role]').forEach(function (x) { x.classList.toggle('is-on', x === b); }); });
      });
      if (editable) wireSearch();
    }
    function wireSearch() {
      var search = box.querySelector('#wsxShareSearch'), drop = box.querySelector('#wsxShareDrop'); if (!search) return;
      function renderDrop(q) {
        loadMembers(function (members) {
          var taken = {}; list.forEach(function (c) { taken[c.email] = 1; });
          var ql = (q || '').toLowerCase();
          var matches = members.filter(function (m) {
            if (taken[m.email]) return false;
            if (!ql) return true;
            return (m.email || '').toLowerCase().indexOf(ql) >= 0 || (m.name || '').toLowerCase().indexOf(ql) >= 0;
          }).slice(0, 8);
          var h = matches.map(function (m) {
            return '<button class="wsx-share__opt" data-add="' + esc(m.email) + '" type="button"><span class="wsx-cm__av">' + esc((m.name || m.email)[0].toUpperCase()) + '</span>' + esc(m.name || m.email) + '<small>' + esc(m.email) + '</small></button>';
          }).join('');
          var raw = (q || '').trim();
          if (raw && raw.indexOf('@') > 0 && !taken[raw] && !matches.some(function (m) { return m.email === raw; })) {
            h += '<button class="wsx-share__opt" data-add="' + esc(raw) + '" type="button"><span class="wsx-cm__av">+</span>' + esc(t('inspector.invite')) + ' ' + esc(raw) + '<kbd class="wsx-share__kbd">' + esc(t('inspector.enterHint')) + '</kbd></button>';
          }
          drop.innerHTML = h;
          drop.querySelectorAll('[data-add]').forEach(function (b) {
            b.addEventListener('click', function () { addEmails([b.getAttribute('data-add')]); search.value = ''; renderDrop(''); search.focus(); });
          });
        });
      }
      search.addEventListener('input', function () { renderDrop(search.value); });
      search.addEventListener('focus', function () { renderDrop(search.value); });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var v = search.value.trim(); if (v.indexOf('@') > 0) { addEmails([v]); search.value = ''; renderDrop(''); } }
      });
    }

    box.innerHTML = i18nLoad();
    fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { list = (d && d.collaborators) || []; paint(); })
      .catch(function () { paint(); });
  }

  // ----- Tags (artifact_tags via /v1/artifacts/:id/tags) -----
  function renderTags(art, tags) {
    var box = rbodyEl.querySelector('#wsxTags'); if (!box) return;
    function sync() { if (metaCache[art.id]) metaCache[art.id].tags = tags.slice(); }
    function paint() {
      var h = tags.map(function (tg) {
        return '<span class="wsx-det__who"><span class="av">#</span>' + esc(tg) + '<button data-rmtag="' + esc(tg) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button></span>';
      }).join('');
      h += '<button class="wsx-det__add" id="wsxTagAdd" title="' + esc(t('inspector.addTag')) + '" type="button">+</button>';
      box.innerHTML = h;
      box.querySelectorAll('[data-rmtag]').forEach(function (b) {
        b.addEventListener('click', function () {
          var tag = b.getAttribute('data-rmtag'), idx = tags.indexOf(tag);
          optimistic({
            key: 'tag:' + art.id + ':' + tag,
            apply: function () { tags = tags.filter(function (x) { return x !== tag; }); sync(); paint(); },
            rollback: function () { if (tags.indexOf(tag) < 0) tags.splice(idx < 0 ? tags.length : idx, 0, tag); sync(); paint(); },
            request: function () { return fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/tags/' + encodeURIComponent(tag), { method: 'DELETE', credentials: 'same-origin' }); },
            error: t('inspector.removeTagFailed'),
          });
        });
      });
      var add = box.querySelector('#wsxTagAdd');
      add.addEventListener('click', function () {
        var inp = document.createElement('input'); inp.className = 'wsx-det__addin'; inp.placeholder = t('inspector.tagPlaceholder');
        add.replaceWith(inp); inp.focus();
        function commit() {
          var tag = inp.value.trim().replace(/^#/, ''); if (!tag) { paint(); return; }
          var added = false;
          optimistic({
            key: 'tag:' + art.id + ':' + tag,
            apply: function () { added = tags.indexOf(tag) < 0; if (added) tags.push(tag); sync(); paint(); },
            rollback: function () { if (added) tags = tags.filter(function (x) { return x !== tag; }); sync(); paint(); },
            request: function () { return fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/tags', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: tag }) }); },
            error: t('inspector.addTagFailed'),
          });
        }
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        inp.addEventListener('blur', commit);
      });
    }
    paint();
  }

  // ----- Folder (breadcrumb trigger + nested tree popover; move via personal or workspace API) -----
  var folderCache = null;
  var FOLDER_SVG = isvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
  var CHECK_SVG = isvg('<path d="M20 6 9 17l-5-5"/>');
  var CHEVD_SVG = isvg('<path d="M6 9l6 6 6-6"/>');
  function foldersUrl(wsId) { return wsId ? '/v1/workspaces/' + encodeURIComponent(wsId) + '/folders?all=1' : '/v1/folders'; }
  function folderPath(folders, id) {
    var byId = {}; folders.forEach(function (f) { byId[f.id] = f; });
    var parts = [], cur = byId[id], guard = 0;
    while (cur && guard++ < 20) { parts.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null; }
    return parts;
  }
  function folderTree(folders) {
    var byParent = {}; folders.forEach(function (f) { var p = f.parent_id || ''; (byParent[p] = byParent[p] || []).push(f); });
    var rows = [];
    (function walk(pid, depth) {
      (byParent[pid] || []).forEach(function (f) { rows.push({ f: f, depth: depth }); walk(f.id, depth + 1); });
    })('', 0);
    return rows;
  }
  function renderFolder(art, meta) {
    var box = rbodyEl.querySelector('#wsxFolder'); if (!box) return;
    var wsId = meta.workspace_id || '';
    var open = false;
    function move(fid, folders) {
      var prev = meta.folder_id || '';
      var setF = function (f) { meta.folder_id = f; if (metaCache[art.id]) metaCache[art.id].folder_id = f; paint(folders); };
      var url = wsId ? '/v1/workspaces/' + encodeURIComponent(wsId) + '/artifacts/' + encodeURIComponent(art.id) + '/move' : '/v1/artifacts/' + encodeURIComponent(art.id) + '/folder';
      optimistic({
        key: 'move:' + art.id,
        apply: function () { setF(fid); },
        rollback: function () { setF(prev); },
        request: function () { return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: fid || null }) }); },
        error: t('inspector.movePageFailed'),
        done: function () { if (typeof artCache !== 'undefined') artCache = {}; },
      });
    }
    function paint(folders) {
      var cur = meta.folder_id || '';
      var path = cur ? folderPath(folders, cur) : [];
      var label = path.length
        ? path.map(function (p, i) { return '<span class="wsx-folder__seg' + (i === path.length - 1 ? ' is-leaf' : '') + '">' + esc(p) + '</span>'; }).join('<span class="wsx-folder__sep">/</span>')
        : '<span class="wsx-folder__none">' + esc(t('inspector.noFolder')) + '</span>';
      var rows = '<button class="wsx-folder__opt' + (!cur ? ' is-sel' : '') + '" data-fid="" type="button">' + FOLDER_SVG + '<span class="wsx-folder__optt">' + esc(t('inspector.noFolder')) + '</span>' + (!cur ? CHECK_SVG : '') + '</button>'
        + folderTree(folders).map(function (r) {
          return '<button class="wsx-folder__opt' + (r.f.id === cur ? ' is-sel' : '') + '" data-fid="' + esc(r.f.id) + '" data-depth="' + r.depth + '" type="button">' + FOLDER_SVG + '<span class="wsx-folder__optt">' + esc(r.f.name) + '</span>' + (r.f.id === cur ? CHECK_SVG : '') + '</button>';
        }).join('');
      box.innerHTML = '<div class="wsx-folder">'
        + '<button class="wsx-abtn wsx-folder__btn" id="wsxFolderBtn" type="button" aria-haspopup="listbox" aria-expanded="' + (open ? 'true' : 'false') + '">' + FOLDER_SVG + '<span class="wsx-folder__path">' + label + '</span>' + CHEVD_SVG + '</button>'
        + '<div class="wsx-folder__menu" role="listbox"' + (open ? '' : ' hidden') + '>' + rows + '</div></div>';
      var btn = box.querySelector('#wsxFolderBtn'), menu = box.querySelector('.wsx-folder__menu');
      btn.addEventListener('click', function (e) { e.stopPropagation(); open = !open; menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      menu.querySelectorAll('[data-fid]').forEach(function (o) { o.addEventListener('click', function () { open = false; move(o.getAttribute('data-fid'), folders); }); });
    }
    document.addEventListener('click', function () { if (!open) return; open = false; var m = box.querySelector('.wsx-folder__menu'); if (m) m.hidden = true; var b = box.querySelector('#wsxFolderBtn'); if (b) b.setAttribute('aria-expanded', 'false'); });
    if (folderCache) { paint(folderCache); return; }
    box.innerHTML = i18nLoad();
    fetch(foldersUrl(wsId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { folderCache = (d && (d.folders || d.items || d)) || []; if (!Array.isArray(folderCache)) folderCache = []; paint(folderCache); })
      .catch(function () { box.innerHTML = i18nEmpty('inspector.couldNotFolders'); });
  }

  // ----- Comments (full thread + composer; cached) -----
  function renderComments(art) {
    if (!art.id) {
      rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
      // Fetch comments by slug alongside the meta lookup instead of after it.
      var bySlug = art.slug ? fetch('/v1/home/comments?slug=' + encodeURIComponent(art.slug) + '&limit=200', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null);
      fetchMeta(art, function (d) {
        if (activeArt !== art) return;
        if (!d) { railRetry('inspector.detailsFailed', function () { renderComments(art); }); return; }
        bySlug.then(function (c) { if (activeArt !== art) return; if (c && c.comments && art.id && cmtCache[art.id] === undefined) cmtCache[art.id] = c.comments; renderComments(art); });
      });
      return;
    }
    if (cmtCache[art.id] !== undefined) { paintComments(art, cmtCache[art.id]); return; }
    rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nLoad() + '</div>';
    fetch('/v1/home/comments?artifactId=' + encodeURIComponent(art.id) + '&limit=200', { credentials: 'same-origin' })
      .then(function (r) { return r.status === 403 ? { forbidden: true } : (r.ok ? r.json() : null); })
      .then(function (d) {
        if (d && d.forbidden) { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.cannotComment') + '</div>'; return; }
        if (!d) { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.couldNotComments') + '</div>'; return; }
        cmtCache[art.id] = d.comments || []; paintComments(art, cmtCache[art.id]);
      })
      .catch(function () { rbodyEl.innerHTML = '<div class="wsx-cm">' + i18nEmpty('inspector.couldNotComments') + '</div>'; });
  }
  function cmAvatar(name) { return '<span class="wsx-cm__av">' + esc((name || '?').charAt(0).toUpperCase()) + '</span>'; }
  var ART_SVG = isvg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>');
  var SRC_SVG = isvg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>');
  // Mentions render as class-distinct chips: @user, artifacts/sources via the
  // self-describing [[a:slug|Label]] / [[s:id|Label]] tokens, and #tags.
  function cmBody(text) {
    return esc(text)
      .replace(/\\[\\[a:([^|\\]]+)\\|([^\\]]+)\\]\\]/g, function (_m, slug, label) { return '<a class="wsx-cm__ent is-artifact" href="/a/' + slug + '/" data-name="' + label + '" title="' + esc(t('inspector.openLabel')) + ' ' + label + '">' + ART_SVG + '<span>' + label + '</span></a>'; })
      .replace(/\\[\\[s:([^|\\]]+)\\|([^\\]]+)\\]\\]/g, function (_m, _id, label) { return '<span class="wsx-cm__ent is-source" title="' + esc(t('inspector.dataSource')) + '">' + SRC_SVG + '<span>' + label + '</span></span>'; })
      .replace(/@([A-Za-z0-9._-]+)/g, '<span class="wsx-cm__ent is-user">@$1</span>')
      .replace(/#([A-Za-z0-9_-]+)/g, '<span class="wsx-cm__ent is-tag">#$1</span>');
  }
  function pinSelector(c) {
    if (!c.position) return '';
    try { var p = typeof c.position === 'string' ? JSON.parse(c.position) : c.position; return (p && p.selector) || ''; } catch (e) { return ''; }
  }
  function cmNode(c, byParent) {
    var who = c.author_name || (c.author_type === 'agent' ? t('inspector.agent') : t('inspector.someone'));
    var agent = c.author_type === 'agent' ? '<span class="wsx-cm__agent">AI</span>' : '';
    var done = c.resolved ? '<div class="wsx-cm__done">' + esc(t('inspector.resolved')) + '</div>' : '';
    var ts = c.created_at ? (Date.parse(c.created_at) || Date.now()) : Date.now();
    var sel = pinSelector(c);
    var pin = (sel || c.position) ? '<button class="wsx-cm__pin" data-pin="' + esc(sel) + '" type="button" title="' + esc(t('inspector.pinnedTo')) + '">' + isvg('<path d="M9 4v6l-2 4h10l-2-4V4"/><path d="M12 14v6"/><path d="M8 4h8"/>') + (sel ? '<span>' + esc(sel) + '</span>' : '<span>' + esc(t('inspector.pinned')) + '</span>') + '</button>' : '';
    var kids = (byParent[c.id] || []).map(function (k) { return cmNode(k, byParent); }).join('');
    return '<div class="wsx-cm__row">'
      + '<div class="wsx-cm__top">' + cmAvatar(who) + '<span class="wsx-cm__who">' + esc(who) + '</span>' + agent + '<span class="wsx-cm__ago">' + timeAgo(ts) + '</span></div>'
      + pin
      + '<div class="wsx-cm__body">' + cmBody(c.content) + '</div>' + done + (c.parent_id ? '' : cmReviewMeta(c))
      + '<button class="wsx-cm__reply" data-reply="' + esc(c.id) + '" type="button">' + esc(t('inspector.reply')) + '</button>' + (c.parent_id ? '' : cmReviewActs(c))
      + (kids ? '<div class="wsx-cm__kids">' + kids + '</div>' : '')
      + '</div>';
  }
  // Mention sources: people (members ∪ collaborators), other artifacts, data-source
  // connections, and the artifact's tags. Cached per artifact, fetched in parallel.
  var cmDataCache = {};
  function getCmData(art, cb) {
    if (cmDataCache[art.id]) { cb(cmDataCache[art.id]); return; }
    var wsId = metaCache[art.id] && metaCache[art.id].workspace_id;
    var jget = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    var calls = [
      jget('/v1/artifacts/' + encodeURIComponent(art.id) + '/collaborators'),
      jget('/v1/artifacts?limit=50' + (wsId ? '&workspace_id=' + encodeURIComponent(wsId) : '')),
      wsId ? jget('/v1/workspaces/' + encodeURIComponent(wsId) + '/members') : Promise.resolve(null),
      wsId ? jget('/v1/workspaces/' + encodeURIComponent(wsId) + '/connections') : Promise.resolve(null)
    ];
    Promise.all(calls).then(function (res) {
      var seen = {}, people = [];
      ((res[0] && res[0].collaborators) || []).forEach(function (c) { if (c.email && !seen[c.email]) { seen[c.email] = 1; people.push({ email: c.email, name: c.email }); } });
      if (res[2] && res[2].members) res[2].members.forEach(function (m) { if (m.email && !seen[m.email]) { seen[m.email] = 1; people.push({ email: m.email, name: m.name || m.email }); } });
      var artifacts = ((res[1] && res[1].artifacts) || []).filter(function (a) { return a.id !== art.id && a.slug; }).map(function (a) { return { slug: a.slug, name: a.name || a.slug }; });
      var sources = ((res[3] && res[3].connections) || []).map(function (c) { return { id: c.id, name: c.name || c.provider, provider: c.provider }; });
      var tags = (metaCache[art.id] && metaCache[art.id].tags) || [];
      cmDataCache[art.id] = { people: people, artifacts: artifacts, sources: sources, tags: tags };
      cb(cmDataCache[art.id]);
    });
  }
  // One premium composer markup, reused for the top-level box and inline replies.
  function composerHTML(reply) {
    return '<div class="wsx-cc' + (reply ? ' wsx-cc--reply' : '') + '">'
      + '<div class="wsx-cm__mentions" hidden></div>'
      + '<div class="wsx-cc__emoji" hidden>' + EMOJI_SET.map(function (e) { return '<button class="wsx-cc__emojibtn" type="button" data-emoji="' + e + '">' + e + '</button>'; }).join('') + '</div>'
      + '<div class="wsx-cc__field">'
      +   '<textarea class="wsx-cc__ta" rows="1" placeholder="' + esc(reply ? t('inspector.replyPlaceholder') : t('inspector.writeComment')) + '"></textarea>'
      +   '<div class="wsx-cc__bar">'
      +     '<button class="wsx-cc__tool js-at" type="button" title="' + esc(t('inspector.mentionTitle')) + '" aria-label="' + esc(t('inspector.mention')) + '">@</button>'
      +     '<button class="wsx-cc__tool js-hash" type="button" title="' + esc(t('inspector.tagTool')) + '" aria-label="' + esc(t('inspector.tagTool')) + '">#</button>'
      +     '<button class="wsx-cc__tool js-emojibtn" type="button" title="' + esc(t('inspector.emoji')) + '" aria-label="' + esc(t('inspector.addEmoji')) + '">' + isvg(SVG_EMOJI) + '</button>'
      +     '<span class="wsx-cc__grow"></span>'
      +     '<button class="wsx-cc__send js-send" type="button" title="' + esc(t('inspector.send')) + '" aria-label="' + esc(t('inspector.send')) + '" disabled>' + isvg(SVG_SEND) + '</button>'
      +   '</div>'
      + '</div>'
      + '<div class="wsx-cc__err" role="alert" hidden></div>'
      + '</div>';
  }
  // A failed send keeps the typed text and says why next to the composer.
  function ccError(ta, msg) {
    var err = ta.closest('.wsx-cc').querySelector('.wsx-cc__err');
    err.textContent = msg || ''; err.hidden = !msg;
  }
  function insertAtCursor(ta, str) { var s = ta.selectionStart || 0, e = ta.selectionEnd || s; ta.value = ta.value.slice(0, s) + str + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + str.length; }
  function insertTrigger(ta, ch) { var s = ta.selectionStart || 0, pre = ta.value.slice(0, s); insertAtCursor(ta, (pre && !/\\s$/.test(pre) ? ' ' : '') + ch); ta.dispatchEvent(new Event('input')); }
  function wireComposer(art, cc, opts) {
    var ta = cc.querySelector('.wsx-cc__ta');
    var send = cc.querySelector('.js-send');
    var emoji = cc.querySelector('.wsx-cc__emoji');
    var menu = cc.querySelector('.wsx-cm__mentions');
    function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }
    function refreshSend() { send.disabled = !ta.value.trim(); }
    ta.addEventListener('input', function () { autosize(); refreshSend(); ccError(ta, ''); });
    cc.querySelector('.js-emojibtn').addEventListener('click', function (e) { e.stopPropagation(); emoji.hidden = !emoji.hidden; });
    emoji.addEventListener('click', function (e) { var b = e.target.closest('[data-emoji]'); if (!b) return; insertAtCursor(ta, b.getAttribute('data-emoji')); emoji.hidden = true; autosize(); refreshSend(); });
    cc.querySelector('.js-at').addEventListener('click', function () { insertTrigger(ta, '@'); });
    cc.querySelector('.js-hash').addEventListener('click', function () { insertTrigger(ta, '#'); });
    document.addEventListener('click', function () { if (!emoji.hidden) emoji.hidden = true; });
    function submit() { postComment(art, ta.value, opts.parentId || null, send, ta); }
    send.addEventListener('click', submit);
    wireMentions(art, ta, menu, submit);
    if (opts.focus) ta.focus();
    return ta;
  }
  // Autocomplete for @ (people + artifacts + sources) and # (tags), with class-typed rows.
  function wireMentions(art, ta, menu, onSubmit) {
    var data = { people: [], artifacts: [], sources: [], tags: [] };
    var matches = [], active = 0, trigger = '';
    getCmData(art, function (d) { data = d; });
    function close() { menu.hidden = true; matches = []; }
    function rowHTML(it, i) {
      var ic, sub = '';
      if (it.kind === 'user') { ic = '<span class="wsx-cm__av">' + esc((it.label || it.email || '?').charAt(0).toUpperCase()) + '</span>'; sub = esc(it.email || ''); }
      else if (it.kind === 'artifact') { ic = '<span class="wsx-cm__mic is-artifact">' + ART_SVG + '</span>'; sub = t('inspector.page'); }
      else if (it.kind === 'source') { ic = '<span class="wsx-cm__mic is-source">' + SRC_SVG + '</span>'; sub = esc(it.provider || t('inspector.dataSource')); }
      else { ic = '<span class="wsx-cm__mic is-tag">#</span>'; sub = t('inspector.tagTool'); }
      return '<div class="wsx-cm__mention' + (i === active ? ' is-active' : '') + '" data-mi="' + i + '">' + ic + '<span class="wsx-cm__mtxt">' + esc(it.label) + '</span><small>' + sub + '</small></div>';
    }
    function render() {
      if (!matches.length) { close(); return; }
      menu.hidden = false;
      menu.innerHTML = matches.map(rowHTML).join('');
      menu.querySelectorAll('[data-mi]').forEach(function (el) { el.addEventListener('mousedown', function (e) { e.preventDefault(); pick(parseInt(el.getAttribute('data-mi'), 10)); }); });
    }
    function tokenize(label) { return (label || '').replace(/[\\[\\]|@#]/g, '').replace(/\\s+/g, '-'); }
    function pick(i) {
      var it = matches[i]; if (!it) return;
      if (trigger === '#') {
        var tag = tokenize(it.label);
        ta.value = ta.value.replace(/#(\\S*)$/, '#' + tag + ' ');
      } else {
        var token = tokenize(it.label) || (it.email || 'x');
        ta._refs = ta._refs || {};
        if (it.kind === 'user') ta._refs[token.toLowerCase()] = { type: 'u', email: it.email };
        else if (it.kind === 'artifact') ta._refs[token.toLowerCase()] = { type: 'a', slug: it.slug, label: it.label };
        else if (it.kind === 'source') ta._refs[token.toLowerCase()] = { type: 's', id: it.id, label: it.label };
        ta.value = ta.value.replace(/@(\\S*)$/, '@' + token + ' ');
      }
      close(); ta.focus(); ta.dispatchEvent(new Event('input'));
    }
    function matchFor(q) {
      var ql = q.toLowerCase(), out = [];
      function hit(s) { return (s || '').toLowerCase().indexOf(ql) >= 0; }
      data.people.forEach(function (p) { if (hit(p.name) || hit(p.email)) out.push({ kind: 'user', label: p.name || p.email, email: p.email }); });
      data.artifacts.forEach(function (a) { if (hit(a.name) || hit(a.slug)) out.push({ kind: 'artifact', label: a.name, slug: a.slug }); });
      data.sources.forEach(function (s) { if (hit(s.name) || hit(s.provider)) out.push({ kind: 'source', label: s.name, id: s.id, provider: s.provider }); });
      return out.slice(0, 8);
    }
    ta.addEventListener('input', function () {
      var before = ta.value.slice(0, ta.selectionStart);
      var m = before.match(/([@#])(\\S*)$/);
      if (!m) { close(); return; }
      trigger = m[1];
      if (trigger === '#') matches = data.tags.filter(function (t) { return t.toLowerCase().indexOf(m[2].toLowerCase()) >= 0; }).map(function (t) { return { kind: 'tag', label: t }; }).slice(0, 8);
      else matches = matchFor(m[2]);
      active = 0; render();
    });
    ta.addEventListener('keydown', function (e) {
      if (!menu.hidden && matches.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; render(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; render(); return; }
        if (e.key === 'Enter') { e.preventDefault(); pick(active); return; }
        if (e.key === 'Escape') { close(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
    });
  }
  function paintComments(art, comments) {
    var byParent = {};
    comments.forEach(function (c) { if (c.parent_id) { (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c); } });
    ensureReview(art);
    var allRoots = comments.filter(function (c) { return !c.parent_id; }), roots = cmFilterRoots(allRoots);
    var listH = roots.length ? roots.map(function (c) { return cmNode(c, byParent); }).join('') : '<div class="wsx-cm__empty">' + esc(t(allRoots.length ? 'review.noOpen' : 'inspector.noComments')) + '</div>';
    rbodyEl.innerHTML = '<div class="wsx-cm">' + gcArtHtml(art, metaCache[art.id]) + (allRoots.length ? cmFilterBar(allRoots) : '') + '<div class="wsx-cm__list" id="wsxCmList">' + listH + '</div>' + composerHTML(false) + '</div>';
    wireReview(art);
    if (document.getElementById('wsxGuestCm')) wireGuestArt(art);
    var listEl = document.getElementById('wsxCmList'); if (listEl) listEl.scrollTop = listEl.scrollHeight;
    getCmData(art, function () {}); // warm mention cache
    var mainCc = rbodyEl.querySelector('.wsx-cm > .wsx-cc');
    if (mainCc) wireComposer(art, mainCc, { parentId: null });
    rbodyEl.querySelectorAll('[data-pin]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sel = b.getAttribute('data-pin'); if (!sel || !activeArt || !activeArt.iframe) return;
        try { activeArt.iframe.contentWindow.postMessage({ source: 'shareout-inspector', type: 'scrollToSelector', selector: sel }, '*'); } catch (e) {}
      });
    });
    rbodyEl.querySelectorAll('[data-reply]').forEach(function (b) {
      b.addEventListener('click', function () {
        var nxt = b.nextSibling;
        if (nxt && nxt.classList && nxt.classList.contains('wsx-cc')) { nxt.remove(); return; }
        var wrap = document.createElement('div'); wrap.innerHTML = composerHTML(true);
        var cc = wrap.firstChild; b.parentNode.insertBefore(cc, b.nextSibling);
        wireComposer(art, cc, { parentId: b.getAttribute('data-reply'), focus: true });
      });
    });
  }
  // Canonicalize @tokens → self-describing entity refs (artifacts/sources) and
  // collect person emails for notifications; tags stay as #plain text.
  function postComment(art, content, parentId, btn, ta) {
    var raw = (content || '').trim(); if (!raw) return;
    var refs = (ta && ta._refs) || {}, mentions = [];
    var text = raw.replace(/@([A-Za-z0-9._-]+)/g, function (m, tok) {
      var r = refs[tok.toLowerCase()]; if (!r) return m;
      if (r.type === 'u') { if (r.email && mentions.indexOf(r.email) < 0) mentions.push(r.email); return m; }
      if (r.type === 'a') return '[[a:' + r.slug + '|' + r.label + ']]';
      if (r.type === 's') return '[[s:' + r.id + '|' + r.label + ']]';
      return m;
    });
    btn.disabled = true;
    fetch('/v1/home/comments', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: art.id, content: text, parentId: parentId || undefined, mentions: mentions.length ? mentions : undefined }) })
      .then(okOr)
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (j) {
        btn.disabled = false;
        if (!j || !j.comment) { ccError(ta, t('inspector.couldNotPost')); return; }
        (cmtCache[art.id] = cmtCache[art.id] || []).push(j.comment);
        paintComments(art, cmtCache[art.id]);
      })
      .catch(function (e) { btn.disabled = false; ccError(ta, e && e.status === 403 ? t('inspector.cannotComment') : errReason(e, t('inspector.couldNotPost'))); });
  }

  var HOUSE_SVG = isvg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/>');
  // The first tab names the section you're in (Artifacts, Assets…), not always "Home".
  function homeTabLabel() {
    var on = ws.querySelector('[data-lens].is-active'), k = on ? on.getAttribute('data-lens') : 'brief';
    return k === 'brief' ? t('tabs.home') : t('nav.' + k);
  }
  function renderTabs() {
    tabsEl.innerHTML = tabs.map(function (tab) {
      var dirty = !tab.home && panes[tab.key] && panes[tab.key].dirty;
      return '<div class="wsx-tab' + (tab.key === activeKey ? ' is-active' : '') + (tab.home ? ' wsx-tab--home' : '') + '" data-tab="' + esc(tab.key) + '"' + (tab.home ? '' : ' draggable="true" title="' + esc(tab.label) + '"') + '>'
        + (dirty ? '<span class="wsx-tab__dot" title="' + esc(t('inspector.unsavedDot')) + '"></span>' : '')
        + (tab.home ? '<span class="wsx-tab__ic">' + HOUSE_SVG + '</span>' : '')
        + '<span class="wsx-tab__label">' + esc(tab.home ? homeTabLabel() : tab.label) + '</span>'
        + (tab.home ? '' : '<button class="wsx-tab__x" data-close="' + esc(tab.key) + '" aria-label="' + esc(t('inspector.closeTab')) + '">\\u00D7</button>')
        + '</div>';
    }).join('');
    tabsEl.querySelectorAll('[data-tab]').forEach(function (el) {
      el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) return; activateTab(el.getAttribute('data-tab')); });
    });
    tabsEl.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); closeTab(b.getAttribute('data-close')); });
    });
    wireTabDrag();
    syncTabRow();
  }
  // Drag-to-reorder tabs (Home pinned): a bar marks the slot; the move happens once on drop.
  var dragKey = null, dropBar = null, dropIdx = -1;
  function keyIndex(key) { for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) return i; return -1; }
  function clearDropBar() { if (dropBar) { dropBar.remove(); dropBar = null; } dropIdx = -1; }
  // Place the indicator at the left edge of slot idx (or the right edge of the last tab).
  function paintDropBar(idx) {
    if (!dropBar) { dropBar = document.createElement('div'); dropBar.className = 'wsx-tab-drop'; tabsEl.appendChild(dropBar); }
    var els = tabsEl.querySelectorAll('[data-tab]');
    var cont = tabsEl.getBoundingClientRect(), x;
    if (idx < els.length) x = els[idx].getBoundingClientRect().left - cont.left + tabsEl.scrollLeft;
    else { var last = els[els.length - 1].getBoundingClientRect(); x = last.right - cont.left + tabsEl.scrollLeft; }
    dropBar.style.transform = 'translateX(' + (x - 1) + 'px)';
  }
  function wireTabDrag() {
    tabsEl.querySelectorAll('[data-tab][draggable="true"]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        dragKey = el.getAttribute('data-tab');
        el.classList.add('is-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey); } catch (err) {}
      });
      el.addEventListener('dragend', function () { el.classList.remove('is-dragging'); dragKey = null; clearDropBar(); });
    });
  }
  // Container-level listeners — bound once; survive renderTabs() innerHTML rebuilds.
  tabsEl.addEventListener('dragover', function (e) {
    if (dragKey == null) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    var els = tabsEl.querySelectorAll('[data-tab]'), idx = els.length;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { idx = i; break; }
    }
    if (idx < 1) idx = 1; // never before the pinned Home tab
    dropIdx = idx; paintDropBar(idx);
  });
  tabsEl.addEventListener('drop', function (e) {
    if (dragKey == null) return;
    e.preventDefault();
    var from = keyIndex(dragKey), to = dropIdx;
    if (from > 0 && to >= 1) {
      var item = tabs.splice(from, 1)[0];
      if (to > from) to--;
      if (to < 1) to = 1;
      tabs.splice(to, 0, item);
      saveTabs(); renderTabs();
    }
    clearDropBar();
  });
  // Live tabs: a pane with no artifact behind it yet (a page still being built). Never
  // saved, no View/Edit, no inspector; closing one calls its onClose.
  var livePanes = {};        // key -> { pane, onClose }
  function openLiveTab(key, label, pane, onClose) {
    livePanes[key] = { pane: pane, onClose: onClose };
    panesEl.appendChild(pane);
    tabs.splice(1, 0, { key: key, label: label, live: true });
    activateTab(key);
  }
  // Drop a live tab without firing onClose; returns the slot it held (-1 if gone).
  function dropLiveTab(key) {
    var live = livePanes[key], idx = keyIndex(key);
    if (live) { live.pane.remove(); delete livePanes[key]; }
    if (idx > 0) tabs.splice(idx, 1);
    return idx;
  }
  function activateTab(key) {
    activeKey = key;
    if (panes[key]) loadStage(panes[key]);
    homePane.classList.toggle('is-active', key === 'home');
    Object.keys(panes).forEach(function (k) { panes[k].pane.classList.toggle('is-active', k === key); });
    Object.keys(livePanes).forEach(function (k) { livePanes[k].pane.classList.toggle('is-active', k === key); });
    activeArt = !panes[key] ? null : { key: key, id: panes[key].art.id, slug: panes[key].art.slug, name: panes[key].art.name, iframe: panes[key].iframe };
    paintRail();
    renderTabs();
    syncTabMode();
    if (typeof syncHash === 'function') syncHash();
  }
  function closeTab(key) {
    var idx = -1; for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) idx = i;
    if (idx <= 0) return;
    if (panes[key] && panes[key].dirty && !window.confirm(t('inspector.closeTabConfirm'))) return;
    if (panes[key]) { panes[key].pane.remove(); delete panes[key]; }
    var live = livePanes[key];
    if (live) { live.pane.remove(); delete livePanes[key]; if (live.onClose) live.onClose(); }
    tabs.splice(idx, 1);
    saveTabs();
    if (activeKey === key) activateTab(tabs[Math.max(0, idx - 1)].key);
    else renderTabs();
  }
  function makeTab(key, art, first, at) {
    var made = makeArtifactPane(art);
    panes[key] = made; panesEl.appendChild(made.pane); tabs.splice(at > 0 ? at : first ? 1 : tabs.length, 0, { key: key, label: art.name });
  }
  // inPlaceOf: a live tab this artifact replaces, in the same slot.
  function openArtifact(slug, name, id, type, inPlaceOf) {
    var key = id || slug;
    var at = inPlaceOf ? dropLiveTab(inPlaceOf) : -1;
    if (!panes[key]) {
      makeTab(key, { key: key, id: id || '', slug: slug, name: name || t('inspector.artifact'), type: type || '' }, true, at);
      saveTabs();
      if (id) fetch('/v1/home/viewed', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: id }) }).catch(function () {});
    }
    rActive = 'details';
    activateTab(key);
  }
  // Persist open artifact tabs so they reopen next session.
  function saveTabs() {
    try {
      var open = tabs.filter(function (t) { return !t.home && !t.live && panes[t.key]; }).map(function (t) { var a = panes[t.key].art; return { key: t.key, label: t.label, id: a.id, slug: a.slug, type: a.type || '' }; });
      localStorage.setItem(LS.tabs, JSON.stringify(open));
    } catch (e) {}
  }
  function restoreTabs() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(LS.tabs) || '[]'); } catch (e) { saved = []; }
    if (!saved || !saved.length) return;
    saved.forEach(function (tab) {
      if (!tab || !tab.slug || panes[tab.key]) return;
      makeTab(tab.key, { key: tab.key, id: tab.id || '', slug: tab.slug, name: tab.label || t('inspector.artifact'), type: tab.type || '' });
    });
    renderTabs();
  }
  renderTabs();
  restoreTabs();
  paintRail();
  // Cmd/Ctrl shortcuts when focus is outside the edit iframe (Esc + edit-doc keys handled inside).
  document.addEventListener('keydown', function (e) {
    var rec = panes[activeKey]; if (!rec || rec.mode !== 'edit') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    editKeydown(rec, e);
  });
  window.addEventListener('beforeunload', function (e) {
    var dirty = Object.keys(panes).some(function (k) { return panes[k] && panes[k].dirty; });
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

`;
