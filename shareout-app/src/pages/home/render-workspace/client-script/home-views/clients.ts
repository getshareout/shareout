/** Admin lens — Clients (external sharing, work/030). Master/detail: client orgs →
 *  members + shared folders + API tokens + read receipts. Calls the sharee/grant/
 *  token/activity APIs. Shares the admin IIFE scope (wsUrl, esc, adRelDate, wsxModal,
 *  fld, cv, needWs are all in scope). UI never says "Sharee" — clients/partners only. */
export const workspace_client_home_views_clients_JS = `  // ----- Admin — Clients (external sharing) -----
  var CLIENT_CAPS = function () { return [['view', t('clients.capView')], ['comment', t('clients.capComment')], ['create', t('clients.capCreate')], ['edit', t('clients.capEdit')]]; };
  function clientErr(j, fallback) {
    if (j && j.code === 'EXTERNAL_SHARING_NOT_ENTITLED') return t('clients.entitled');
    return (j && j.error) || fallback;
  }

  function adClients() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    adLoading(m);
    fetch(wsUrl('/sharees'), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { sharees: [] }; })
      .then(function (j) {
        var list = (j && j.sharees) || [];
        if (list.length) {
          var head = '<div class="wsx-clients__bar">'
            + '<div><div class="wsx-clients__hd">' + esc(t('clients.listTitle')) + '</div>'
            + '<p class="wsx-lens__intro" style="margin:2px 0 0">' + esc(t('clients.intro')) + '</p></div>'
            + '<button class="wsx-abtn wsx-abtn--primary" id="wsxClientAdd" type="button">' + esc(t('clients.add')) + '</button></div>';
          var rows = '<div class="wsx-admin__list">' + list.map(function (c) {
              return '<div class="wsx-admin__row" data-client="' + esc(c.id) + '" style="cursor:pointer">'
                + '<span class="wsx-cm__av">' + esc((c.name || '?').slice(0, 1).toUpperCase()) + '</span>'
                + '<div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(c.name) + ' <span class="wsx-atbl__type">' + esc(c.type || 'client') + '</span></span>'
                + '<span class="wsx-admin__sub">' + (c.member_count || 0) + ' ' + esc(c.member_count === 1 ? t('clients.member') : t('clients.members')) + '</span></div>'
                + '<span class="wsx-atbl__act">' + esc(t('clients.open')) + '</span></div>';
            }).join('') + '</div>';
          m.innerHTML = head + '<div id="wsxClientAddSlot"></div>' + rows;
          document.getElementById('wsxClientAdd').addEventListener('click', function () {
            var slot = document.getElementById('wsxClientAddSlot');
            if (slot.firstChild) { slot.innerHTML = ''; return; }
            slot.innerHTML = clientAddFormHtml(true);
            wireClientAdd(function () { slot.innerHTML = ''; });
          });
          m.querySelectorAll('[data-client]').forEach(function (row) {
            row.addEventListener('click', function () {
              var c = list.filter(function (x) { return x.id === row.getAttribute('data-client'); })[0];
              if (c) adClientDetail(c);
            });
          });
        } else {
          m.innerHTML = '<div class="wsx-clients__zero">'
            + '<div class="wsx-clients__zero-hd">' + esc(t('clients.emptyTitle')) + '</div>'
            + '<p class="wsx-clients__zero-bd">' + esc(t('clients.emptyBody')) + '</p>'
            + '<ol class="wsx-clients__steps">'
            + '<li class="wsx-clients__step"><span class="wsx-clients__step-n">1</span><span class="wsx-clients__step-t">' + esc(t('clients.emptyStep1')) + '</span></li>'
            + '<li class="wsx-clients__step"><span class="wsx-clients__step-n">2</span><span class="wsx-clients__step-t">' + esc(t('clients.emptyStep2')) + '</span></li>'
            + '<li class="wsx-clients__step"><span class="wsx-clients__step-n">3</span><span class="wsx-clients__step-t">' + esc(t('clients.emptyStep3')) + '</span></li>'
            + '</ol>' + clientAddFormHtml(false) + '</div>';
          wireClientAdd(null);
        }
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

  // Inline add-client form (no modal): company name + relationship, right on the
  // screen. Shared by the empty state (always shown) and the populated list
  // (toggled by the Add button). Drops straight into the new client on save so
  // the admin keeps going — invite people, share folders.
  function clientAddFormHtml(cancelable) {
    var types = [['client', t('clients.typeClient')], ['supplier', t('clients.typeSupplier')], ['partner', t('clients.typePartner')], ['investor', t('clients.typeInvestor')]];
    return '<form class="wsx-clients__add" id="wsxClientAddForm">'
      + '<div class="wsx-clients__add-row">'
      + '<label class="wsx-field" style="flex:2;min-width:180px"><span class="wsx-field__lbl">' + esc(t('clients.nameLabel')) + '</span>'
      + '<input class="wsx-field__in" id="ac_name" autocomplete="off" placeholder="' + esc(t('clients.namePh')) + '"></label>'
      + '<label class="wsx-field" style="flex:1;min-width:140px"><span class="wsx-field__lbl">' + esc(t('clients.typeLabel')) + '</span>'
      + '<select class="wsx-field__in" id="ac_type">' + types.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'
      + '</div>'
      + '<p class="wsx-field__note">' + esc(t('clients.nextNote')) + '</p>'
      + '<div class="wsx-clients__add-actions">'
      + '<button class="wsx-abtn wsx-abtn--primary" id="ac_save" type="submit">' + esc(t('clients.add')) + '</button>'
      + (cancelable ? '<button class="wsx-abtn" id="ac_cancel" type="button">' + esc(t('clients.cancel')) + '</button>' : '')
      + '</div></form>';
  }

  function wireClientAdd(onCancel) {
    var form = document.getElementById('wsxClientAddForm'); if (!form) return;
    var nameEl = document.getElementById('ac_name'); if (nameEl) nameEl.focus();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = cv('ac_name'); if (!name) { if (nameEl) nameEl.focus(); return; }
      var type = document.getElementById('ac_type').value;
      var btn = document.getElementById('ac_save'); adBusy(btn);
      fetch(wsUrl('/sharees'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, type: type }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          if (res && res.error) { try { alert(clientErr(res, t('clients.couldNotAdd'))); } catch (e) {} adIdle(btn); return; }
          if (res && res.sharee && res.sharee.id) adClientDetail(res.sharee); else adClients();
        })
        .catch(function () { adIdle(btn); });
    });
    if (onCancel) { var c = document.getElementById('ac_cancel'); if (c) c.addEventListener('click', onCancel); }
  }

  function adClientDetail(client) {
    var m = document.getElementById('wsxAdminMount'); if (!m) return;
    var sid = client.id;
    adLoading(m);
    Promise.all([
      fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/members'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { members: [] }; }).catch(function () { return { members: [] }; }),
      fetch(wsUrl('/grants?subject_id=' + encodeURIComponent(sid)), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { grants: [] }; }).catch(function () { return { grants: [] }; }),
      fetch(wsUrl('/folders'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { folders: [] }; }).catch(function () { return { folders: [] }; }),
      fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/activity'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { activity: [] }; }).catch(function () { return { activity: [] }; }),
      fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/context'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { files: [] }; }).catch(function () { return { files: [] }; })
    ]).then(function (res) {
      var members = (res[0] && res[0].members) || [];
      var grants = (res[1] && res[1].grants) || [];
      var folders = (res[2] && res[2].folders) || [];
      var activity = (res[3] && res[3].activity) || [];
      var notes = (res[4] && res[4].files) || [];
      var folderName = {}; folders.forEach(function (f) { folderName[f.id] = f.name; });
      var capLabel = {}; CLIENT_CAPS().forEach(function (c) { capLabel[c[0]] = c[1]; });

      var back = '<div class="wsx-admin__settings-section"><button class="wsx-abtn" id="wsxClientBack" type="button">' + esc(t('clients.allClients')) + '</button> '
        + '<b style="margin-left:8px">' + esc(client.name) + '</b> <span class="wsx-atbl__type">' + esc(client.type || 'client') + '</span></div>';

      // Members
      var memInvite = '<div class="wsx-admin__invite"><input class="wsx-admin__email" id="wsxCmEmail" type="email" placeholder="' + esc(t('clients.inviteEmail')) + '" autocomplete="off">'
        + '<button class="wsx-abtn" id="wsxCmInvite" type="button">' + esc(t('clients.invite')) + '</button></div>';
      var memList = members.length
        ? '<div class="wsx-admin__list">' + members.map(function (mm) {
            var who = mm.email || t('clients.someone');
            var status = mm.status === 'active' ? '' : '<span class="wsx-atbl__flag">' + esc(mm.status) + '</span>';
            var keyBtn = mm.user_id ? '<button class="wsx-atbl__act" data-cm-tok="' + esc(mm.user_id) + '" type="button">' + esc(t('clients.apiToken')) + '</button>' : '';
            return '<div class="wsx-admin__row"><span class="wsx-cm__av">@</span>'
              + '<div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(who) + ' ' + status + '</span>'
              + '<span class="wsx-admin__sub">' + esc(t('clients.invited')) + ' ' + adRelDate(mm.created_at) + '</span></div>'
              + keyBtn + '<button class="wsx-conn__del" data-cm-rm="' + esc(mm.user_id || mm.id) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button></div>';
          }).join('') + '</div>'
        : '<div class="wsx-empty">' + esc(t('clients.noMembers').replace('{name}', client.name)) + '</div>';
      var membersSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('clients.people')) + '</div>' + memInvite + memList + '</div>';

      // Shared folders (grants)
      var shareCtl = '<div class="wsx-admin__invite"><select class="wsx-admin__role" id="wsxClFolder" style="flex:1">'
        + (folders.length ? folders.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; }).join('') : '<option value="">' + esc(t('clients.noFolders')) + '</option>')
        + '</select><select class="wsx-admin__role" id="wsxClCap">' + CLIENT_CAPS().map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('') + '</select>'
        + '<button class="wsx-abtn" id="wsxClShare" type="button"' + (folders.length ? '' : ' disabled') + '>' + esc(t('clients.shareFolder')) + '</button></div>';
      var grantList = grants.length
        ? '<div class="wsx-admin__list">' + grants.map(function (g) {
            var label = g.resource_type === 'folder' ? (folderName[g.resource_id] || t('clients.folder')) : (g.resource_type + ' ' + g.resource_id.slice(0, 8));
            return '<div class="wsx-admin__row"><span class="wsx-cm__av">\\u25A0</span>'
              + '<div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(label) + '</span>'
              + '<span class="wsx-admin__sub">' + esc(capLabel[g.capability] || g.capability) + ' \\u00B7 ' + esc(t('clients.sharedAt')) + ' ' + adRelDate(g.created_at) + '</span></div>'
              + '<button class="wsx-conn__del" data-grant-rm="' + esc(g.id) + '" title="' + esc(t('clients.stopSharing')) + '" type="button">\\u00D7</button></div>';
          }).join('') + '</div>'
        : '<div class="wsx-empty">' + esc(t('clients.nothingShared').replace('{name}', client.name)) + '</div>';
      var sharedSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('clients.sharedTitle')) + '</div>' + shareCtl + grantList + '</div>';

      // Activity / receipts
      var actSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('clients.recentActivity')) + '</div>'
        + (activity.length
          ? '<div class="wsx-admin__list">' + activity.slice(0, 25).map(function (a) {
              return '<div class="wsx-admin__row"><span class="wsx-cm__av">\\u25C9</span><div class="wsx-admin__who">'
                + '<span class="wsx-admin__nm">' + esc(a.user_email || t('clients.someone')) + ' ' + esc(t('clients.openedArtifact')) + '</span>'
                + '<span class="wsx-admin__sub">' + adRelDate(a.created_at) + '</span></div></div>';
            }).join('') + '</div>'
          : '<div class="wsx-empty">' + esc(t('clients.noViews')) + '</div>') + '</div>';

      // Notes about this client (workspace-private; the assistant reads + updates these)
      var noteList = notes.length
        ? '<div class="wsx-admin__list">' + notes.map(function (n) {
            return '<div class="wsx-admin__row" data-note="' + esc(n.name) + '" style="cursor:pointer"><span class="wsx-cm__av">\\u270E</span>'
              + '<div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(n.name) + '</span>'
              + '<span class="wsx-admin__sub">' + esc(t('clients.updated')) + ' ' + adRelDate(n.updated_at) + '</span></div>'
              + '<span class="wsx-atbl__act">' + esc(t('clients.edit')) + '</span>'
              + '<button class="wsx-conn__del" data-note-rm="' + esc(n.name) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button></div>';
          }).join('') + '</div>'
        : '<div class="wsx-empty">' + esc(t('clients.noNotes').replace('{name}', client.name)) + '</div>';
      var notesSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('clients.notesTitle')) + '</div>'
        + '<p class="wsx-field__note" style="margin:0 0 8px">' + esc(t('clients.notesIntro')) + '</p>'
        + '<div class="wsx-admin__invite"><button class="wsx-abtn" id="wsxClNoteNew" type="button">' + esc(t('clients.addNote')) + '</button></div>'
        + noteList + '</div>';

      m.innerHTML = back + membersSection + sharedSection + notesSection + actSection;

      document.getElementById('wsxClientBack').addEventListener('click', adClients);
      var inv = document.getElementById('wsxCmInvite');
      inv.addEventListener('click', function () {
        var em = (document.getElementById('wsxCmEmail').value || '').trim(); if (!em) return;
        adBusy(inv);
        fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/members'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res2) { if (res2 && res2.error) { try { alert(clientErr(res2, t('clients.couldNotInvite'))); } catch (e) {} adIdle(inv); return; } adClientDetail(client); })
          .catch(function () { adIdle(inv); });
      });
      m.querySelectorAll('[data-cm-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm(t('clients.removeMember').replace('{name}', client.name))) return;
          adBusy(b);
          fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/members/' + encodeURIComponent(b.getAttribute('data-cm-rm'))), { method: 'DELETE', credentials: 'same-origin' })
            .then(function () { adClientDetail(client); }).catch(function () { adIdle(b); });
        });
      });
      var sh = document.getElementById('wsxClShare');
      if (sh) sh.addEventListener('click', function () {
        var fid = document.getElementById('wsxClFolder').value; if (!fid) return;
        var cap = document.getElementById('wsxClCap').value;
        adBusy(sh);
        fetch(wsUrl('/grants'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject_type: 'sharee', subject_id: sid, resource_type: 'folder', resource_id: fid, capability: cap }) })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res2) { if (res2 && res2.error) { try { alert(clientErr(res2, t('clients.couldNotShare'))); } catch (e) {} adIdle(sh); return; } adClientDetail(client); })
          .catch(function () { adIdle(sh); });
      });
      m.querySelectorAll('[data-grant-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          adBusy(b);
          fetch(wsUrl('/grants/' + encodeURIComponent(b.getAttribute('data-grant-rm'))), { method: 'DELETE', credentials: 'same-origin' })
            .then(function () { adClientDetail(client); }).catch(function () { adIdle(b); });
        });
      });
      var noteNew = document.getElementById('wsxClNoteNew');
      if (noteNew) noteNew.addEventListener('click', function () { openClientNote(sid, client, '', ''); });
      m.querySelectorAll('[data-note]').forEach(function (row) {
        row.addEventListener('click', function (ev) {
          if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-note-rm')) return;
          var name = row.getAttribute('data-note');
          fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/context/' + encodeURIComponent(name)), { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (content) { openClientNote(sid, client, name, content); });
        });
      });
      m.querySelectorAll('[data-note-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          var name = b.getAttribute('data-note-rm');
          if (!window.confirm(t('clients.deleteNoteConfirm').replace('{name}', name))) return;
          adBusy(b);
          fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/context/' + encodeURIComponent(name)), { method: 'DELETE', credentials: 'same-origin' })
            .then(function () { adClientDetail(client); }).catch(function () { adIdle(b); });
        });
      });
      m.querySelectorAll('[data-cm-tok]').forEach(function (b) {
        b.addEventListener('click', function () { adClientTokens(sid, b.getAttribute('data-cm-tok'), client); });
      });
    }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

  // API tokens for one external member (mint shows the secret once; list + revoke).
  function adClientTokens(sid, uid, client) {
    var base = wsUrl('/sharees/' + encodeURIComponent(sid) + '/members/' + encodeURIComponent(uid) + '/tokens');
    var md = wsxModal(t('clients.apiTokens'), i18nSpin());
    function render() {
      fetch(base, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { tokens: [] }; }).then(function (j) {
        var toks = (j && j.tokens) || [];
        var rows = toks.filter(function (tk) { return !tk.revoked_at; }).map(function (tk) {
          return '<div class="wsx-admin__row"><div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(tk.name || t('clients.tokenDefault')) + '</span>'
            + '<span class="wsx-admin__sub">' + esc(tk.scopes || '') + '</span></div>'
            + '<button class="wsx-conn__del" data-tok-rm="' + esc(tk.id) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button></div>';
        }).join('');
        md.body.innerHTML = '<p class="wsx-field__note">' + esc(t('clients.tokensIntro')) + '</p>'
          + (rows ? '<div class="wsx-admin__list">' + rows + '</div>' : i18nEmpty('admin.noTokens'))
          + '<div class="wsx-mt-12"><button class="wsx-abtn wsx-abtn--primary" id="wsxTokNew" type="button">' + esc(t('clients.createToken')) + '</button></div>';
        document.getElementById('wsxTokNew').addEventListener('click', function () {
          var btn = this; adBusy(btn);
          fetch(base, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopes: ['data:read'] }) })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (res) {
              if (res && res.token) {
                md.body.innerHTML = '<p class="wsx-field__note">' + esc(t('clients.copyToken')) + '</p>'
                  + '<input class="wsx-field__in" readonly value="' + esc(res.token) + '" onclick="this.select()" style="width:100%">'
                  + '<div class="wsx-mt-12"><button class="wsx-abtn" id="wsxTokDone" type="button">' + esc(t('clients.done')) + '</button></div>';
                document.getElementById('wsxTokDone').addEventListener('click', render);
              } else { try { alert(clientErr(res, t('clients.couldNotCreateToken'))); } catch (e) {} adIdle(btn); render(); }
            }).catch(function () { render(); });
        });
        md.body.querySelectorAll('[data-tok-rm]').forEach(function (b) {
          b.addEventListener('click', function () {
            adBusy(b);
            fetch(base + '/' + encodeURIComponent(b.getAttribute('data-tok-rm')), { method: 'DELETE', credentials: 'same-origin' })
              .then(function () { render(); }).catch(function () { adIdle(b); });
          });
        });
      }).catch(function () { md.body.innerHTML = i18nEmpty('common.couldNotLoad'); });
    }
    render();
  }

  // Markdown note editor for a client. Content is set via JS (never interpolated into
  // HTML) so a note containing </textarea> can't break out.
  function openClientNote(sid, client, name, content) {
    var isNew = !name;
    var nameField = isNew
      ? fld(t('clients.fileName'), 'cn_name', 'notes.md')
      : '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('clients.file')) + '</span><input class="wsx-field__in" id="cn_name" value="' + esc(name) + '" readonly></label>';
    var md = wsxModal(isNew ? t('clients.newNote') : name, nameField
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('clients.contentMd')) + '</span><textarea class="wsx-field__in wsx-field__ta" id="cn_body" rows="12"></textarea></label>'
      + '<div class="wsx-mt-12"><button class="wsx-abtn wsx-abtn--primary" id="cn_save" type="button">' + esc(t('clients.saveNote')) + '</button></div>');
    document.getElementById('cn_body').value = content || '';
    document.getElementById('cn_save').addEventListener('click', function () {
      var nm = cv('cn_name') || 'notes.md'; if (nm.indexOf('.md') < 0) nm += '.md';
      var body = document.getElementById('cn_body').value || '';
      if (!body.trim()) { try { alert(t('clients.writeFirst')); } catch (e) {} return; }
      var btn = this; adBusy(btn);
      fetch(wsUrl('/sharees/' + encodeURIComponent(sid) + '/context/' + encodeURIComponent(nm)), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: body }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) { if (res && res.error) { try { alert(res.error); } catch (e) {} adIdle(btn); return; } md.close(); adClientDetail(client); })
        .catch(function () { md.close(); });
    });
  }
`;
