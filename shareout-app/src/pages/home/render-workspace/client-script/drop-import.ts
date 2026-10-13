/**
 * One-step import on the Home: drop files (or paste files, HTML, or a Claude/ChatGPT/
 * Gemini share link) and each becomes a private artifact in the current workspace and
 * folder (POST /v1/home/import), or — images, video, anything without a viewer — an
 * asset via the Assets upload (uploadOne, which also triggers AI enrichment). Only
 * wired where the New button renders (template.ts canCreateHere); the API re-checks.
 */
import { IMPORT_ARTIFACT_EXTS, IMPORT_MAX_BYTES, IMPORT_SHARE_HOSTS } from '../../import-rules';

export const workspace_client_drop_import_JS = `  // ===== One-step import: drop or paste on the Home → artifact (or Assets) =====
  var DROP_EXTS = ${JSON.stringify(Object.keys(IMPORT_ARTIFACT_EXTS))};
  var DROP_HOSTS = ${JSON.stringify(IMPORT_SHARE_HOSTS)};
  var DROP_MAX = ${IMPORT_MAX_BYTES};
  var DROP_LIVE = { html: 1, csv: 1, json: 1 };
  var DROP_ERR = { RATE_LIMIT_EXCEEDED: 'drop.err.limit', STORAGE_LIMIT_EXCEEDED: 'drop.err.quota', FILE_TOO_LARGE: 'drop.err.tooBig', UNSUPPORTED_TYPE: 'drop.err.type', URL_NOT_FETCHABLE: 'drop.err.url', URL_NOT_SUPPORTED: 'drop.err.url' };
  var dropPanel = null, dropOverlay = null, dropDepth = 0;
  function dropExt(n) { var m = /\\.([a-z0-9]+)$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
  function dropIsShareLink(s) {
    try { var u = new URL(s); return u.protocol === 'https:' && DROP_HOSTS.some(function (h) { return u.hostname === h || u.hostname.slice(-h.length - 1) === '.' + h; }); } catch (e) { return false; }
  }
  function dropLooksHtml(s) { s = String(s || '').trim(); return /^<(!doctype html|html|head|body)[\\s>]/i.test(s) || (/^<[a-z]/i.test(s) && /<\\/(html|body|div|main|section|svg|table)>$/i.test(s)); }
  function dropOnHome() { return typeof activeKey !== 'string' || activeKey === 'home'; }
  function dropEditable(el) { return !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))); }
  function dropItems(list) {
    return Array.prototype.map.call(list || [], function (f) { return { kind: DROP_EXTS.indexOf(dropExt(f.name)) >= 0 ? 'file' : 'asset', file: f, label: f.name }; });
  }
  function dropRow(label) {
    if (!dropPanel) {
      dropPanel = document.createElement('div'); dropPanel.className = 'wsx-drop'; dropPanel.setAttribute('role', 'status');
      dropPanel.innerHTML = '<div class="wsx-drop__head"><b>' + esc(t('drop.title')) + '</b><button type="button" class="wsx-drop__x" aria-label="' + esc(t('drop.close')) + '">\\u00d7</button></div><ul class="wsx-drop__list"></ul>';
      dropPanel.querySelector('.wsx-drop__x').addEventListener('click', function () { dropPanel.remove(); dropPanel = null; });
      document.body.appendChild(dropPanel);
    }
    var li = document.createElement('li'); li.className = 'wsx-drop__row';
    li.innerHTML = '<span class="wsx-drop__name"></span><span class="wsx-drop__st"></span>';
    li.firstChild.textContent = label;
    dropPanel.querySelector('.wsx-drop__list').appendChild(li);
    dropSet(li, 'busy', t('drop.working'));
    return li;
  }
  function dropSet(li, state, msg) { li.setAttribute('data-state', state); li.children[1].textContent = msg; }
  function dropDone(li, d) {
    dropSet(li, d.moderation ? 'warn' : 'ok', t(d.moderation ? 'drop.held' : 'drop.done'));
    var acts = document.createElement('span'); acts.className = 'wsx-drop__acts';
    acts.innerHTML = '<button type="button" class="wsx-link" data-drop="open">' + esc(t('drop.open')) + '</button>'
      + (DROP_LIVE[d.type] ? '<button type="button" class="wsx-link" data-drop="live">' + esc(t('drop.live')) + '</button>' : '');
    acts.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-drop');
      if (a === 'open') openArtifact(d.slug, d.name, d.artifactId);
      else if (a === 'live') agentAsk(t('drop.liveAsk').replace('{name}', d.name).replace('{id}', d.artifactId));
    });
    li.appendChild(acts);
  }
  function dropErr(e) { var k = e && DROP_ERR[e.code]; return k ? t(k).replace('{mb}', String(DROP_MAX / 1048576)) : ((e && e.message) || t('drop.err.generic')); }
  function dropPost(payload) {
    payload.lang = typeof window.__SO_HOME_LOCALE === 'function' ? window.__SO_HOME_LOCALE() : 'en';
    if (typeof curFolder === 'string' && curFolder) payload.folder = curFolder;
    return fetch('/v1/home/import' + (window.WSX_WS ? '?workspace=' + encodeURIComponent(window.WSX_WS) : ''), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok && j && j.slug) return j;
        var err = new Error((j && j.error) || ''); err.code = (j && j.code) || (r.status === 429 ? 'RATE_LIMIT_EXCEEDED' : ''); throw err;
      });
    });
  }
  function dropRead(f) {
    return new Promise(function (ok, no) {
      var r = new FileReader(), bin = dropExt(f.name) === 'pdf';
      r.onload = function () { ok(bin ? { name: f.name, content: String(r.result).split(',')[1] || '', encoding: 'base64' } : { name: f.name, content: String(r.result) }); };
      r.onerror = function () { no(new Error('')); };
      if (bin) r.readAsDataURL(f); else r.readAsText(f);
    });
  }
  function dropOne(item, out) {
    var li = dropRow(item.label);
    if (item.kind === 'asset') {
      dropSet(li, 'busy', t('drop.uploading'));
      return new Promise(function (done) {
        uploadOne(item.file, null, function (ok, msg) { if (ok === false) dropSet(li, 'err', msg || t('drop.err.generic')); else { dropSet(li, 'ok', t('drop.toAssets')); out.assets = true; } done(); }, 'private');
      });
    }
    if (item.file && item.file.size > DROP_MAX) { dropSet(li, 'err', dropErr({ code: 'FILE_TOO_LARGE' })); return Promise.resolve(); }
    var p = item.kind === 'file' ? dropRead(item.file).then(dropPost) : dropPost(item.kind === 'url' ? { url: item.value } : { html: item.value });
    return p.then(function (d) { dropDone(li, d); out.published.push(d); }, function (e) { dropSet(li, 'err', dropErr(e)); });
  }
  // Sequential, so per-file rows settle in order and a 429 shows on each remaining file.
  function importDropped(items) {
    if (!items.length) return Promise.resolve();
    var out = { published: [], assets: false };
    return items.reduce(function (p, it) { return p.then(function () { return dropOne(it, out); }); }, Promise.resolve()).then(function () {
      if (out.published.length && typeof reloadFolders === 'function') reloadFolders();
      if (out.assets && typeof fetchAssets === 'function' && document.getElementById('wsxAssetMount')) fetchAssets();
      if (items.length === 1 && out.published.length === 1) { var d = out.published[0]; openArtifact(d.slug, d.name, d.artifactId); }
    });
  }
  function dropShowOverlay(on) {
    if (on && !dropOverlay) {
      dropOverlay = document.createElement('div'); dropOverlay.className = 'wsx-dropzone';
      dropOverlay.innerHTML = '<div class="wsx-dropzone__card"><b>' + esc(t('drop.overlay')) + '</b><span>' + esc(t('drop.overlayHint')) + '</span></div>';
      document.body.appendChild(dropOverlay);
    } else if (!on && dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
  }
  function dropHasFiles(e) { var ty = e.dataTransfer && e.dataTransfer.types; return !!ty && Array.prototype.indexOf.call(ty, 'Files') >= 0; }
  if (newBtn) {
    ws.addEventListener('dragenter', function (e) { if (!dropHasFiles(e) || !dropOnHome()) return; dropDepth++; dropShowOverlay(true); });
    ws.addEventListener('dragleave', function (e) { if (!dropHasFiles(e)) return; dropDepth = Math.max(0, dropDepth - 1); if (!dropDepth) dropShowOverlay(false); });
    ws.addEventListener('dragover', function (e) { if (!dropHasFiles(e) || !dropOnHome()) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {} });
    ws.addEventListener('drop', function (e) {
      if (!dropHasFiles(e) || !dropOnHome()) return;
      e.preventDefault(); dropDepth = 0; dropShowOverlay(false);
      importDropped(dropItems(e.dataTransfer.files));
    });
    // Paste on the Home (not into a field): files, a share link, or HTML source.
    document.addEventListener('paste', function (e) {
      if (!dropOnHome() || dropEditable(e.target) || dropEditable(document.activeElement)) return;
      var cd = e.clipboardData; if (!cd) return;
      if (cd.files && cd.files.length) { e.preventDefault(); importDropped(dropItems(cd.files)); return; }
      var txt = String(cd.getData('text/plain') || '').trim();
      if (dropIsShareLink(txt)) { e.preventDefault(); importDropped([{ kind: 'url', value: txt, label: txt }]); }
      else if (dropLooksHtml(txt)) { e.preventDefault(); importDropped([{ kind: 'html', value: txt, label: t('drop.pastedHtml') }]); }
    });
  }

`;
