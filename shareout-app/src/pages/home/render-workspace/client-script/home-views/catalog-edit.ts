/** Catalog lens — edit an entry in place: title, domain, owner, tags, aliases, related terms and prose. */
export const workspace_client_home_views_catalogEdit_JS = `  // ----- Catalog — edit an entry (any member; id, kind and status stay fixed) -----
  function catSplit(s) {
    var seen = {}, out = [];
    String(s || '').split(',').forEach(function (x) { x = x.trim(); if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function catEditField(name, labelKey, value, opts) {
    opts = opts || {};
    var id = 'catEd_' + name;
    var control = opts.rows
      ? '<textarea class="so-c-textarea wsx-cat__edbody" id="' + id + '" name="' + name + '" rows="' + opts.rows + '">' + esc(value) + '</textarea>'
      : '<input class="so-c-input" id="' + id + '" name="' + name + '" type="text" value="' + esc(value) + '"' + (opts.required ? ' required' : '') + ' maxlength="300" autocomplete="off">';
    return '<div class="so-c-field"><label class="so-c-label" for="' + id + '">' + esc(t(labelKey)) + '</label>' + control
      + (opts.hint ? '<span class="so-c-hint">' + esc(t(opts.hint)) + '</span>' : '') + '</div>';
  }

  function catEdit(m, id) {
    var e = catState.byId[id]; if (!e) return;
    var certified = e.certification && e.certification.status === 'certified';
    m.innerHTML = '<button class="wsx-cat__back" id="catBack" type="button">' + esc(t('catalog.back')) + '</button>'
      + '<div class="wsx-cat__dhead"><span class="wsx-atbl__type">' + esc(catKindLabel(e.kind)) + '</span><h3>' + esc(t('catalog.editTitle')) + '</h3></div>'
      + '<div class="wsx-sched__meta">' + esc(e.id) + '</div>'
      + '<form class="wsx-cat__edit" id="catEditForm" novalidate>'
      + (certified ? '<p class="wsx-cat__hint wsx-cat__edwarn">' + esc(t('catalog.editCertified')) + '</p>' : '')
      + catEditField('title', 'catalog.editName', e.title, { required: true })
      + '<div class="wsx-cat__edrow">' + catEditField('domain', 'catalog.metaDomain', e.domain || '') + catEditField('owner', 'catalog.metaOwner', e.owner || '') + '</div>'
      + catEditField('tags', 'catalog.metaTags', (e.tags || []).join(', '), { hint: 'catalog.editListHint' })
      + catEditField('aliases', 'catalog.editAliases', (e.aliases || []).join(', '), { hint: 'catalog.editListHint' })
      + catEditField('terms', 'catalog.metaTerms', (e.terms || []).join(', '), { hint: 'catalog.editTermsHint' })
      + catEditField('body', 'catalog.editBody', e.body || '', { rows: 14, hint: 'catalog.editBodyHint' })
      + '<div class="wsx-cat__certbtns"><button class="so-c-btn so-c-btn--primary so-c-btn--sm" type="submit" id="catEditSave">' + esc(t('common.save')) + '</button>'
      + '<button class="so-c-btn so-c-btn--secondary so-c-btn--sm" type="button" id="catEditCancel">' + esc(t('common.cancel')) + '</button>'
      + '<span class="wsx-cat__certerr" id="catEditErr" role="alert"></span></div>'
      + '</form>';
    var close = function () { catDetail(m, id); };
    document.getElementById('catBack').addEventListener('click', close);
    document.getElementById('catEditCancel').addEventListener('click', close);
    var form = document.getElementById('catEditForm');
    form.addEventListener('submit', function (ev) { ev.preventDefault(); catSaveEdit(m, id, form); });
    var title = document.getElementById('catEd_title'); if (title) title.focus();
  }

  // Only the fields that differ go to the server, so an untouched list keeps its exact YAML.
  function catEditDiff(e, form) {
    var v = function (n) { return form.querySelector('[name="' + n + '"]').value; };
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var edit = {};
    var title = v('title').trim(); if (title !== e.title) edit.title = title;
    ['domain', 'owner'].forEach(function (k) { var s = v(k).trim(); if (s !== (e[k] || '')) edit[k] = s; });
    ['tags', 'aliases', 'terms'].forEach(function (k) { var l = catSplit(v(k)); if (!same(l, e[k] || [])) edit[k] = l; });
    var body = v('body').trim(); if (body !== (e.body || '').trim()) edit.body = body;
    return edit;
  }

  function catSaveEdit(m, id, form) {
    var e = catState.byId[id], err = document.getElementById('catEditErr'), save = document.getElementById('catEditSave');
    if (!e) return;
    if (err) err.textContent = '';
    if (!form.querySelector('[name="title"]').value.trim()) { if (err) err.textContent = t('catalog.editNameRequired'); return; }
    var edit = catEditDiff(e, form);
    if (!Object.keys(edit).length) { catDetail(m, id); return; }
    if (save) { save.disabled = true; save.textContent = t('common.saving'); }
    fetch(catBase() + '/entries/' + encodeURIComponent(id), {
      method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(edit)
    })
      .then(okOr)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var next = d.entry;
        var i = catState.entries.indexOf(e);
        if (i >= 0) catState.entries[i] = next;
        catState.byId[next.id] = next;
        catState.facets = catEditFacets(catState.entries);
        catDetail(m, next.id);
      })
      .catch(function (x) {
        if (save) { save.disabled = false; save.textContent = t('common.save'); }
        if (err) err.textContent = errReason(x, t('catalog.editFailed'));
      });
  }

  // A saved domain can add or empty a filter value: recount the list's facets locally.
  function catEditFacets(es) {
    function tally(vals) {
      var c = {}; vals.forEach(function (v) { if (v) c[v] = (c[v] || 0) + 1; });
      return Object.keys(c).map(function (k) { return { value: k, count: c[k] }; })
        .sort(function (a, b) { return b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0); });
    }
    return {
      kind: tally(es.map(function (x) { return x.kind; })),
      domain: tally(es.map(function (x) { return x.domain; })),
      status: tally(es.map(function (x) { return x.status; })),
      tag: tally([].concat.apply([], es.map(function (x) { return x.tags || []; }))),
    };
  }

`;
