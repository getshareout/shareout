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
            if (act === 'run') { b.disabled = true; b.textContent = t('crew.running'); fetch(base + '/run', { method: 'POST', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('failed'); b.textContent = t('crew.queued'); setTimeout(function () { loaded.crew = 0; loadCrew(); }, 1200); }).catch(function () { b.disabled = false; b.textContent = t('crew.runNow'); showToast(t('crew.couldNotRun'), 'error'); }); }
            else if (act === 'toggle') { var on = card.getAttribute('data-crew-enabled') === '1'; fetch(base, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) }).then(function (r) { if (!r.ok) throw new Error('failed'); loaded.crew = 0; loadCrew(); }).catch(function () { showToast(t('crew.couldNotUpdate'), 'error'); }); }
            else if (act === 'del') { if (!window.confirm(t('crew.deleteConfirm'))) return; fetch(base, { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('failed'); card.remove(); }).catch(function () { showToast(t('crew.couldNotDelete'), 'error'); }); }
          });
        });
      }).catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

`;
