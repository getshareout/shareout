import { TOOLBAR_COPY, js, type ToolbarCopy } from './copy';

/** Auto-extracted client script for the sandbox viewer toolbar. */
export function renderToolbarScriptAuth(baseUrl: string, artifactId: string, userEmail: string, c: ToolbarCopy = TOOLBAR_COPY.en): string {
  const userEmailLiteral = JSON.stringify(userEmail || '');
  return `
    window.toggleFav = function() {
      var btn = document.getElementById('so-fav-btn');
      if (!btn) return;
      var on = btn.classList.contains('active');
      btn.disabled = true;
      fetch('${baseUrl}/v1/artifacts/${artifactId}/favorite', { method: on ? 'DELETE' : 'POST', credentials: 'include' })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function() {
          on = !on;
          btn.classList.toggle('active', on);
          btn.title = on ? '${js(c.favRemove)}' : '${js(c.favAdd)}';
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          var svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
          var lbl = document.getElementById('so-fav-label'); if (lbl) lbl.textContent = on ? '${js(c.favorited)}' : '${js(c.favorite)}';
        })
        .catch(function(err) { console.error('Favorite error:', err); })
        .finally(function() { btn.disabled = false; });
    };
    var SO_SCHED_CRONS = [['${js(c.cronDaily)}','0 9 * * *'],['${js(c.cronWeekdays)}','0 9 * * 1-5'],['${js(c.cronWeekly)}','0 9 * * 1'],['${js(c.cronHourly)}','0 * * * *']];
    var SO_ICON_TELEGRAM = '<img src="${baseUrl}/brand/telegram-icon.png" alt="" width="36" height="36" class="so-sched-dest-logo" decoding="async">';
    var SO_ICON_SLACK = '<img src="${baseUrl}/brand/slack-icon.png" alt="" width="36" height="36" class="so-sched-dest-logo" decoding="async">';
    var SO_ICON_EMAIL = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>';
    var SO_USER_EMAIL = ${userEmailLiteral};
    window.soCloseSchedule = function() { var ov = document.getElementById('so-sched-modal'); if (ov) ov.remove(); };
    window.soSchedPickDest = function(dest) {
      var input = document.getElementById('so-sched-dest');
      if (input) input.value = dest;
      document.querySelectorAll('#so-sched-modal .so-sched-dest-card').forEach(function(card) {
        card.classList.toggle('is-active', card.getAttribute('data-dest') === dest);
      });
      var slack = document.getElementById('so-sched-slack');
      var email = document.getElementById('so-sched-email');
      if (slack) slack.hidden = dest !== 'slack';
      if (email) email.hidden = dest !== 'email';
    };
    window.soSchedPickTarget = function(target) {
      var input = document.getElementById('so-sched-target');
      if (input) input.value = target;
      document.querySelectorAll('.so-sched-seg-btn').forEach(function(btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-value') === target);
      });
      var ch = document.getElementById('so-sched-channel-wrap');
      var user = document.getElementById('so-sched-user-wrap');
      if (ch) ch.hidden = target === 'dm';
      if (user) user.hidden = target !== 'dm';
    };
    window.soSchedTargetChange = function() { soSchedPickTarget(document.getElementById('so-sched-target').value); };
    window.soOpenSchedule = function(dmOnly) {
      soCloseSchedule();
      var cronOpts = SO_SCHED_CRONS.map(function(c){ return '<option value="' + c[1] + '">' + c[0] + '</option>'; }).join('');
      var defaultDest = dmOnly ? 'telegram' : 'slack';
      var destCard = function(dest, icon, name, hint) {
        var iconWrap = dest === 'email'
          ? '<span class="so-sched-dest-icon">' + icon + '</span>'
          : '<span class="so-sched-dest-icon so-sched-dest-icon--logo">' + icon + '</span>';
        return '<button type="button" class="so-sched-dest-card' + (dest === defaultDest ? ' is-active' : '') + '" data-dest="' + dest + '" onclick="soSchedPickDest(\\'' + dest + '\\')">' +
          iconWrap +
          '<span class="so-sched-dest-copy"><span class="so-sched-dest-name">' + name + '</span><span class="so-sched-dest-hint">' + hint + '</span></span></button>';
      };
      var destPick = '<div class="so-sched-section"><span class="so-sched-section-label">${js(c.whereGo)}</span>' +
        '<div class="so-sched-dest-grid" role="radiogroup" aria-label="${js(c.deliveryDest)}">' +
        destCard('telegram', SO_ICON_TELEGRAM, '${js(c.myTelegram)}', '${js(c.linkedChat)}') +
        destCard('slack', SO_ICON_SLACK, 'Slack', '${js(c.wsConnection)}') +
        destCard('email', SO_ICON_EMAIL, '${js(c.email)}', dmOnly ? '${js(c.yourInbox)}' : '${js(c.oneOrMore)}') +
        '</div><input type="hidden" id="so-sched-dest" value="' + defaultDest + '"></div>';
      var targetSeg = dmOnly
        ? '<input type="hidden" id="so-sched-target" value="dm">'
        : '<div class="so-sched-seg" role="tablist" aria-label="${js(c.slackTarget)}">' +
          '<button type="button" class="so-sched-seg-btn is-active" data-value="channel" onclick="soSchedPickTarget(\\'channel\\')">${js(c.channel)}</button>' +
          '<button type="button" class="so-sched-seg-btn" data-value="dm" onclick="soSchedPickTarget(\\'dm\\')">${js(c.dm)}</button>' +
          '</div><input type="hidden" id="so-sched-target" value="channel">';
      var slackPanel = '<div id="so-sched-slack" class="so-sched-section so-sched-slack-panel"' + (defaultDest === 'slack' ? '' : ' hidden') + '>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-sched-conn">${js(c.slackConn)}</label>' +
        '<input id="so-sched-conn" class="so-c-input" placeholder="${js(c.egTeam)}"><span class="so-c-hint">${js(c.connHint)}</span></div>' +
        targetSeg +
        '<div id="so-sched-channel-wrap" class="so-c-field"' + (dmOnly ? ' hidden' : '') + '><label class="so-c-label" for="so-sched-channel">${js(c.channelId)}</label>' +
        '<input id="so-sched-channel" class="so-c-input" placeholder="C0123456789"></div>' +
        '<div id="so-sched-user-wrap" class="so-c-field"' + (dmOnly ? '' : ' hidden') + '><label class="so-c-label" for="so-sched-user">${js(c.slackMemberId)}</label>' +
        '<input id="so-sched-user" class="so-c-input" placeholder="U0123456789"></div></div>';
      var emailPanel = '<div id="so-sched-email" class="so-sched-section so-sched-slack-panel"' + (defaultDest === 'email' ? '' : ' hidden') + '>' +
        (dmOnly
          ? '<div class="so-c-field"><label class="so-c-label">${js(c.sendTo)}</label><div id="so-sched-email-readonly" class="so-c-input" style="opacity:.85;cursor:default;"></div><span class="so-c-hint">${js(c.deliveredToAccount)}</span></div>'
          : '<div class="so-c-field"><label class="so-c-label" for="so-sched-recipients">${js(c.recipients)}</label>' +
            '<input id="so-sched-recipients" class="so-c-input" placeholder="${js(c.recipientsPh)}">' +
            '<span class="so-c-hint">${js(c.commaSep)}</span></div>') +
        '</div>';
      var title = dmOnly ? '${js(c.notifyMe)}' : '${js(c.scheduleDelivery)}';
      var lead = dmOnly ? '${js(c.notifyLead)}' : '${js(c.scheduleLead)}';
      var ov = document.createElement('div');
      ov.id = 'so-sched-modal';
      ov.className = 'so-c-modal-overlay so-c-modal-overlay--top so-theme-viewer';
      ov.innerHTML = '<div class="so-c-modal so-sched-modal" role="dialog" aria-modal="true" aria-labelledby="so-sched-title">' +
        '<div class="so-c-modal__head"><div><div class="so-c-modal__title" id="so-sched-title">' + title + '</div>' +
        '<p class="so-sched-lead">' + lead + '</p></div>' +
        '<button type="button" class="so-c-modal__close" onclick="soCloseSchedule()" aria-label="${js(c.close)}">&times;</button></div>' +
        '<div class="so-c-modal__body">' +
        destPick +
        slackPanel +
        emailPanel +
        '<div class="so-sched-section"><span class="so-sched-section-label">${js(c.deliveryDetails)}</span>' +
        '<div class="so-sched-row">' +
        '<div class="so-c-field"><label class="so-c-label" for="so-sched-mode">${js(c.whatToSend)}</label>' +
        '<select id="so-sched-mode" class="so-c-select"><option value="message">${js(c.modeMessage)}</option><option value="snapshot">${js(c.modeSnapshot)}</option><option value="pdf">PDF</option><option value="both">${js(c.modeBoth)}</option></select></div>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-sched-cron">${js(c.howOften)}</label>' +
        '<select id="so-sched-cron" class="so-c-select">' + cronOpts + '</select></div>' +
        '</div></div>' +
        '<div id="so-sched-err" class="so-c-error"></div>' +
        '</div>' +
        '<div class="so-c-modal__foot">' +
        '<button type="button" class="so-c-btn so-c-btn--secondary" onclick="soCloseSchedule()">${js(c.cancel)}</button>' +
        '<button type="button" class="so-c-btn so-c-btn--primary" onclick="soSchedCreate()">' + (dmOnly ? '${js(c.startNotifs)}' : '${js(c.createSchedule)}') + '</button>' +
        '</div></div>';
      ov.addEventListener('click', function(e) { if (e.target === ov) soCloseSchedule(); });
      document.body.appendChild(ov);
      var emailReadonly = document.getElementById('so-sched-email-readonly');
      if (emailReadonly) emailReadonly.textContent = SO_USER_EMAIL || '${js(c.accountEmail)}';
      var recipientsInput = document.getElementById('so-sched-recipients');
      if (recipientsInput && SO_USER_EMAIL) recipientsInput.value = SO_USER_EMAIL;
    };
    window.soSchedDestChange = function() { soSchedPickDest(document.getElementById('so-sched-dest').value); };
    window.soSchedEmailConfig = function(mode, recipients) {
      var config = { recipients: recipients };
      if (mode === 'pdf' || mode === 'both') config.renderPdf = true;
      if (mode === 'message' || mode === 'snapshot' || mode === 'both') config.includeArtifactLink = true;
      return config;
    };
    window.soSchedCreate = function() {
      var destKind = document.getElementById('so-sched-dest').value;
      var mode = document.getElementById('so-sched-mode').value;
      var cron = document.getElementById('so-sched-cron').value;
      var err = document.getElementById('so-sched-err'); err.textContent = '';
      var action, config;
      if (destKind === 'telegram') {
        // Delivers to the user's own linked Telegram chat.
        action = 'telegram'; config = { mode: mode };
      } else if (destKind === 'email') {
        var recipients;
        if (document.getElementById('so-sched-recipients')) {
          var raw = (document.getElementById('so-sched-recipients').value || '').trim();
          recipients = raw.split(/[,\\n]+/).map(function(x) { return x.trim(); }).filter(Boolean);
          if (!recipients.length) { err.textContent = '${js(c.errOneEmail)}'; return; }
        } else {
          if (!SO_USER_EMAIL) { err.textContent = '${js(c.errNoEmail)}'; return; }
          recipients = [SO_USER_EMAIL];
        }
        action = 'email'; config = soSchedEmailConfig(mode, recipients);
      } else {
        var conn = (document.getElementById('so-sched-conn').value || '').trim();
        var target = document.getElementById('so-sched-target').value;
        if (!conn) { err.textContent = '${js(c.errSlackConn)}'; return; }
        config = { connection: conn, mode: mode, targetType: target };
        if (target === 'dm') { var u = (document.getElementById('so-sched-user').value || '').trim(); if (!u) { err.textContent = '${js(c.errSlackMember)}'; return; } config.slackUserId = u; }
        else { var ch = (document.getElementById('so-sched-channel').value || '').trim(); if (!ch) { err.textContent = '${js(c.errChannel)}'; return; } config.channelId = ch; }
        action = 'slack';
      }
      fetch('${baseUrl}/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ artifact_id: '${artifactId}', action: action, schedule: cron, config: config }) })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
        .then(function(res) { if (!res.ok) { err.textContent = (res.d && res.d.error) ? res.d.error : '${js(c.errSchedule)}'; return; } soCloseSchedule(); })
        .catch(function() { err.textContent = '${js(c.errNetwork)}'; });
    };
    window.soCloseFollow = function() { var ov = document.getElementById('so-follow-modal'); if (ov) ov.remove(); };
    window.soFollowPickDest = function(dest) {
      var input = document.getElementById('so-follow-dest');
      if (input) input.value = dest;
      document.querySelectorAll('#so-follow-modal .so-sched-dest-card').forEach(function(card) {
        card.classList.toggle('is-active', card.getAttribute('data-dest') === dest);
      });
      var slack = document.getElementById('so-follow-slack');
      if (slack) slack.hidden = dest !== 'slack';
    };
    window.soOpenFollow = function() {
      soCloseFollow();
      var cronOpts = SO_SCHED_CRONS.map(function(c){ return '<option value="' + c[1] + '">' + c[0] + '</option>'; }).join('');
      var destCard = function(dest, icon, name, hint, active) {
        var iconWrap = dest === 'email'
          ? '<span class="so-sched-dest-icon">' + icon + '</span>'
          : '<span class="so-sched-dest-icon so-sched-dest-icon--logo">' + icon + '</span>';
        return '<button type="button" class="so-sched-dest-card' + (active ? ' is-active' : '') + '" data-dest="' + dest + '" onclick="soFollowPickDest(\\'' + dest + '\\')">' +
          iconWrap +
          '<span class="so-sched-dest-copy"><span class="so-sched-dest-name">' + name + '</span><span class="so-sched-dest-hint">' + hint + '</span></span></button>';
      };
      var ov = document.createElement('div');
      ov.id = 'so-follow-modal';
      ov.className = 'so-c-modal-overlay so-c-modal-overlay--top so-theme-viewer';
      ov.innerHTML = '<div class="so-c-modal so-sched-modal" role="dialog" aria-modal="true" aria-labelledby="so-follow-title">' +
        '<div class="so-c-modal__head"><div><div class="so-c-modal__title" id="so-follow-title">${js(c.followModalTitle)}</div>' +
        '<p class="so-sched-lead">${js(c.followLead)}</p></div>' +
        '<button type="button" class="so-c-modal__close" onclick="soCloseFollow()" aria-label="${js(c.close)}">&times;</button></div>' +
        '<div class="so-c-modal__body">' +
        '<div class="so-sched-section"><span class="so-sched-section-label">${js(c.whatToWatch)}</span>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-follow-metric">${js(c.metric)}</label>' +
        '<select id="so-follow-metric" class="so-c-select"><option value="">${js(c.loading)}</option></select></div>' +
        '<div class="so-sched-row">' +
        '<div class="so-c-field"><label class="so-c-label" for="so-follow-op">${js(c.alertWhen)}</label>' +
        '<select id="so-follow-op" class="so-c-select"><option value="lt">${js(c.dropsBelow)}</option><option value="gt">${js(c.risesAbove)}</option></select></div>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-follow-value">${js(c.threshold)}</label>' +
        '<input id="so-follow-value" type="number" class="so-c-input" placeholder="100000"></div>' +
        '</div></div>' +
        '<div class="so-sched-section"><span class="so-sched-section-label">${js(c.whereNotify)}</span>' +
        '<div class="so-sched-dest-grid" role="radiogroup" aria-label="${js(c.alertDest)}">' +
        destCard('telegram', SO_ICON_TELEGRAM, '${js(c.myTelegram)}', '${js(c.linkedChat)}', true) +
        destCard('slack', SO_ICON_SLACK, '${js(c.slackDm)}', '${js(c.wsConnection)}', false) +
        '</div><input type="hidden" id="so-follow-dest" value="telegram"></div>' +
        '<div id="so-follow-slack" class="so-sched-section so-sched-slack-panel" hidden>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-follow-conn">${js(c.slackConn)}</label>' +
        '<input id="so-follow-conn" class="so-c-input" placeholder="${js(c.egTeam)}"></div>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-follow-user">${js(c.slackMemberId)}</label>' +
        '<input id="so-follow-user" class="so-c-input" placeholder="U0123456789"></div></div>' +
        '<div class="so-sched-section"><span class="so-sched-section-label">${js(c.howOftenCheck)}</span>' +
        '<div class="so-c-field"><label class="so-c-label" for="so-follow-cron">${js(c.schedule)}</label>' +
        '<select id="so-follow-cron" class="so-c-select">' + cronOpts + '</select></div>' +
        '<label class="so-sched-check"><input type="checkbox" id="so-follow-crew"> ${js(c.crewCheck)}</label>' +
        '</div>' +
        '<div id="so-follow-err" class="so-c-error"></div>' +
        '<div id="so-follow-mine" class="so-sched-section"></div>' +
        '</div>' +
        '<div class="so-c-modal__foot">' +
        '<button type="button" class="so-c-btn so-c-btn--secondary" onclick="soCloseFollow()">${js(c.close)}</button>' +
        '<button type="button" class="so-c-btn so-c-btn--primary" onclick="soFollowCreate()">${js(c.createAlert)}</button>' +
        '</div></div>';
      ov.addEventListener('click', function(e) { if (e.target === ov) soCloseFollow(); });
      document.body.appendChild(ov);
      fetch('${baseUrl}/v1/metric-alerts/definitions?artifact_id=${artifactId}', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var sel = document.getElementById('so-follow-metric'); if (!sel) return;
          var defs = (d && d.definitions) || [];
          sel.innerHTML = '';
          if (!defs.length) { var o = document.createElement('option'); o.value = ''; o.textContent = '${js(c.noMetrics)}'; sel.appendChild(o); return; }
          defs.forEach(function(m) { var o = document.createElement('option'); o.value = m.metric_id; o.textContent = m.label || m.metric_id; sel.appendChild(o); });
        })
        .catch(function() { var sel = document.getElementById('so-follow-metric'); if (sel) sel.innerHTML = '<option value="">${js(c.failedLoad)}</option>'; });
      soFollowLoadMine();
    };
    window.soFollowLoadMine = function() {
      var box = document.getElementById('so-follow-mine'); if (!box) return;
      fetch('${baseUrl}/v1/metric-alerts?artifact_id=${artifactId}', { credentials: 'include' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
          var rules = (d && d.alerts) || [];
          if (!rules.length) { box.innerHTML = ''; return; }
          box.innerHTML = '<span class="so-sched-section-label">${js(c.activeAlerts)}</span>' + rules.map(function(a) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:10px 12px;margin-top:8px;border:1px solid rgba(231,229,228,0.8);border-radius:12px;background:rgba(255,255,255,0.55);font-size:.82rem;">' +
              '<span>' + (a.name || a.metric_id) + (a.enabled ? '' : ' <em style="color:var(--color-text-tertiary);">${js(c.paused)}</em>') + '</span>' +
              '<button type="button" class="so-c-btn so-c-btn--danger-outline so-c-btn--sm" onclick="soFollowCancel(\\'' + a.id + '\\')">${js(c.cancel)}</button>' +
            '</div>';
          }).join('');
        })
        .catch(function() {});
    };
    window.soFollowCancel = function(id) {
      fetch('${baseUrl}/v1/metric-alerts/' + id, { method: 'DELETE', credentials: 'include' })
        .then(function(r) { if (r.ok) soFollowLoadMine(); });
    };
    window.soFollowDestChange = function() { soFollowPickDest(document.getElementById('so-follow-dest').value); };
    window.soFollowCreate = function() {
      var metricId = document.getElementById('so-follow-metric').value;
      var op = document.getElementById('so-follow-op').value;
      var value = parseFloat(document.getElementById('so-follow-value').value);
      var dest = document.getElementById('so-follow-dest').value;
      var cron = document.getElementById('so-follow-cron').value;
      var err = document.getElementById('so-follow-err'); err.textContent = ''; err.style.color = '';
      if (!metricId) { err.textContent = '${js(c.errPickMetric)}'; return; }
      if (isNaN(value)) { err.textContent = '${js(c.errThreshold)}'; return; }
      var destination;
      if (dest === 'telegram') {
        // Delivers to the viewer's own linked Telegram chat.
        destination = { kind: 'telegram', config: { mode: 'message' } };
      } else {
        var conn = (document.getElementById('so-follow-conn').value || '').trim();
        var user = (document.getElementById('so-follow-user').value || '').trim();
        if (!conn) { err.textContent = '${js(c.errSlackConn)}'; return; }
        if (!user) { err.textContent = '${js(c.errSlackMember)}'; return; }
        destination = { kind: 'slack', config: { connection: conn, targetType: 'dm', slackUserId: user, mode: 'message' } };
      }
      var crew = !!(document.getElementById('so-follow-crew') && document.getElementById('so-follow-crew').checked);
      var body = { artifact_id: '${artifactId}', metric_id: metricId, name: '${js(c.followPrefix)}' + metricId, condition: { op: op, value: value }, schedule: cron, destination: destination };
      if (crew) body.on_trigger = { crew: true };
      fetch('${baseUrl}/v1/metric-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
        .then(function(res) {
          if (!res.ok) { err.textContent = (res.d && res.d.error) ? res.d.error : '${js(c.errAlert)}'; return; }
          document.getElementById('so-follow-value').value = '';
          err.style.color = 'var(--color-success)'; err.textContent = '${js(c.alertCreated)}';
          soFollowLoadMine();
        })
        .catch(function() { err.textContent = '${js(c.errNetwork)}'; });
    };`;
}
