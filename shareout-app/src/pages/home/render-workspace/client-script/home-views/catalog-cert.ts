/** Catalog lens — certification panel: who certified this entry and when, owner/admin decisions, history. */
export const workspace_client_home_views_catalogCert_JS = `  // ----- Catalog — certification (status line, owner/admin decisions, history) -----
  var catHist = {};
  function catBase() { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/catalog'; }
  function catWho(d) { var b = d && d.decided_by; return b ? (b.name || b.email || '') : ''; }
  // Copy with {who}/{when} filled from a decision; the copy is escaped, the name emphasized.
  function catFill(k, d) {
    return esc(t(k)).replace('{who}', '<strong>' + esc(catWho(d)) + '</strong>').replace('{when}', esc(fmtDay(d.decided_at, true)));
  }
  function catStaleChip(e) {
    return e && e.certification && e.certification.stale ? ' <span class="wsx-cat__chg" title="' + esc(t('catalog.certStale')) + '">' + esc(t('catalog.statusChanged')) + '</span>' : '';
  }

  function catCertLine(c) {
    var d = c.decision;
    if (c.status === 'certified' && d) return '<span class="wsx-cat__certok">' + catFill('catalog.certBy', d) + '</span>';
    if (d && d.decision === 'certified' && c.stale) return '<strong>' + esc(t('catalog.certStale')) + '.</strong> ' + catFill('catalog.certStaleSub', d);
    if (d && d.decision === 'deprecated') return catFill('catalog.deprecatedBy', d) + (c.stale ? ' ' + esc(t('catalog.deprecatedStale')) : '');
    if (d && d.decision === 'revoked') return catFill('catalog.revokedBy', d);
    if (c.status === 'deprecated') return esc(t('catalog.deprecatedDeclared'));
    return esc(t('catalog.certNone'));
  }

  function catCertActions(c) {
    if (!window.WSX_ADMIN) return c.status === 'certified' ? '' : '<p class="wsx-cat__hint">' + esc(t('catalog.certMemberHint')) + '</p>';
    var b = [];
    if (c.status !== 'certified') b.push('<button class="so-c-btn so-c-btn--primary so-c-btn--sm" type="button" data-cat-decide="certified">' + esc(t('catalog.certifyBtn')) + '</button>');
    if (c.status === 'certified') b.push('<button class="so-c-btn so-c-btn--secondary so-c-btn--sm" type="button" data-cat-decide="revoked">' + esc(t('catalog.revokeBtn')) + '</button>');
    if (c.status === 'deprecated' && c.decision && c.decision.decision === 'deprecated') b.push('<button class="so-c-btn so-c-btn--secondary so-c-btn--sm" type="button" data-cat-decide="revoked">' + esc(t('catalog.undeprecateBtn')) + '</button>');
    if (c.status !== 'deprecated') b.push('<button class="so-c-btn so-c-btn--ghost so-c-btn--sm" type="button" data-cat-decide="deprecated">' + esc(t('catalog.deprecateBtn')) + '</button>');
    return '<div class="wsx-cat__certform">'
      + (c.status === 'certified' ? '' : '<p class="wsx-cat__hint">' + esc(t('catalog.certifyHint')) + '</p>')
      + '<textarea class="so-c-textarea wsx-cat__certin" id="catCertNote" rows="2" maxlength="1000" placeholder="' + esc(t('catalog.notePlaceholder')) + '" aria-label="' + esc(t('catalog.noteLabel')) + '"></textarea>'
      + '<div class="wsx-cat__certbtns">' + b.join('') + '<span class="wsx-cat__certerr" id="catCertErr" role="alert"></span></div></div>';
  }

  function catDecisionLabel(dec) {
    return ({ certified: t('catalog.decCertified'), revoked: t('catalog.decRevoked'), deprecated: t('catalog.decDeprecated') })[dec] || dec;
  }

  function catHistHtml(hist) {
    if (!hist || !hist.length) return '';
    var rows = hist.map(function (h) {
      return '<li class="wsx-cat__hrow"><strong>' + esc(catWho(h)) + '</strong> ' + esc(catDecisionLabel(h.decision))
        + ' <span class="wsx-cat__hwhen">\\u00B7 ' + esc(fmtDay(h.decided_at, true)) + '</span>'
        + (h.current ? '' : ' <span class="wsx-cat__hold">' + esc(t('catalog.histEarlier')) + '</span>')
        + (h.note ? '<div class="wsx-cat__hnote">' + esc(h.note) + '</div>' : '') + '</li>';
    }).join('');
    return '<details class="wsx-cat__hist"><summary>' + esc(t('catalog.certHistory')) + ' <span class="wsx-cat__lcount">' + hist.length + '</span></summary><ul>' + rows + '</ul></details>';
  }

  function catCertHtml(e) {
    var c = e.certification || { status: e.status || 'draft', decision: null, stale: false };
    var d = c.decision, showNote = d && d.note && (c.status === 'certified' || d.decision === 'deprecated');
    return '<div class="wsx-cat__certline">' + catCertLine(c) + '</div>'
      + (showNote ? '<p class="wsx-cat__certnote">' + esc(d.note) + '</p>' : '')
      + catCertActions(c) + catHistHtml(catHist[e.id]);
  }

  function catPaintCert(m, id) {
    var box = document.getElementById('catCert'), e = catState.byId[id];
    if (!box || !e) return;
    // A refresh landing mid-review keeps the note the admin is typing.
    var typed = document.getElementById('catCertNote'), keep = typed ? typed.value : '';
    box.innerHTML = catCertHtml(e);
    var note = document.getElementById('catCertNote');
    if (note && keep) note.value = keep;
    var badge = document.getElementById('catDetailBadge');
    if (badge) badge.innerHTML = catBadge(e.status) + catStaleChip(e);
    box.querySelectorAll('[data-cat-decide]').forEach(function (b) {
      b.addEventListener('click', function () { catDecide(m, id, b.getAttribute('data-cat-decide')); });
    });
  }

  // Detail opened: paint from the list payload now, then refresh the entry + history.
  function catLoadCert(m, id) {
    catPaintCert(m, id);
    fetch(catBase() + '/entries/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.entry || !catState.byId[id]) return;
        catState.byId[id].status = d.entry.status;
        catState.byId[id].certification = d.entry.certification;
        catHist[id] = d.history || [];
        if (catCurrentId === id) catPaintCert(m, id);
      })
      .catch(function () {});
  }

  // A decision is about the version the admin is looking at: the hash goes along, and a
  // 409 means someone edited the entry meanwhile.
  function catDecide(m, id, decision) {
    var e = catState.byId[id], box = document.getElementById('catCert');
    if (!e || !box) return;
    var note = document.getElementById('catCertNote'), err = document.getElementById('catCertErr');
    var btns = box.querySelectorAll('[data-cat-decide]');
    btns.forEach(function (b) { b.disabled = true; });
    if (err) err.textContent = '';
    var body = { decision: decision, note: note ? note.value : '' };
    if (e.certification && e.certification.content_hash) body.content_hash = e.certification.content_hash;
    fetch(catBase() + '/entries/' + encodeURIComponent(id) + '/certify', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
      .then(okOr)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        e.status = d.status;
        e.certification = d.certification;
        catHist[id] = d.history || [];
        if (note) note.value = '';
        if (catCurrentId === id) catPaintCert(m, id);
      })
      .catch(function (x) {
        btns.forEach(function (b) { b.disabled = false; });
        if (err) err.textContent = x && x.code === 'CONFLICT' ? t('catalog.certChanged') : errReason(x, t('catalog.certFailed'));
      });
  }

`;
