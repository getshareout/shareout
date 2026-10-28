/** Crew AI automations: run, pause, delete, run history, and a detail page per task (#l/crew/<triggerId>). */
export const workspace_client_home_views_crew_JS = `  // ----- Crew AI — workspace automations: run / pause / delete + run history -----
  function crewRuns(id, host) {
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/automations/' + encodeURIComponent(id) + '/runs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var runs = (d && d.runs) || [];
        if (!runs.length) { host.innerHTML = '<span class="wsx-sched__noruns">' + esc(t('crew.noRuns')) + '</span>'; return; }
        host.innerHTML = runs.slice(0, 24).reverse().map(function (r) {
          return runBar(r.status, 'crew', r.id);
        }).join('');
        wireBars(host);
      }).catch(function () { host.innerHTML = ''; });
  }
  // Run now streams the run (SSE) into a step log on the card, so the user sees
  // each tool call as it happens instead of a button stuck on "Running…".
  function crewRunLive(b, card, base, onDone) {
    var log = card.querySelector('.wsx-crewlog');
    if (!log) { log = document.createElement('div'); log.className = 'wsx-crewlog'; log.setAttribute('aria-live', 'polite'); card.insertBefore(log, card.querySelector('.wsx-sched__actions, .wsx-adet__acts')); }
    log.innerHTML = ''; var thinking = null, started = false, ended = false;
    function line(text, cls) { var el = document.createElement('div'); el.className = 'wsx-crewlog__ln' + (cls ? ' ' + cls : ''); el.textContent = text; log.appendChild(el); log.scrollTop = log.scrollHeight; return el; }
    function onEvent(ev) {
      if (ev.type === 'run_start') { started = true; line(t('crew.started')); }
      else if (ev.type === 'reasoning') { if (!thinking) thinking = line(t('crew.thinking')); }
      else if (ev.type === 'tool_call') { thinking = null; line(t('crew.usingTool').replace('{tool}', ev.tool)); }
      else if (ev.type === 'tool_result') line(t(ev.is_error ? 'crew.toolFailed' : 'crew.toolDone').replace('{tool}', ev.tool), ev.is_error ? 'is-fail' : '');
      else if (ev.type === 'finish') line(ev.summary || t('crew.finished'), 'is-ok');
      else if (ev.type === 'error') line(ev.error || t('crew.couldNotRun'), 'is-fail');
      else if (ev.type === 'done') {
        ended = true; var ok = ev.terminationReason === 'goal_met';
        line(t(ok ? 'crew.doneOk' : 'crew.doneStopped').replace('{n}', ev.iterations || 0).replace('{reason}', String(ev.terminationReason || '').replace(/_/g, ' ')), ok ? 'is-ok' : 'is-fail');
      }
    }
    b.disabled = true; b.textContent = t('crew.running');
    fetch(base + '/run', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'text/event-stream' } })
      .then(function (r) {
        if (!r.ok || !r.body) return r.json().catch(function () { return null; }).then(function (d) { throw new Error((d && d.error) || t('crew.couldNotRun')); });
        var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) return;
            buf += dec.decode(res.value, { stream: true });
            var parts = buf.split('\\n\\n'); buf = parts.pop();
            parts.forEach(function (chunk) { try { onEvent(JSON.parse(chunk.replace(/^data: ?/, ''))); } catch (e) {} });
            return pump();
          });
        }
        return pump();
      })
      .then(function () { if (!ended) line(t('crew.streamLost'), 'is-fail'); })
      .catch(function (err) { line(started ? t('crew.streamLost') : (err instanceof TypeError ? t('crew.couldNotRun') : err.message), 'is-fail'); })
      .then(function () { b.disabled = false; b.textContent = t('crew.runNow'); if (onDone) onDone(); else crewRuns(card.getAttribute('data-crew'), card.querySelector('[data-crew-runs]')); });
  }
  // Crews deleted optimistically whose DELETE hasn't landed — a reload must not show them.
  var crewPendingDel = {};
  function crewPaintEnabled(card, on) {
    card.setAttribute('data-crew-enabled', on ? '1' : '0');
    var badge = card.querySelector('.wsx-sched__badge'); if (badge) { badge.textContent = on ? t('crew.badgeOn') : t('crew.badgePaused'); badge.classList.toggle('ok', on); }
    var tb = card.querySelector('[data-crew-act="toggle"]'); if (tb) tb.textContent = on ? t('crew.pause') : t('crew.resume');
  }
  function loadCrew() {
    var m = document.getElementById('wsxCrewMount'); if (needWs(m)) return;
    m.innerHTML = i18nLoad();
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/automations', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var a = ((d && d.automations) || []).filter(function (c) { return !crewPendingDel[c.id]; });
        crewList = a; crewModels = (d && d.models) || [];
        if (crewDetail) { renderCrewDetail(); return; }
        if (!a.length) {
          m.innerHTML = '<div class="wsx-qa-grid wsx-qa-grid--lens"><button class="wsx-qa" data-newauto="' + esc(t('crew.prefillChat')) + '" type="button"><span class="wsx-qa__ic">' + isvg('<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>') + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('crew.emptyChat')) + '</span><span class="wsx-qa__s">' + esc(t('crew.emptyChatSub')) + '</span></span></button></div>';
          wireNewAuto(m); return;
        }
        m.innerHTML = runsLink() + a.map(function (c) {
          var trig = c.kind === 'cron' ? cronHuman(c.cron) : t('crew.onEvent').replace('{event}', c.event_type || t('crew.eventDefault'));
          var model = (c.crew_model || '').replace('claude-', '').replace(/-\\d+$/, '');
          var stLbl = c.enabled ? t('crew.badgeOn') : t('crew.badgePaused'); var stc = c.enabled ? 'ok' : '';
          return '<div class="wsx-sched" data-crew="' + esc(c.id) + '" data-crew-enabled="' + (c.enabled ? '1' : '0') + '">'
            + '<div class="wsx-sched__head"><button class="wsx-sched__title wsx-sched__open" type="button" data-crew-open>' + isvg('<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>') + ' ' + esc(c.crew_name || t('crew.defaultName')) + '</button><span class="wsx-sched__badge ' + stc + '">' + esc(stLbl) + '</span></div>'
            + '<div class="wsx-sched__flow">' + (c.artifact_name ? schedChip(c.artifact_name, 'doc', 'is-origin') : '') + (model ? '<span class="wsx-sched__chip">' + isvg(SCHED_ICON.check) + '<span>' + esc(model) + '</span></span>' : '') + '</div>'
            + '<div class="wsx-sched__meta"><span class="wsx-sched__when">' + isvg(SCHED_ICON.clock) + esc(trig) + '</span>' + (c.last_run_at ? '<span>' + esc(t('crew.last')) + ' ' + esc(whenAgo(Date.parse(c.last_run_at))) + '</span>' : '') + (c.owner_name ? '<span>' + esc(t('crew.by')) + ' ' + esc(c.owner_name) + '</span>' : '') + '</div>'
            + '<div class="wsx-runbars" data-crew-runs="' + esc(c.id) + '"><span class="wsx-sched__noruns">' + esc(t('sched.loadingRuns')) + '</span></div>'
            + '<div class="wsx-sched__actions"><button class="wsx-abtn" data-crew-act="run" type="button">' + esc(t('crew.runNow')) + '</button><button class="wsx-abtn" data-crew-act="toggle" type="button">' + esc(c.enabled ? t('crew.pause') : t('crew.resume')) + '</button><button class="wsx-abtn danger" data-crew-act="del" type="button">' + esc(t('crew.delete')) + '</button></div>'
            + '</div>';
        }).join('');
        m.querySelectorAll('[data-crew-runs]').forEach(function (h) { crewRuns(h.getAttribute('data-crew-runs'), h); });
        m.querySelectorAll('[data-crew-open]').forEach(function (b) { b.addEventListener('click', function () { crewOpen(b.closest('[data-crew]').getAttribute('data-crew')); }); });
        wireOpenCards(m, 'data-crew', crewOpen);
        m.querySelectorAll('[data-crew-act]').forEach(function (b) {
          b.addEventListener('click', function () {
            var card = b.closest('[data-crew]'); var id = card.getAttribute('data-crew'); var act = b.getAttribute('data-crew-act');
            var base = '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/automations/' + encodeURIComponent(id);
            if (act === 'run') crewRunLive(b, card, base);
            else if (act === 'toggle') {
              var on = card.getAttribute('data-crew-enabled') === '1';
              optimistic({
                key: 'crew-toggle:' + id,
                apply: function () { crewPaintEnabled(card, !on); },
                rollback: function () { crewPaintEnabled(card, on); },
                request: function () { return fetch(base, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) }); },
                success: on ? t('crew.pausedToast') : t('crew.resumedToast'),
                error: t('crew.couldNotUpdate'),
                done: function () { loaded.crew = 0; },
              });
            }
            else if (act === 'del') {
              if (!window.confirm(t('crew.deleteConfirm'))) return;
              var h = null;
              optimistic({
                key: 'crew-del:' + id, undo: true,
                apply: function () { crewPendingDel[id] = true; h = window.soOptimistic.leave(card); },
                rollback: function () { delete crewPendingDel[id]; h.restore(); if (!card.isConnected) { loaded.crew = 0; loadCrew(); } },
                request: function () { return fetch(base, { method: 'DELETE', credentials: 'same-origin', keepalive: true }); },
                success: t('crew.deleted'),
                error: t('crew.couldNotDelete'),
                done: function () { delete crewPendingDel[id]; h.commit(); loaded.crew = 0; },
              });
            }
          });
        });
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

  // ===== AI task detail page (#l/crew/<triggerId>) =====
  var crewDetail = '';
  var crewList = null;       // the lens payload, kept so a card opens at once
  var crewModels = [];
  var crewEditing = false;
  function crewRoute(id) {
    crewDetail = id || ''; crewEditing = false;
    if (!crewList) return;
    if (crewDetail) renderCrewDetail(); else loadCrew();
  }
  function crewOpen(id) { crewRoute(id); syncHash(); }
  // claude-sonnet-5-5 → Sonnet 5.5, claude-haiku-4-5-20251001 → Haiku 4.5
  function crewModelLabel(id) { var s = String(id || '').replace('claude-', '').replace(/-\\d{8}$/, '').replace(/-(\\d+)-(\\d+)$/, ' $1.$2').replace(/-/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function crewUsd(micro) { return micro == null ? '' : 'US$ ' + (micro / 1e6).toFixed(2); }
  function crewDur(a, b) { var x = Date.parse(a), y = Date.parse(b); return x && y && y >= x ? durLabel(y - x) : ''; }
  function crewBase(c) { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/automations/' + encodeURIComponent(c.id); }
  function crewDetailRuns(c, host) {
    fetch(crewBase(c) + '/runs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!host.isConnected) return;
        host.innerHTML = adetRuns(((d && d.runs) || []).map(function (r) {
          var note = r.result_text || String(r.termination_reason || '').replace(/_/g, ' ');
          return { id: r.id, surface: 'crew', status: r.status === 'running' ? 'running' : r.status, at: r.started_at, dur: crewDur(r.started_at, r.ended_at), note: note };
        }));
        adetWireRuns(host);
      }).catch(function () { host.innerHTML = i18nError('common.couldNotLoad'); });
  }
  function crewField(label, id, value, opts) {
    opts = opts || {};
    var input = opts.area
      ? '<textarea class="wsx-field__in" id="' + id + '" rows="' + (opts.rows || 4) + '">' + esc(value == null ? '' : value) + '</textarea>'
      : '<input class="wsx-field__in" id="' + id + '" type="' + (opts.type || 'text') + '"' + (opts.step ? ' step="' + opts.step + '" min="' + (opts.min || 0) + '"' : '') + ' autocomplete="off" value="' + esc(value == null ? '' : value) + '">';
    return '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(label) + '</span>' + input + (opts.note ? '<span class="wsx-field__note">' + esc(opts.note) + '</span>' : '') + '</label>';
  }
  function crewEditHtml(c) {
    var models = crewModels.length ? crewModels : [c.crew_model];
    if (c.crew_model && models.indexOf(c.crew_model) < 0) models = [c.crew_model].concat(models);
    return '<div class="wsx-cform wsx-adet__form">'
      + crewField(t('adet.name'), 'cd_name', c.crew_name || '')
      + crewField(t('adet.instructions'), 'cd_instr', c.crew_instructions || '', { area: true, rows: 12, note: t('adet.instructionsNote') })
      + afSel(t('adet.model'), 'cd_model', models.map(function (id) { return afOpt(id, crewModelLabel(id), id === c.crew_model); }).join(''))
      + (c.kind === 'cron' ? '<h4 class="wsx-adet__h">' + esc(t('adet.schedule')) + '</h4>' + afScheduleFields('cd', c.cron) : '')
      + '<h4 class="wsx-adet__h">' + esc(t('adet.limits')) + '</h4><div class="wsx-cform__row">'
      + crewField(t('adet.maxSteps'), 'cd_iter', c.crew_max_iterations, { type: 'number', step: '1', min: 1 })
      + crewField(t('adet.budget'), 'cd_budget', c.crew_run_budget_micro_usd == null ? '' : (c.crew_run_budget_micro_usd / 1e6).toFixed(2), { type: 'number', step: '0.01', min: 0 }) + '</div>'
      + '<div class="wsx-cform__err" id="cd_err" role="alert"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn" type="button" data-cd="cancel">' + esc(t('autof.cancel')) + '</button>'
      + '<button class="wsx-abtn wsx-abtn--primary" type="button" data-cd="save">' + esc(t('adet.save')) + '</button></div></div>';
  }
  function crewSave(c, root, btn) {
    var err = root.querySelector('#cd_err'); err.textContent = '';
    function v(id) { return root.querySelector('#' + id).value; }
    var body = {};
    var name = v('cd_name').trim(); if (!name) { err.textContent = t('adet.errName'); return; }
    if (name !== (c.crew_name || '')) body.name = name;
    var instr = v('cd_instr'); if (!instr.trim()) { err.textContent = t('adet.errInstructions'); return; }
    if (instr !== (c.crew_instructions || '')) body.instructions = instr;
    if (v('cd_model') && v('cd_model') !== c.crew_model) body.model = v('cd_model');
    if (c.kind === 'cron') { var sc = afReadSchedule(root, 'cd'); if (sc.err) { err.textContent = t(sc.err); return; } if (sc.cron !== c.cron) body.cron = sc.cron; }
    var it = parseInt(v('cd_iter'), 10); if (v('cd_iter') !== '' && it !== c.crew_max_iterations) body.maxIterations = it;
    var usd = parseFloat(v('cd_budget')); if (v('cd_budget') !== '' && isFinite(usd)) { var micro = Math.round(usd * 1e6); if (micro !== c.crew_run_budget_micro_usd) body.runBudgetMicroUsd = micro; }
    if (!Object.keys(body).length) { crewEditing = false; renderCrewDetail(); return; }
    var label = btn.textContent; btn.disabled = true; btn.textContent = t('common.saving');
    fetch(crewBase(c), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = label;
        if (!res.ok) { err.textContent = (res.d && res.d.error) || t('autof.couldNotSave'); return; }
        if (body.name) c.crew_name = body.name;
        if (body.instructions !== undefined) c.crew_instructions = body.instructions;
        if (body.model) c.crew_model = body.model;
        if (body.maxIterations !== undefined) c.crew_max_iterations = body.maxIterations;
        if (body.runBudgetMicroUsd !== undefined) c.crew_run_budget_micro_usd = body.runBudgetMicroUsd;
        if (res.d) { c.cron = res.d.cron != null ? res.d.cron : c.cron; c.next_run_at = res.d.next_run_at || c.next_run_at; }
        crewEditing = false; renderCrewDetail(); wsxToast(t('adet.saved'));
      })
      .catch(function () { btn.disabled = false; btn.textContent = label; err.textContent = t('autof.couldNotSave'); });
  }
  function crewDetailToggle(c) {
    var on = !!c.enabled;
    fetch(crewBase(c), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) })
      .then(function (r) {
        if (!r.ok) { wsxToast(t('crew.couldNotUpdate'), true); return; }
        c.enabled = !on; renderCrewDetail(); wsxToast(t(on ? 'crew.pausedToast' : 'crew.resumedToast'));
      })
      .catch(function () { wsxToast(t('crew.couldNotUpdate'), true); });
  }
  function crewDetailDelete(c) {
    if (!window.confirm(t('crew.deleteConfirm'))) return;
    fetch(crewBase(c), { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) { wsxToast(t('crew.couldNotDelete'), true); return; }
        crewList = crewList.filter(function (x) { return x.id !== c.id; });
        wsxToast(t('crew.deleted')); crewRoute(''); syncHash();
      })
      .catch(function () { wsxToast(t('crew.couldNotDelete'), true); });
  }
  function renderCrewDetail() {
    var m = document.getElementById('wsxCrewMount'); if (!m) return;
    var c = (crewList || []).filter(function (x) { return x.id === crewDetail; })[0];
    var back = '<button class="wsx-cat__back" type="button" data-cd="back">' + esc(t('adet.backCrew')) + '</button>';
    if (!c) { m.innerHTML = '<div class="wsx-adet-page">' + back + '<div class="wsx-empty">' + esc(t('adet.notFound')) + '</div></div>'; m.firstChild.querySelector('[data-cd="back"]').addEventListener('click', function () { crewRoute(''); syncHash(); }); return; }
    var on = !!c.enabled;
    var trig = c.kind === 'cron' ? cronHuman(c.cron) : t('crew.onEvent').replace('{event}', c.event_type || t('crew.eventDefault'));
    var limits = [c.crew_max_iterations ? t('adet.stepsN').replace('{n}', c.crew_max_iterations) : '', crewUsd(c.crew_run_budget_micro_usd)].filter(Boolean).join(' \\u00b7 ');
    var head = '<div class="wsx-adet__head"><h3 class="wsx-adet__title">' + esc(c.crew_name || t('crew.defaultName')) + '</h3><span class="wsx-sched__badge ' + (on ? 'ok' : '') + '">' + esc(t(on ? 'crew.badgeOn' : 'crew.badgePaused')) + '</span></div>';
    var acts = crewEditing ? '' : '<div class="wsx-adet__acts"><button class="wsx-abtn wsx-abtn--primary" type="button" data-cd="run">' + esc(t('crew.runNow')) + '</button>'
      + '<button class="wsx-abtn" type="button" data-cd="edit">' + esc(t('adet.edit')) + '</button>'
      + '<button class="wsx-abtn" type="button" data-cd="toggle">' + esc(t(on ? 'crew.pause' : 'crew.resume')) + '</button>'
      + '<button class="wsx-abtn danger" type="button" data-cd="del">' + esc(t('crew.delete')) + '</button></div>';
    var body = crewEditing ? crewEditHtml(c)
      : adetSec(t('adet.what'), '<div class="wsx-adet__instr">' + esc(c.crew_instructions || t('adet.noInstructions')) + '</div><dl class="wsx-adet__dl">'
          + (c.artifact_slug ? adetRow(t('adet.artifact'), '<button class="wsx-link" type="button" data-cd="art">' + esc(c.artifact_name || c.artifact_slug) + '</button>') : '')
          + adetRow(t('adet.model'), esc(crewModelLabel(c.crew_model)))
          + (limits ? adetRow(t('adet.limits'), esc(limits)) : '')
          + (c.owner_name || c.owner_email ? adetRow(t('adet.owner'), esc(c.owner_name || c.owner_email)) : '') + '</dl>')
        + adetSec(t('adet.when'), '<dl class="wsx-adet__dl">' + adetRow(t('adet.schedule'), esc(trig))
          + (c.kind === 'cron' ? adetRow(t('adet.nextRun'), esc(on ? adetWhen(c.next_run_at) : t('crew.badgePaused'))) : '')
          + adetRow(t('adet.lastRun'), esc(adetWhen(c.last_run_at))) + '</dl>');
    m.innerHTML = '<div class="wsx-adet-page">' + back + '<div class="wsx-adet" data-crew="' + esc(c.id) + '">' + head + acts + body
      + adetSec(t('adet.history'), '<div data-cd-runs>' + i18nLoad() + '</div>') + '</div></div>';
    var root = m.firstChild, card = root.querySelector('.wsx-adet');
    if (crewEditing && c.kind === 'cron') afWireSchedule(root, 'cd');
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cd]'); if (!b) return;
      var act = b.getAttribute('data-cd');
      if (act === 'back') { crewRoute(''); syncHash(); }
      else if (act === 'edit') { crewEditing = true; renderCrewDetail(); var f = document.getElementById('cd_name'); if (f) f.focus(); }
      else if (act === 'cancel') { crewEditing = false; renderCrewDetail(); }
      else if (act === 'save') crewSave(c, root, b);
      else if (act === 'run') crewRunLive(b, card, crewBase(c), function () { c.last_run_at = new Date().toISOString(); var h = root.querySelector('[data-cd-runs]'); if (h) crewDetailRuns(c, h); });
      else if (act === 'toggle') crewDetailToggle(c);
      else if (act === 'del') crewDetailDelete(c);
      else if (act === 'art' && c.artifact_slug && typeof openArtifactPage === 'function') openArtifactPage(c.artifact_slug, '');
    });
    crewDetailRuns(c, root.querySelector('[data-cd-runs]'));
  }

`;
