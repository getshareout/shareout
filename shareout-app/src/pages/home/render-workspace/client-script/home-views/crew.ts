/** Crew AI automations: run, pause, delete, run history. */
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
  function crewRunLive(b, card, base) {
    var log = card.querySelector('.wsx-crewlog');
    if (!log) { log = document.createElement('div'); log.className = 'wsx-crewlog'; log.setAttribute('aria-live', 'polite'); card.insertBefore(log, card.querySelector('.wsx-sched__actions')); }
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
      .then(function () { b.disabled = false; b.textContent = t('crew.runNow'); crewRuns(card.getAttribute('data-crew'), card.querySelector('[data-crew-runs]')); });
  }
  function loadCrew() {
    var m = document.getElementById('wsxCrewMount'); if (needWs(m)) return;
    m.innerHTML = i18nLoad();
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/automations', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var a = (d && d.automations) || [];
        if (!a.length) {
          m.innerHTML = '<div class="wsx-qa-grid wsx-qa-grid--lens"><button class="wsx-qa" data-newauto="Set up a crew for one of my pages that runs on a schedule and " type="button"><span class="wsx-qa__ic">' + isvg('<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>') + '</span><span class="wsx-qa__txt"><span class="wsx-qa__t">' + esc(t('crew.emptyChat')) + '</span><span class="wsx-qa__s">' + esc(t('crew.emptyChatSub')) + '</span></span></button></div>';
          wireNewAuto(m); return;
        }
        m.innerHTML = runsLink() + a.map(function (c) {
          var trig = c.kind === 'cron' ? cronHuman(c.cron) : t('crew.onEvent').replace('{event}', c.event_type || t('crew.eventDefault'));
          var model = (c.crew_model || '').replace('claude-', '').replace(/-\\d+$/, '');
          var stLbl = c.enabled ? t('crew.badgeOn') : t('crew.badgePaused'); var stc = c.enabled ? 'ok' : '';
          return '<div class="wsx-sched" data-crew="' + esc(c.id) + '" data-crew-enabled="' + (c.enabled ? '1' : '0') + '">'
            + '<div class="wsx-sched__head"><div class="wsx-sched__title">' + isvg('<circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="8" r="2.5"/>') + ' ' + esc(c.crew_name || t('crew.defaultName')) + '</div><span class="wsx-sched__badge ' + stc + '">' + esc(stLbl) + '</span></div>'
            + '<div class="wsx-sched__flow">' + (c.artifact_name ? schedChip(c.artifact_name, 'doc', 'is-origin') : '') + (model ? '<span class="wsx-sched__chip">' + isvg(SCHED_ICON.check) + '<span>' + esc(model) + '</span></span>' : '') + '</div>'
            + '<div class="wsx-sched__meta"><span class="wsx-sched__when">' + isvg(SCHED_ICON.clock) + esc(trig) + '</span>' + (c.last_run_at ? '<span>' + esc(t('crew.last')) + ' ' + esc(whenAgo(Date.parse(c.last_run_at))) + '</span>' : '') + (c.owner_name ? '<span>' + esc(t('crew.by')) + ' ' + esc(c.owner_name) + '</span>' : '') + '</div>'
            + '<div class="wsx-runbars" data-crew-runs="' + esc(c.id) + '"><span class="wsx-sched__noruns">' + esc(t('sched.loadingRuns')) + '</span></div>'
            + '<div class="wsx-sched__actions"><button class="wsx-abtn" data-crew-act="run" type="button">' + esc(t('crew.runNow')) + '</button><button class="wsx-abtn" data-crew-act="toggle" type="button">' + esc(c.enabled ? t('crew.pause') : t('crew.resume')) + '</button><button class="wsx-abtn danger" data-crew-act="del" type="button">' + esc(t('crew.delete')) + '</button></div>'
            + '</div>';
        }).join('');
        m.querySelectorAll('[data-crew-runs]').forEach(function (h) { crewRuns(h.getAttribute('data-crew-runs'), h); });
        m.querySelectorAll('[data-crew-act]').forEach(function (b) {
          b.addEventListener('click', function () {
            var card = b.closest('[data-crew]'); var id = card.getAttribute('data-crew'); var act = b.getAttribute('data-crew-act');
            var base = '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/automations/' + encodeURIComponent(id);
            if (act === 'run') crewRunLive(b, card, base);
            else if (act === 'toggle') { var on = card.getAttribute('data-crew-enabled') === '1'; fetch(base, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) }).then(function (r) { if (!r.ok) throw new Error('failed'); loaded.crew = 0; loadCrew(); }).catch(function () { showToast(t('crew.couldNotUpdate'), 'error'); }); }
            else if (act === 'del') { if (!window.confirm(t('crew.deleteConfirm'))) return; fetch(base, { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('failed'); card.remove(); }).catch(function () { showToast(t('crew.couldNotDelete'), 'error'); }); }
          });
        });
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

`;
