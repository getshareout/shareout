/**
 * Update a page's data by email (lazy chunk `emailsync`): someone emails the Excel or CSV file to
 * the page's own address and its dataset updates (an `email_sheet_sync` job). Setup asks one
 * thing — who sends the file (the viewer's own address pre-filled) — with tab, file name and
 * dataset folded under "More options": PUT /v1/artifacts/{id}/email-sync/senders, then POST
 * /v1/jobs. Once on, it shows the address with a copy button, who may send, the last update and
 * the last email (GET /v1/artifacts/{id}/email-sync), and refreshes itself while open.
 */
export const workspace_client_home_views_emailSync_JS = `  // ===== Update a dataset by email — lazy chunk 'emailsync' =====
  var esMo = null, esArt = null, esDone = null, esPoll = 0;
  function esOpen() { return !!(esMo && esMo.ov.isConnected); }
  function esBody(html) { var b = esOpen() ? esMo.body.querySelector('#esBody') : null; if (b) b.innerHTML = html; return b; }
  function esBtn(attr, label, primary) { return '<button class="wsx-abtn' + (primary ? ' wsx-abtn--primary' : '') + '" type="button" ' + attr + '>' + esc(label) + '</button>'; }
  function esUrl(sub) { return '/v1/artifacts/' + encodeURIComponent(esArt.id) + '/email-sync' + (sub || ''); }
  function esReq(method, url, body) {
    var o = { method: method, credentials: 'same-origin' };
    if (body !== undefined) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d || {} }; }); });
  }
  // art: { id, name }. onDone runs when the sync is turned on or off.
  function openEmailSync(art, onDone) {
    if (!art || !art.id) return;
    if (esOpen()) esMo.close();
    esArt = art; esDone = onDone || null; esPoll++;
    esMo = wsxModal(t('esync.title'), '<div class="wsx-cform" id="esBody"></div>');
    esLoad(false);
  }
  function esLoad(justOn) {
    esBody(i18nLoad());
    esReq('GET', esUrl()).then(function (res) {
      if (!esOpen()) return;
      if (!res.ok) { esBody('<p class="wsx-cform__err" role="alert">' + esc(res.d.error || t('esync.loadFailed')) + '</p>'); return; }
      if (res.d.job) esManage(res.d, justOn); else esSetup(res.d);
    }).catch(function () { esBody('<p class="wsx-cform__err" role="alert">' + esc(t('esync.loadFailed')) + '</p>'); });
  }
  function esDate(v) { if (v == null || v === '') return null; var d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v); return isNaN(d.getTime()) ? null : d; }
  // "today 10:32" / "yesterday 18:05" / "12 Nov 09:10", in the viewer's language.
  function esWhen(v) {
    var d = esDate(v); if (!d) return '';
    var tag = locTag(), time;
    try { time = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' }); } catch (e) { time = d.toISOString().slice(11, 16); }
    var now = new Date(), y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === now.toDateString()) return t('esync.today').replace('{time}', time);
    if (d.toDateString() === y.toDateString()) return t('esync.yesterday').replace('{time}', time);
    try { return d.toLocaleString(tag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  var ES_FREE = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com'];
  // "a@x.com, b@y.com" → { list } or { err } with the sentence to show.
  function esSenders(raw) {
    var parts = String(raw || '').split(/[\\s,;]+/).filter(Boolean), list = [];
    if (!parts.length) return { err: t('esync.errWho') };
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].toLowerCase();
      var dom = /^@[a-z0-9-]+(\\.[a-z0-9-]+)+$/.test(v);
      if (!dom && !/^[^\\s@<>"]+@[a-z0-9-]+(\\.[a-z0-9-]+)+$/.test(v)) return { err: t('esync.errEmail').replace('{email}', parts[i]) };
      if (dom && ES_FREE.indexOf(v.slice(1)) !== -1) return { err: t('esync.errFreeMail').replace('{email}', v) };
      if (list.indexOf(v) === -1) list.push(v);
    }
    return { list: list };
  }
  function esSendersErr(d) {
    if (d.code === 'BAD_SENDER') return t('esync.errEmail').replace('{email}', d.param || '');
    if (d.code === 'FREE_MAIL_DOMAIN') return t('esync.errFreeMail').replace('{email}', d.param || '');
    if (d.code === 'NO_SENDERS') return t('esync.errWho');
    return d.error || t('autof.couldNotSave');
  }
  // One question (who sends it); everything else has a default, folded under "More options".
  function esSetup(st) {
    var ds = (st.datasets && st.datasets[0]) || 'data';
    var b = esBody('<p class="wsx-lens__intro">' + esc(t('esync.intro')) + '</p>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('esync.who')) + '</span><input class="wsx-field__in" id="es_who" type="email" multiple autocomplete="email" spellcheck="false" placeholder="' + esc(t('esync.whoPh')) + '" value="' + esc((st.senders && st.senders.length ? st.senders.join(', ') : st.you) || '') + '"></label>'
      + '<p class="wsx-field__note">' + esc(t('esync.whoNote')) + '</p>'
      + '<details class="wsx-adet__adv"><summary>' + esc(t('esync.more')) + '</summary>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.tab')) + '</span><input class="wsx-field__in" id="es_tab" type="text" autocomplete="off" placeholder="' + esc(t('dsync.tabPh')) + '"></label>'
      + '<p class="wsx-field__note">' + esc(t('esync.tabNote')) + '</p>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('esync.attachment')) + '</span><input class="wsx-field__in" id="es_att" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(t('esync.attachmentPh')) + '"></label>'
      + '<p class="wsx-field__note">' + esc(t('esync.attachmentNote')) + '</p>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.dataset')) + '</span><input class="wsx-field__in" id="es_ds" type="text" autocomplete="off" spellcheck="false" value="' + esc(ds) + '"></label>'
      + '<p class="wsx-field__note">' + esc(t('esync.datasetNote')) + '</p></details>'
      + '<p class="wsx-cform__err" id="es_err" role="alert"></p>'
      + '<div class="wsx-cform__foot">' + esBtn('data-es-save="1"', t('esync.save'), true) + '</div>');
    if (!b) return;
    var who = b.querySelector('#es_who'), go = b.querySelector('[data-es-save]');
    who.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
    go.addEventListener('click', function () { esSave(b, go); });
  }
  function esSave(root, btn) {
    var err = root.querySelector('#es_err'); err.textContent = '';
    var s = esSenders(root.querySelector('#es_who').value); if (s.err) { err.textContent = s.err; return; }
    var ds = root.querySelector('#es_ds').value.trim() || 'data';
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(ds)) { err.textContent = t('dsync.errName'); return; }
    var config = { dataset: ds }, tab = root.querySelector('#es_tab').value.trim(), att = root.querySelector('#es_att').value.trim();
    if (tab) config.sheet = tab;
    if (att) config.attachment = att;
    var label = btn.textContent; btn.disabled = true; btn.textContent = t('esync.saving');
    function reset(msg) { btn.disabled = false; btn.textContent = label; err.textContent = msg; }
    // Who may send comes first: the schedule refuses to exist while nobody is allowed.
    esReq('PUT', esUrl('/senders'), { senders: s.list }).then(function (res) {
      if (!res.ok) { reset(esSendersErr(res.d)); return; }
      return esReq('POST', '/v1/jobs', { artifact_id: esArt.id, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: config, title: t('esync.jobTitle') })
        .then(function (r2) {
          if (!r2.ok || !r2.d.job) { reset(r2.d.error || t('autof.couldNotSave')); return; }
          if (esDone) esDone();
          esLoad(true);
        });
    }).catch(function () { reset(t('autof.couldNotSave')); });
  }
  // What the last file did: rows written, or why it could not be used (the page kept its data).
  function esStatus(st) {
    var j = st.job || {}, up = st.lastUpdate, ranAt = esDate(j.lastRunAt), upAt = up && esDate(up.at);
    if (j.lastStatus === 'failed' && (!upAt || (ranAt && ranAt > upAt))) {
      return '<div class="wsx-esync__st is-fail" role="status"><p><b>' + esc(t('esync.failLine')) + '</b></p>' + (j.lastError ? '<p>' + esc(j.lastError) + '</p>' : '') + '<p class="wsx-field__note">' + esc(esWhen(j.lastRunAt)) + '</p></div>';
    }
    if (up) {
      var when = esWhen(ranAt && upAt && ranAt > upAt && j.lastStatus === 'success' ? j.lastRunAt : up.at);
      var line = up.rowCount != null ? t('esync.okLine').replace('{rows}', Number(up.rowCount).toLocaleString(locTag())).replace('{when}', when) : t('esync.okNoRows').replace('{when}', when);
      return '<div class="wsx-esync__st is-ok" role="status"><p><b>\\u2713 ' + esc(line) + '</b></p>' + (up.file ? '<p class="wsx-field__note">' + esc(up.file + (up.sheet ? ' \\u00b7 ' + up.sheet : '')) + '</p>' : '') + '</div>';
    }
    return '<div class="wsx-esync__st is-idle" role="status"><p>' + esc(t('esync.notYet')) + '</p></div>';
  }
  function esManage(st, justOn) {
    var j = st.job, senders = st.senders || [];
    var last = st.lastEmail
      ? esc(t('esync.lastEmailLine').replace('{from}', st.lastEmail.from || '').replace('{when}', esWhen(st.lastEmail.receivedAt))) + (st.lastEmail.files && st.lastEmail.files.length ? ' \\u00b7 ' + esc(st.lastEmail.files.join(', ')) : '')
      : esc(t('esync.noEmailYet'));
    var b = esBody('<p class="wsx-lens__intro"><b>' + esc(t(justOn ? 'esync.ready' : 'esync.sendTo')) + '</b></p>'
      + '<div class="wsx-esync__addr"><code id="es_addr">' + esc(st.address || '') + '</code>' + esBtn('data-es-copy="1"', t('esync.copy'), true) + '</div>'
      + '<p class="wsx-field__note">' + esc(t('esync.howTo').replace('{who}', senders.join(', '))) + '</p>'
      + '<div class="wsx-esync__row"><span class="wsx-field__lbl">' + esc(t('esync.senders')) + '</span><button class="wsx-link" type="button" data-es-edit="1">' + esc(t('esync.change')) + '</button></div>'
      + '<div id="es_who_box"><p class="wsx-field__note">' + esc(senders.join(', ')) + '</p></div>'
      + '<h4 class="wsx-adet__h">' + esc(t('esync.lastUpdate')) + '</h4><div id="es_status">' + esStatus(st) + '</div>'
      + '<h4 class="wsx-adet__h">' + esc(t('esync.lastEmail')) + '</h4><p class="wsx-field__note" id="es_last">' + last + '</p>'
      + '<details class="wsx-adet__adv"><summary>' + esc(t('esync.more')) + '</summary>'
      + '<p class="wsx-field__note">' + esc(t('dsync.dataset')) + ': ' + esc(j.dataset || '') + (j.sheet ? ' \\u00b7 ' + esc(t('dsync.tab')) + ': ' + esc(j.sheet) : '') + (j.attachment ? ' \\u00b7 ' + esc(j.attachment) : '') + '</p>'
      + esBtn('data-es-stop="1"', t('esync.stop'), false) + '</details>'
      + '<p class="wsx-cform__err" id="es_err" role="alert"></p>'
      + '<div class="wsx-cform__foot">' + esBtn('data-es-close="1"', t('common.close'), false) + '</div>');
    if (!b) return;
    var err = b.querySelector('#es_err');
    b.querySelector('[data-es-copy]').addEventListener('click', function () { esCopy(st.address || ''); });
    b.querySelector('[data-es-close]').addEventListener('click', function () { esMo.close(); });
    b.querySelector('[data-es-edit]').addEventListener('click', function () { esEditSenders(b, senders); });
    var stop = b.querySelector('[data-es-stop]'), armed = false;
    stop.addEventListener('click', function () {
      if (!armed) { armed = true; err.textContent = t('esync.stopConfirm'); stop.textContent = t('esync.stopSure'); return; }
      stop.disabled = true;
      esReq('DELETE', '/v1/jobs/' + encodeURIComponent(j.id)).then(function (res) {
        if (!res.ok) { stop.disabled = false; err.textContent = res.d.error || t('autof.couldNotSave'); return; }
        if (esDone) esDone();
        if (esOpen()) esMo.close();
        wsxToast(t('esync.stopped'));
      }).catch(function () { stop.disabled = false; err.textContent = t('autof.couldNotSave'); });
    });
    esWatch(++esPoll);
  }
  // While the panel is open, look again every 10 s so a file just sent shows up by itself.
  function esWatch(gen) {
    setTimeout(function () {
      if (gen !== esPoll || !esOpen()) return;
      esReq('GET', esUrl()).then(function (res) {
        if (gen !== esPoll || !esOpen() || !res.ok || !res.d.job) return;
        var s = esMo.body.querySelector('#es_status'), l = esMo.body.querySelector('#es_last');
        if (s) s.innerHTML = esStatus(res.d);
        if (l && res.d.lastEmail) l.textContent = t('esync.lastEmailLine').replace('{from}', res.d.lastEmail.from || '').replace('{when}', esWhen(res.d.lastEmail.receivedAt)) + (res.d.lastEmail.files && res.d.lastEmail.files.length ? ' \\u00b7 ' + res.d.lastEmail.files.join(', ') : '');
        esWatch(gen);
      }).catch(function () { esWatch(gen); });
    }, 10000);
  }
  function esEditSenders(root, senders) {
    var box = root.querySelector('#es_who_box'), err = root.querySelector('#es_err');
    box.innerHTML = '<label class="wsx-field"><input class="wsx-field__in" id="es_who2" type="email" multiple autocomplete="email" spellcheck="false" value="' + esc(senders.join(', ')) + '" aria-label="' + esc(t('esync.senders')) + '"></label>'
      + '<p class="wsx-field__note">' + esc(t('esync.whoNote')) + '</p>' + esBtn('data-es-who-save="1"', t('esync.saveSenders'), true);
    var inp = box.querySelector('#es_who2'), btn = box.querySelector('[data-es-who-save]');
    inp.focus();
    btn.addEventListener('click', function () {
      err.textContent = '';
      var s = esSenders(inp.value); if (s.err) { err.textContent = s.err; return; }
      btn.disabled = true;
      esReq('PUT', esUrl('/senders'), { senders: s.list }).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { err.textContent = esSendersErr(res.d); return; }
        wsxToast(t('esync.sendersSaved'));
        esLoad(false);
      }).catch(function () { btn.disabled = false; err.textContent = t('autof.couldNotSave'); });
    });
  }
  function esCopy(txt) {
    var done = function () { wsxToast(t('esync.copied')); };
    var fail = function () { var c = esMo && esMo.body.querySelector('#es_addr'); if (c && window.getSelection) { var r = document.createRange(); r.selectNodeContents(c); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, fail); return; } } catch (e) { /* fall back */ }
    fail();
  }
`;
