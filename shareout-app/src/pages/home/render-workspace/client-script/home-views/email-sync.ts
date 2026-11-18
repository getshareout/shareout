/**
 * Update a page's data by email (lazy chunk `emailsync`): someone emails the Excel or CSV file to
 * the page's own address and its dataset updates (an `email_sheet_sync` job). Setup asks one
 * thing — who sends the file (the viewer's own address pre-filled) — plus which data it replaces
 * only when the page shows several (GET …/email-sync `reads`); sheet and file name are folded
 * under "More options": PUT /v1/artifacts/{id}/email-sync/senders, then POST /v1/jobs. Once on, it
 * shows the address (copy, open my email), three steps, who may send, the last update, the recent
 * mails that were turned away and why (a forwarded report: one tap to allow its sender), Gmail's
 * forwarding confirmation as one step on top (Confirm → Google's own page, then whose report it
 * is), a folded "let the report arrive by itself" how-to, and refreshes itself while open.
 */
export const workspace_client_home_views_emailSync_JS = `  // ===== Update a dataset by email — lazy chunk 'emailsync' =====
  var esMo = null, esArt = null, esDone = null, esPoll = 0, esFwdSeen = '';
  function esOpen() { return !!(esMo && esMo.ov.isConnected); }
  function esBody(html) { var b = esOpen() ? esMo.body.querySelector('#esBody') : null; if (b) b.innerHTML = html; return b; }
  function esBtn(attr, label, primary) { return '<button class="wsx-abtn' + (primary ? ' wsx-abtn--primary' : '') + '" type="button" ' + attr + '>' + esc(label) + '</button>'; }
  function esUrl(sub) { return '/v1/artifacts/' + encodeURIComponent(esArt.id) + '/email-sync' + (sub || ''); }
  // t(key) with {name} placeholders filled (a function replacer, so a "$" in a value stays as typed).
  function esT(key, vars) { return t(key).replace(/\\{(\\w+)\\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function esReq(method, url, body) {
    var o = { method: method, credentials: 'same-origin' };
    if (body !== undefined) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; }); });
  }
  // art: { id, name }. onDone runs when the sync is turned on or off.
  function openEmailSync(art, onDone) {
    if (!art || !art.id) return;
    if (esOpen()) esMo.close();
    esArt = art; esDone = onDone || null; esPoll++;
    esMo = wsxModal(t('esync.title'), '<div class="wsx-cform wsx-esync" id="esBody"></div>');
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
    if (d.toDateString() === now.toDateString()) return esT('esync.today', { time: time });
    if (d.toDateString() === y.toDateString()) return esT('esync.yesterday', { time: time });
    try { return d.toLocaleString(tag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  var ES_FREE = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com'];
  var ES_ADDR = /^[^\\s@<>",;]+@[a-z0-9-]+(\\.[a-z0-9-]+)+$/, ES_DOM = /^@[a-z0-9-]+(\\.[a-z0-9-]+)+$/;
  // "a@x.com, b@y.com" → { list } or { err } with the sentence to show. Commas, semicolons and new
  // lines separate addresses; a part with spaces is one entry ("juan perez" is quoted whole),
  // unless every word in it is an address.
  function esSenders(raw) {
    var parts = String(raw || '').split(/[,;\\n]+/).map(function (p) { return p.trim(); }).filter(Boolean), flat = [], list = [];
    if (!parts.length) return { err: t('esync.errWho') };
    parts.forEach(function (p) {
      var words = p.split(/\\s+/);
      if (words.length > 1 && words.every(function (w) { return ES_ADDR.test(w.toLowerCase()); })) flat = flat.concat(words); else flat.push(p);
    });
    for (var i = 0; i < flat.length; i++) {
      var v = flat[i].toLowerCase(), dom = ES_DOM.test(v);
      if (!dom && !ES_ADDR.test(v)) return { err: esT('esync.errEmail', { email: flat[i] }) };
      if (dom && ES_FREE.indexOf(v.slice(1)) !== -1) return { err: esT('esync.errFreeMail', { email: v }) };
      if (list.indexOf(v) === -1) list.push(v);
    }
    return { list: list };
  }
  function esSendersErr(d) {
    if (d.code === 'BAD_SENDER') return esT('esync.errEmail', { email: d.param || '' });
    if (d.code === 'FREE_MAIL_DOMAIN') return esT('esync.errFreeMail', { email: d.param || '' });
    if (d.code === 'NO_SENDERS') return t('esync.errWho');
    return d.error || t('autof.couldNotSave');
  }
  // "ventas" → "ventas*" (the file name starts with it); a typed * is kept as is.
  function esPattern(v) { v = String(v || '').trim(); return !v ? '' : v.indexOf('*') === -1 ? v + '*' : v; }
  function esPatternShow(p) { return /^[^*]+\\*$/.test(p || '') ? p.slice(0, -1) : (p || ''); }
  function esReads(st) { return Array.isArray(st.reads) ? st.reads.filter(function (n) { return typeof n === 'string' && n; }) : []; }
  function esField(label, input, note) { return '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(label) + '</span>' + input + '</label>' + (note ? '<p class="wsx-field__note">' + esc(note) + '</p>' : ''); }
  function esIn(id, ph, value, extra) { return '<input class="wsx-field__in" id="' + id + '" type="text" autocomplete="off" spellcheck="false"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (value ? ' value="' + esc(value) + '"' : '') + (extra || '') + '>'; }
  function esClearOnInput(root, err) { root.querySelectorAll('input, select').forEach(function (el) { el.addEventListener('input', function () { err.textContent = ''; }); el.addEventListener('change', function () { err.textContent = ''; }); }); }
  // One question (who sends it). Which data it replaces is asked only when the page shows
  // several; one = used as is; unknown = a prefilled field under "More options".
  function esSetup(st) {
    var reads = esReads(st);
    var fixedDs = reads.length === 1 ? reads[0] : (st.suggestedDataset || (st.datasets && st.datasets[0]) || 'data');
    var ask = reads.length > 1 ? esField(t('esync.datasetAsk'), '<select class="wsx-field__in" id="es_ds"><option value="">' + esc(t('esync.datasetPick')) + '</option>'
        + reads.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</select>', t('esync.datasetAskNote')) : '';
    var b = esBody('<p class="wsx-lens__intro">' + esc(t('esync.intro')) + ' ' + esc(t('esync.noAccount')) + '</p>'
      + esField(t('esync.who'), '<input class="wsx-field__in" id="es_who" type="email" multiple autocomplete="email" spellcheck="false" placeholder="' + esc(t('esync.whoPh')) + '" value="' + esc((st.senders && st.senders.length ? st.senders.join(', ') : st.you) || '') + '">', t('esync.whoNote'))
      + ask
      + '<details class="wsx-adet__adv"><summary>' + esc(t('esync.more')) + '</summary>'
      + esField(t('esync.sheet'), esIn('es_tab', t('esync.sheetPh')), t('esync.tabNote'))
      + esField(t('esync.attachment'), esIn('es_att', t('esync.attachmentPh')), t('esync.attachmentNote'))
      + (reads.length ? '' : esField(t('esync.dataset'), esIn('es_ds', '', fixedDs), t('esync.datasetNote')))
      + '</details>'
      + '<p class="wsx-field__note wsx-esync__fine">' + esc(t('esync.excelFirst')) + '</p>'
      + '<p class="wsx-cform__err" id="es_err" role="alert"></p>'
      + '<div class="wsx-cform__foot wsx-esync__foot">' + esBtn('data-es-save="1"', t('esync.save'), true) + '</div>');
    if (!b) return;
    var who = b.querySelector('#es_who'), go = b.querySelector('[data-es-save]');
    esClearOnInput(b, b.querySelector('#es_err'));
    who.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
    go.addEventListener('click', function () { esSave(b, go, fixedDs); });
  }
  function esSave(root, btn, fixedDs) {
    var err = root.querySelector('#es_err'); err.textContent = '';
    var s = esSenders(root.querySelector('#es_who').value); if (s.err) { err.textContent = s.err; return; }
    var dsEl = root.querySelector('#es_ds'), ds = dsEl ? dsEl.value.trim() : fixedDs;
    if (!ds) { err.textContent = t(dsEl && dsEl.tagName === 'SELECT' ? 'esync.errDataset' : 'dsync.errName'); return; }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(ds)) { err.textContent = t('dsync.errName'); return; }
    var config = { dataset: ds }, tab = root.querySelector('#es_tab').value.trim(), att = esPattern(root.querySelector('#es_att').value);
    if (tab) config.sheet = tab;
    if (att) config.attachment = att;
    var label = btn.textContent; btn.disabled = true; btn.textContent = t('esync.saving');
    function reset(msg) { btn.disabled = false; btn.textContent = label; err.textContent = msg; }
    // Who may send comes first: the schedule refuses to exist while nobody is allowed.
    esReq('PUT', esUrl('/senders'), { senders: s.list }).then(function (res) {
      if (!res.ok) { reset(esSendersErr(res.d)); return; }
      return esReq('POST', '/v1/jobs', { artifact_id: esArt.id, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: config, title: t('esync.jobTitle') })
        .then(function (r2) {
          // Already on for that data (another tab or a double click): show it, nothing to undo.
          if ((!r2.ok || !r2.d.job) && r2.d.code !== 'DUPLICATE_JOB') { reset(r2.d.error || t('autof.couldNotSave')); return; }
          if (esDone) esDone();
          esLoad(true);
        });
    }).catch(function () { reset(t('autof.couldNotSave')); });
  }
  // The address may only wrap right after its "@": each half stays whole.
  function esAddr(a) {
    var at = a.lastIndexOf('@');
    if (at < 1) return '<span class="wsx-esync__nb">' + esc(a) + '</span>';
    return '<span class="wsx-esync__nb">' + esc(a.slice(0, at)) + '</span><wbr><span class="wsx-esync__nb">' + esc(a.slice(at)) + '</span>';
  }
  // What the last file did: rows written, why it could not be used (the page kept its data), or
  // waiting for the first one — plus a mail that was turned away after that, and why.
  function esStatus(st) {
    var j = st.job || {}, up = st.lastUpdate, ranAt = esDate(j.lastRunAt), upAt = up && esDate(up.at), h;
    if (j.lastStatus === 'failed' && (!upAt || (ranAt && ranAt > upAt))) {
      h = '<div class="wsx-esync__st is-fail" role="status"><p><b>' + esc(t('esync.failLine')) + '</b></p>' + (j.lastError ? '<p>' + esc(j.lastError) + '</p>' : '') + '<p class="wsx-field__note">' + esc(esWhen(j.lastRunAt)) + '</p></div>';
    } else if (up) {
      var when = esWhen(ranAt && upAt && ranAt > upAt && j.lastStatus === 'success' ? j.lastRunAt : up.at);
      var line = up.rowCount != null ? esT('esync.okLine', { rows: Number(up.rowCount).toLocaleString(locTag()), when: when }) : esT('esync.okNoRows', { when: when });
      h = '<div class="wsx-esync__st is-ok" role="status"><p><b>\\u2713 ' + esc(line) + '</b></p>' + (up.file ? '<p class="wsx-field__note">' + esc(up.file + (up.sheet ? ' \\u00b7 ' + up.sheet : '')) + '</p>' : '') + '</div>';
    } else if (st.lastEmail) {
      h = '<div class="wsx-esync__st is-idle" role="status"><p>' + esc(t('esync.notYet')) + '</p></div>';
    } else {
      h = '<div class="wsx-esync__st is-wait" role="status"><p><span class="wsx-esync__dot" aria-hidden="true"></span>' + esc(t('esync.waiting')) + '</p></div>';
    }
    // The recent mails turned away since the last file (up to three): a forwarded report whose
    // sender could be allowed gets one button that adds exactly that sender.
    var rejs = Array.isArray(st.recentRejected) ? st.recentRejected : (st.lastRejected ? [st.lastRejected] : []);
    rejs.filter(function (r) { var at = r && esDate(r.at); return at && (!upAt || at > upAt) && (!ranAt || at > ranAt); }).slice(0, 3).forEach(function (rej) {
      var allow = rej.canAllow && rej.from && (st.senders || []).indexOf(rej.from) === -1;
      h += '<div class="wsx-esync__st is-fail" data-es-rejected="1"><p>' + esc(allow ? rej.message : esT('esync.rejected', { from: rej.from || '', message: rej.message || '' })) + '</p>'
        + (allow ? '<div class="wsx-esync__acts">' + esBtn('data-es-allow="' + esc(rej.from) + '"', esT('esync.allowSender', { who: rej.from }), true) + '</div>' : '')
        + '<p class="wsx-field__note">' + esc(esWhen(rej.at) + (rej.count > 1 ? ' \u00b7 ' + esT('esync.times', { n: rej.count }) : '')) + '</p></div>';
    });
    return h;
  }
  function esLastLine(st) {
    var e = st.lastEmail; if (!e) return t('esync.noEmailYet');
    return esT('esync.lastEmailLine', { from: e.from || '', when: esWhen(e.receivedAt) }) + (e.files && e.files.length ? ' \\u00b7 ' + e.files.join(', ') : '');
  }
  function esQuote(list) { return list.map(function (n) { return '\\u201c' + n + '\\u201d'; }).join(' / '); }
  function esManage(st, justOn) {
    var j = st.job, senders = st.senders || [], reads = esReads(st), lim = st.limits || {};
    var off = st.state === 'inbox_off' || !st.address;
    var mismatch = j.datasetReadByPage === false && reads.length;
    esFwdSeen = esFwdKey(st);
    var b = esBody('<div id="es_fwd">' + esFwd(st) + '</div>' + (off
        ? '<div class="wsx-slink__warn" role="alert" data-es-off="1"><p>' + esc(t('esync.inboxOff')) + '</p>' + esBtn('data-es-on="1"', t('esync.turnBackOn'), true) + '</div>'
        : '<p class="wsx-lens__intro"><b>' + esc(t(justOn ? 'esync.ready' : 'esync.sendTo')) + '</b></p>'
          + '<div class="wsx-esync__addr"><code id="es_addr">' + esAddr(st.address) + '</code>'
          + '<div class="wsx-esync__acts">' + esBtn('data-es-copy="1"', t('esync.copy'), true)
          + '<a class="wsx-abtn" href="mailto:' + esc(st.address) + '" data-es-mailto="1">' + esc(t('esync.mailto')) + '</a></div></div>')
      + (mismatch ? '<div class="wsx-slink__warn" role="alert" data-es-dswarn="1"><p>' + esc(esT('esync.dsWarnOn', { name: j.dataset || '', reads: esQuote(reads.slice(0, 4)) })) + '</p><div class="wsx-esync__acts">'
          + reads.slice(0, 4).map(function (n) { return esBtn('data-es-useds="' + esc(n) + '"', esT('esync.fixDs', { name: n }), false); }).join('') + '</div></div>' : '')
      + '<h4 class="wsx-adet__h">' + esc(t('esync.howTitle')) + '</h4>'
      + '<ol class="wsx-esync__steps"><li>' + esc(t('esync.step1')) + '</li><li>' + esc(esT('esync.step2', { who: senders.join(', ') })) + '</li><li>' + esc(t('esync.step3')) + '</li></ol>'
      + '<p class="wsx-field__note">' + esc(esT('esync.fine', { mb: lim.fileMb || 8, rows: Number(lim.rows || 100000).toLocaleString(locTag()) })) + ' ' + esc(t('esync.excelFirst')) + '</p>'
      + esHowTo()
      + '<h4 class="wsx-adet__h">' + esc(t('esync.lastUpdate')) + '</h4><div id="es_status">' + esStatus(st) + '</div>'
      + '<div class="wsx-esync__row"><span class="wsx-field__lbl">' + esc(t('esync.senders')) + '</span><button class="wsx-link" type="button" data-es-edit="1">' + esc(t('esync.change')) + '</button></div>'
      + '<div id="es_who_box"><p class="wsx-field__note">' + esc(senders.join(', ')) + '</p></div>'
      + '<h4 class="wsx-adet__h">' + esc(t('esync.lastEmail')) + '</h4><p class="wsx-field__note" id="es_last">' + esc(esLastLine(st)) + '</p>'
      + '<details class="wsx-adet__adv"><summary>' + esc(t('esync.more')) + '</summary>'
      + '<p class="wsx-field__note">' + esc(t('esync.dataset')) + ': ' + esc(j.dataset || '') + (j.sheet ? ' \\u00b7 ' + esc(t('esync.sheet')) + ': ' + esc(j.sheet) : '') + (j.attachment ? ' \\u00b7 ' + esc(esT('esync.attStarts', { p: esPatternShow(j.attachment) })) : '') + '</p>'
      + esBtn('data-es-stop="1"', t('esync.stop'), false) + '</details>'
      + '<p class="wsx-cform__err" id="es_err" role="alert"></p>'
      + '<div class="wsx-cform__foot wsx-esync__foot">' + esBtn('data-es-close="1"', t('common.close'), false) + '</div>');
    if (!b) return;
    var err = b.querySelector('#es_err');
    esFwdBind(b, st);
    // One tap on a forwarded report that was turned away: add exactly its sender (delegated, so it
    // keeps working after the status refreshes itself).
    b.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('[data-es-allow]') : null;
      if (!a || a.disabled) return;
      var who = a.getAttribute('data-es-allow');
      a.disabled = true; err.textContent = '';
      esReq('PUT', esUrl('/senders'), { senders: senders.concat([who]) }).then(function (res) {
        if (!res.ok) { a.disabled = false; err.textContent = esSendersErr(res.d); return; }
        wsxToast(esT('esync.allowed', { who: who })); esLoad(false);
      }).catch(function () { a.disabled = false; err.textContent = t('autof.couldNotSave'); });
    });
    var copy = b.querySelector('[data-es-copy]');
    if (copy) copy.addEventListener('click', function () { esCopy(st.address || '', copy); });
    b.querySelector('[data-es-close]').addEventListener('click', function () { esMo.close(); });
    b.querySelector('[data-es-edit]').addEventListener('click', function () { esEditSenders(b, senders); });
    var on = b.querySelector('[data-es-on]');
    if (on) on.addEventListener('click', function () {
      if (!senders.length) { esEditSenders(b, senders); return; }
      on.disabled = true;
      // Saving who may send turns the address back on (same call as setup).
      esReq('PUT', esUrl('/senders'), { senders: senders }).then(function (res) {
        if (!res.ok) { on.disabled = false; err.textContent = esSendersErr(res.d); return; }
        wsxToast(t('esync.backOn')); esLoad(false);
      }).catch(function () { on.disabled = false; err.textContent = t('autof.couldNotSave'); });
    });
    b.querySelectorAll('[data-es-useds]').forEach(function (u) {
      u.addEventListener('click', function () {
        var name = u.getAttribute('data-es-useds'), config = { dataset: name };
        if (j.sheet) config.sheet = j.sheet;
        if (j.attachment) config.attachment = j.attachment;
        u.disabled = true;
        esReq('PATCH', '/v1/jobs/' + encodeURIComponent(j.id), { config: config }).then(function (res) {
          if (!res.ok) { u.disabled = false; err.textContent = res.d.error || t('autof.couldNotSave'); return; }
          if (esDone) esDone();
          wsxToast(esT('esync.fixedDs', { name: name })); esLoad(false);
        }).catch(function () { u.disabled = false; err.textContent = t('autof.couldNotSave'); });
      });
    });
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
        var s = esMo.body.querySelector('#es_status'), l = esMo.body.querySelector('#es_last'), f = esMo.body.querySelector('#es_fwd');
        if (s) s.innerHTML = esStatus(res.d);
        if (l) l.textContent = esLastLine(res.d);
        // Gmail's confirmation arriving while the panel is open shows up by itself (redrawn only
        // when it changed, so a half-typed answer is never wiped).
        if (f && esFwdKey(res.d) !== esFwdSeen) { esFwdSeen = esFwdKey(res.d); f.innerHTML = esFwd(res.d); esFwdBind(esMo.body, res.d); }
        esWatch(gen);
      }).catch(function () { esWatch(gen); });
    }, 10000);
  }
  // Gmail asks this address to confirm before it forwards (GET …/email-sync, forwarding): one step
  // on top — who asked, Confirm (Google's own page, opened in a new tab), the code if Gmail asks for
  // it, "It's not mine". Once opened: whose report will be forwarded (added to who may send), Done.
  // Only a link on Google's own host is ever rendered, whatever the server sends.
  var ES_GOOGLE = /^https:\\/\\/(?:mail-settings|mail|isolated\\.mail)\\.google\\.com\\/mail\\/vf-[A-Za-z0-9%._~-]+$/;
  function esFwdList(st) { return (Array.isArray(st.forwarding) ? st.forwarding : []).filter(function (c) { return c && c.id && ES_GOOGLE.test(String(c.confirmUrl || '')); }); }
  function esFwdKey(st) { return esFwdList(st).map(function (c) { return c.id + (c.openedAt ? '+' : ''); }).join(','); }
  function esFwd(st) {
    var c = esFwdList(st)[0];
    if (!c) return '';
    var link = function (cls, label, attr) { return '<a class="' + cls + '" href="' + esc(c.confirmUrl) + '" target="_blank" rel="noopener noreferrer"' + (attr || '') + '>' + esc(label) + '</a>'; };
    if (!c.openedAt) {
      return '<div class="wsx-slink__warn wsx-esync__fwd" role="alert" data-es-fwd="' + esc(c.id) + '">'
        + '<p><b>' + esc(esT('esync.fwdAsk', { who: c.requester })) + '</b></p>'
        + '<p>' + esc(t('esync.fwdAskWhat')) + '</p>'
        + '<div class="wsx-esync__acts">' + link('wsx-abtn wsx-abtn--primary', t('esync.fwdConfirm'), ' data-es-fwd-open="1"') + esBtn('data-es-fwd-no="1"', t('esync.fwdNotMine'), false) + '</div>'
        + (c.code ? '<p class="wsx-field__note">' + esc(esT('esync.fwdCode', { code: c.code })) + '</p>' : '')
        + (c.requesterAllowed ? '' : '<p class="wsx-field__note">' + esc(t('esync.fwdUnknown')) + '</p>')
        + '</div>';
    }
    return '<div class="wsx-slink__warn wsx-esync__fwd" data-es-fwd="' + esc(c.id) + '" data-es-fwd-opened="1">'
      + '<p><b>' + esc(esT('esync.fwdOpened', { who: c.requester })) + '</b></p>'
      + esField(t('esync.fwdWhose'), '<input class="wsx-field__in" id="es_fwd_who" type="email" autocomplete="off" spellcheck="false" placeholder="' + esc(t('esync.fwdWhosePh')) + '">', t('esync.fwdWhoseNote'))
      + '<div class="wsx-esync__acts">' + esBtn('data-es-fwd-add="1"', t('esync.fwdAdd'), true) + esBtn('data-es-fwd-done="1"', t('esync.fwdDone'), false) + '</div>'
      + '<p class="wsx-field__note">' + link('wsx-link', t('esync.fwdReopen')) + '</p>'
      + '</div>';
  }
  function esFwdBind(root, st) {
    var box = root.querySelector('[data-es-fwd]'); if (!box) return;
    var id = box.getAttribute('data-es-fwd'), err = root.querySelector('#es_err'), senders = st.senders || [];
    function act(action) { return esReq('POST', esUrl('/forwarding/' + encodeURIComponent(id)), { action: action }); }
    function fail(el) { return function () { if (el) el.disabled = false; err.textContent = t('autof.couldNotSave'); }; }
    // Confirm: the link opens Google's page in a new tab; here the step moves on to the next question.
    var open = box.querySelector('[data-es-fwd-open]');
    if (open) open.addEventListener('click', function () { act('opened').then(function () { esLoad(false); }, fail()); });
    var no = box.querySelector('[data-es-fwd-no]'), done = box.querySelector('[data-es-fwd-done]');
    [no, done].forEach(function (el) {
      if (el) el.addEventListener('click', function () {
        el.disabled = true;
        act('dismiss').then(function () { if (el === no) wsxToast(t('esync.fwdDismissed')); esLoad(false); }, fail(el));
      });
    });
    var add = box.querySelector('[data-es-fwd-add]'), who = box.querySelector('#es_fwd_who');
    if (who) esClearOnInput(box, err);
    if (who) who.addEventListener('keydown', function (e) { if (e.key === 'Enter') add.click(); });
    if (add) add.addEventListener('click', function () {
      err.textContent = '';
      var s = esSenders(who.value); if (s.err) { err.textContent = s.err; return; }
      var list = senders.slice(); s.list.forEach(function (v) { if (list.indexOf(v) === -1) list.push(v); });
      add.disabled = true;
      esReq('PUT', esUrl('/senders'), { senders: list }).then(function (res) {
        if (!res.ok) { add.disabled = false; err.textContent = esSendersErr(res.d); return; }
        return act('dismiss').then(function () { wsxToast(esT('esync.fwdAdded', { who: s.list.join(', ') })); esLoad(false); });
      }).catch(fail(add));
    });
  }
  // "Let the report arrive by itself": three steps for Gmail, three for Outlook, folded.
  function esHowTo() {
    var ol = function (keys) { return '<ol class="wsx-esync__how">' + keys.map(function (k) { return '<li>' + esc(t(k)) + '</li>'; }).join('') + '</ol>'; };
    return '<details class="wsx-adet__adv wsx-esync__howto" data-es-howto="1"><summary>' + esc(t('esync.fwdTitle')) + '</summary>'
      + '<p class="wsx-field__note">' + esc(t('esync.fwdIntro')) + '</p>'
      + '<h5>' + esc(t('esync.fwdGmail')) + '</h5>' + ol(['esync.fwdG1', 'esync.fwdG2', 'esync.fwdG3']) + '<p class="wsx-field__note">' + esc(t('esync.fwdGNote')) + '</p>'
      + '<h5>' + esc(t('esync.fwdOutlook')) + '</h5>' + ol(['esync.fwdO1', 'esync.fwdO2', 'esync.fwdO3']) + '<p class="wsx-field__note">' + esc(t('esync.fwdONote')) + '</p>'
      + '</details>';
  }
  function esEditSenders(root, senders) {
    var box = root.querySelector('#es_who_box'), err = root.querySelector('#es_err');
    box.innerHTML = '<label class="wsx-field"><input class="wsx-field__in" id="es_who2" type="email" multiple autocomplete="email" spellcheck="false" value="' + esc(senders.join(', ')) + '" aria-label="' + esc(t('esync.senders')) + '"></label>'
      + '<p class="wsx-field__note">' + esc(t('esync.whoNote')) + '</p>' + esBtn('data-es-who-save="1"', t('esync.saveSenders'), true);
    var inp = box.querySelector('#es_who2'), btn = box.querySelector('[data-es-who-save]');
    esClearOnInput(box, err);
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
  // The button itself says it worked ("✓ Copied") for two seconds.
  function esCopy(txt, btn) {
    var done = function () { if (!btn) return; btn.textContent = t('esync.copied'); setTimeout(function () { if (btn.isConnected) btn.textContent = t('esync.copy'); }, 2000); };
    var fail = function () { var c = esMo && esMo.body.querySelector('#es_addr'); if (c && window.getSelection) { var r = document.createRange(); r.selectNodeContents(c); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, fail); return; } } catch (e) { /* fall back */ }
    fail();
  }
`;
