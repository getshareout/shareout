/**
 * Guest comments switches. Folder: an on/off switch in the access panel, for folder
 * managers (GET|PUT /v1/workspaces/{ws}/folders/{id}/guest-comments). Artifact: Follow
 * folder / On / Off in the Comments tab, for the owner (PUT /v1/data/{id}/comments/_config,
 * guestComments true | false | null). The markup helpers ship in the boot shell; the
 * wiring is the lazy `guest` chunk (lazy-chunks.ts), fetched when a panel first shows one.
 */
export const workspace_client_guest_comments_JS = `  // ----- Guest comments markup (wiring: lazy chunk 'guest') -----
  function gcFolderHtml() {
    return '<div class="wsx-field" id="fa_guest"><label class="wsx-admin__check"><input type="checkbox" role="switch" id="fa_guest_in" disabled> ' + esc(t('guestComments.folderLabel')) + '</label>'
      + '<p class="wsx-field__note">' + esc(t('guestComments.folderNote')) + '</p></div>';
  }
  function gcArtHtml(art, meta) {
    if (!art || !art.id || !meta || !meta.can_manage_comments) return '';
    return '<div class="wsx-field wsx-gc" id="wsxGuestCm" data-art="' + esc(art.id) + '"></div>';
  }
`;

/** Lazy chunk: loads and saves the switches. */
export const workspace_client_guest_comments_lazy_JS = `  // ----- Guest comments wiring (lazy chunk) -----
  var gcFolderState = {};
  var gcArtState = {};
  function gcToast(msg) { if (typeof window.showToast === 'function') window.showToast(msg, 'error'); }
  function gcFail(r, forbiddenKey) { gcToast(t(r && r.status === 403 ? forbiddenKey : 'guestComments.couldNotSave')); }
  function gcFolderUrl(fid) { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders/' + encodeURIComponent(fid) + '/guest-comments'; }
  function wireGuestFolder(fid) {
    var inp = document.getElementById('fa_guest_in'); if (!inp) return;
    function paint() { var on = gcFolderState[fid]; if (typeof on === 'boolean') { inp.checked = on; inp.disabled = false; } }
    paint();
    if (typeof gcFolderState[fid] !== 'boolean') {
      fetch(gcFolderUrl(fid), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && typeof j.guest_comments === 'boolean') { gcFolderState[fid] = j.guest_comments; var cur = document.getElementById('fa_guest_in'); if (cur === inp) paint(); } })
        .catch(function () {});
    }
    inp.addEventListener('change', function () {
      var want = inp.checked, prev = !want;
      gcFolderState[fid] = want; inp.disabled = true;
      var undo = function (r) { gcFolderState[fid] = prev; inp.checked = prev; gcFail(r, 'guestComments.forbiddenFolder'); };
      fetch(gcFolderUrl(fid), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: want }) })
        .then(function (r) { if (!r.ok) undo(r); else gcArtState = {}; })
        .catch(function () { undo(null); })
        .then(function () { inp.disabled = false; });
    });
  }
  var GC_OPTS = ['follow', 'on', 'off'];
  function gcMode(v) { return v === true ? 'on' : v === false ? 'off' : 'follow'; }
  function gcNow(st) {
    var k = st.effective ? 'guestComments.nowOn' : 'guestComments.nowOff';
    return t(st.mode === 'follow' ? k + 'Folder' : k);
  }
  function paintGuestArt(box, art) {
    var st = gcArtState[art.id]; if (!st) { box.innerHTML = ''; return; }
    box.innerHTML = '<span class="wsx-field__lbl">' + esc(t('guestComments.artifactLabel')) + '</span>'
      + '<div class="wsx-vis-seg" role="radiogroup" aria-label="' + esc(t('guestComments.artifactLabel')) + '">'
      + GC_OPTS.map(function (o) { return '<button type="button" role="radio" data-gc="' + o + '" aria-checked="' + (o === st.mode ? 'true' : 'false') + '"' + (st.busy ? ' disabled' : '') + ' class="' + (o === st.mode ? 'is-sel' : '') + '"><span class="dot"></span>' + esc(t('guestComments.opt.' + o)) + '</button>'; }).join('')
      + '</div><div class="wsx-vis-seg__sub" id="wsxGuestCmNow">' + esc(gcNow(st)) + '</div>'
      + '<p class="wsx-field__note">' + esc(t('guestComments.artifactNote')) + '</p>';
    box.querySelectorAll('[data-gc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-gc'); if (mode === st.mode || st.busy) return;
        var prev = { mode: st.mode, effective: st.effective };
        st.mode = mode; st.busy = true; paintGuestArt(box, art);
        var body = { guestComments: mode === 'on' ? true : mode === 'off' ? false : null };
        var undo = function (r) { st.mode = prev.mode; st.effective = prev.effective; gcFail(r, 'guestComments.forbiddenArtifact'); };
        fetch('/v1/data/' + encodeURIComponent(art.id) + '/comments/_config', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) {
            if (!r.ok) { undo(r); return; }
            return r.json().then(function (j) { var d = j && j.data; if (d && typeof d.guestCommentsEffective === 'boolean') st.effective = d.guestCommentsEffective; }, function () {});
          })
          .catch(function () { undo(null); })
          .then(function () { st.busy = false; if (box.isConnected) paintGuestArt(box, art); });
      });
    });
  }
  function wireGuestArt(art) {
    var box = document.getElementById('wsxGuestCm'); if (!box || !art || !art.id) return;
    if (gcArtState[art.id]) { paintGuestArt(box, art); return; }
    fetch('/v1/data/' + encodeURIComponent(art.id) + '/comments/_config', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var d = j && j.data; if (!d) return;
        gcArtState[art.id] = { mode: gcMode(d.guestComments), effective: !!d.guestCommentsEffective, busy: false };
        if (box.isConnected) paintGuestArt(box, art);
      })
      .catch(function () {});
  }
`;
