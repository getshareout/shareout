/** Admin lens — overview, members, security, settings. */
import { colors } from '@shareout/design-tokens';

export const workspace_client_home_views_admin_JS = `  // ----- Admin — Overview / Artifacts / Members / Billing / Security / Settings -----
  function wsUrl(suffix) { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + suffix; }
  var adminTab = 'overview';
  // Branded loading + busy-button affordances (design-system spinner).
  function adLoading(m) { m.innerHTML = i18nSpin(); }
  function adBusy(b) { if (b) { b.disabled = true; b.classList.add('is-busy'); } }
  function adIdle(b) { if (b) { b.disabled = false; b.classList.remove('is-busy'); } }
  // Stale-while-revalidate per-tab data cache: paint cached data instantly on
  // revisit, refetch in the background, repaint only if the data changed (so
  // in-progress form edits aren't clobbered). Cache drops on workspace switch.
  var adDataCache = {}, adCacheWs = null;
  function adReload() { delete adDataCache[adminTab]; loadAdmin(); }
  function swr(key, painter, fetcher) {
    var m = document.getElementById('wsxAdminMount'); if (!m) return;
    if (adCacheWs !== window.WSX_WS) { adDataCache = {}; adCacheWs = window.WSX_WS; }
    var tabAtCall = adminTab, cached = adDataCache[key];
    if (cached !== undefined) { try { painter(cached); } catch (e) {} } else { adLoading(m); }
    fetcher().then(function (data) {
      var same = cached !== undefined && JSON.stringify(cached) === JSON.stringify(data);
      adDataCache[key] = data;
      if (adminTab !== tabAtCall) return;        // user switched tabs mid-fetch
      if (cached !== undefined && same) return;  // unchanged — don't clobber live UI
      painter(data);
    }).catch(function () { if (adminTab === tabAtCall && cached === undefined) m.innerHTML = i18nEmpty('common.couldNotLoad'); });
  }
  function adBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function adCompact(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
    return (n / 1000000).toFixed(1) + 'M';
  }

  function adOverview() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return Promise.all([
      Promise.resolve(null), // no billing in this build — seat/plan data is gone
      fetch(wsUrl('/members/metrics'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/admin/artifacts'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/invites'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/schedules'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/automations'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]); };
    swr('overview', function (res) {
      var sub = res[0] && res[0].subscription;
      var mlist = (res[1] && res[1].members) || [];
      var alist = (res[2] && res[2].artifacts) || [];
      var invites = (res[3] && res[3].invites) || [];
      var jobs = (res[4] && res[4].schedules) || [];
      var crews = (res[5] && res[5].automations) || [];
      var storageBytes = alist.reduce(function (s, a) { return s + (Number(a.size_bytes) || 0); }, 0);
      var totalViews = alist.reduce(function (s, a) { return s + (Number(a.views) || 0); }, 0);
      var totalVisitors = alist.reduce(function (s, a) { return s + (Number(a.unique_visitors) || 0); }, 0);
      var publicCount = alist.filter(function (a) { return a.visibility === 'public'; }).length;
      var pausedCount = alist.filter(function (a) { return a.paused; }).length;
      function inactive30(mem) {
        if (mem.pending) return false;
        var j = new Date(mem.joined_at); if (isNaN(j.getTime()) || (Date.now() - j.getTime()) < 2592000000) return false;
        if (!mem.last_active) return true;
        var la = new Date(mem.last_active); return isNaN(la.getTime()) ? true : (Date.now() - la.getTime()) > 2592000000;
      }
      var pendingCount = mlist.filter(function (x) { return x.pending; }).length;
      var inactiveCount = mlist.filter(inactive30).length;
      var failingJobs = jobs.filter(function (j) { return j.last_status === 'error' || j.last_status === 'failed'; }).length
        + crews.filter(function (c) { return c.crew_status === 'error' || c.crew_status === 'failed'; }).length;
      var automationsOn = jobs.filter(function (j) { return j.enabled !== false; }).length + crews.filter(function (c) { return c.enabled !== false; }).length;
      var plan = (sub && sub.plan_name) || t('admin.statusFree');
      var seatsTotal = sub ? sub.seats : null;
      var seatsUsed = mlist.length;
      var status = (sub && sub.status) || 'free';
      var statusLabel = { active: t('admin.statusActive'), trialing: t('admin.statusTrial'), past_due: t('admin.statusPastDue'), cancelled: t('admin.statusCancelled'), expired: t('admin.statusExpired'), free: t('admin.statusFree') }[status] || status;
      var statusCls = { active: 'is-on', trialing: 'is-trial', past_due: 'is-warn', cancelled: 'is-off', expired: 'is-off', free: '' }[status] || '';
      var pct = seatsTotal ? Math.min(100, Math.round(seatsUsed / seatsTotal * 100)) : 0;
      function card(lbl, val, sub2, extra) { return '<div class="wsx-admin__card"><div class="wsx-admin__cardlbl">' + lbl + '</div><div class="wsx-admin__cardval">' + val + '</div>' + (sub2 ? '<div class="wsx-admin__cardsub">' + sub2 + '</div>' : '') + (extra || '') + '</div>'; }
      var planSub = (sub && sub.trial_ends_at) ? t('admin.trialEnds') + ' ' + adRelDate(sub.trial_ends_at) : (sub && sub.current_period_end) ? t('admin.renews') + ' ' + adRelDate(sub.current_period_end) : '';
      var membersSub = seatsTotal ? t('admin.seatsUsed').replace('{pct}', String(pct)) : (pendingCount ? t('admin.pendingCount').replace('{n}', String(pendingCount)) : '');
      var artsSub = adBytes(storageBytes) + ' ' + t('admin.stored') + (pausedCount ? ' \\u00B7 ' + pausedCount + ' ' + t('admin.pausedCount') : '');
      var viewsSub = totalVisitors.toLocaleString() + ' ' + t('admin.uniqueVisitors');
      var publicSub = publicCount ? t('admin.artifactsPublic') : t('admin.nothingPublic');
      var autoSub = (jobs.length + crews.length) + ' ' + t('admin.automationTotal') + (failingJobs ? ' \\u00B7 ' + failingJobs + ' ' + t('admin.automationFailing') : '');
      var cards = card(t('admin.cardPlan'), esc(plan) + ' <span class="wsx-admin__rolebadge ' + statusCls + '">' + esc(statusLabel) + '</span>', planSub)
        + card(t('admin.cardMembers'), seatsUsed + (seatsTotal ? ' / ' + seatsTotal : ''), membersSub, seatsTotal ? '<div class="wsx-admin__seatbar"><div class="wsx-admin__seatfill" style="width:' + pct + '%"></div></div>' : '')
        + card(t('admin.cardArtifacts'), String(alist.length), artsSub)
        + card(t('admin.cardViews'), totalViews.toLocaleString(), viewsSub)
        + card(t('admin.cardPublic'), String(publicCount), publicSub)
        + card(t('admin.cardAutomations'), String(automationsOn), autoSub);
      // Actionable items — only what needs the admin's attention, each deep-links to its tab.
      var attn = [];
      if (pendingCount) attn.push(['members', t(pendingCount === 1 ? 'admin.pendingInvites' : 'admin.pendingInvitesPlural').replace('{n}', String(pendingCount)), 'is-trial']);
      if (inactiveCount) attn.push(['members', t(inactiveCount === 1 ? 'admin.inactiveMembers' : 'admin.inactiveMembersPlural').replace('{n}', String(inactiveCount)), '']);
      if (publicCount) attn.push(['artifacts', t(publicCount === 1 ? 'admin.publicArtifacts' : 'admin.publicArtifactsPlural').replace('{n}', String(publicCount)), '']);
      if (failingJobs) attn.push(['automation', t(failingJobs === 1 ? 'admin.failingAutomations' : 'admin.failingAutomationsPlural').replace('{n}', String(failingJobs)), 'is-off']);
      var attnSection = attn.length
        ? '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.needsAttention')) + '</div><div class="wsx-admin__attn">'
          + attn.map(function (a) { return '<button class="wsx-admin__attnrow" data-admin-goto="' + a[0] + '" type="button"><span class="wsx-admin__rolebadge ' + a[2] + '">!</span><span>' + a[1] + '</span><span class="wsx-admin__attngo">\\u2192</span></button>'; }).join('')
          + '</div></div>'
        : '';
      m.innerHTML = '<div class="wsx-admin__cards">' + cards + '</div>' + attnSection;
      m.querySelectorAll('[data-admin-goto]').forEach(function (b) {
        b.addEventListener('click', function () {
          var gotoTab = b.getAttribute('data-admin-goto');
          ws.querySelectorAll('[data-admin-tab]').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-admin-tab') === gotoTab); });
          adminTab = gotoTab; loadAdmin();
        });
      });
    }, run);
  }

  function adArtifacts() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return fetch(wsUrl('/admin/artifacts'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }); };
    swr('artifacts', function (d) {
        var arts = (d && d.artifacts) || [];
        if (!arts.length) { m.innerHTML = i18nEmpty('admin.noArtifacts'); return; }
        var artSort = 'created'; var artAsc = false; var artVis = '';
        var VIS_LABEL = { public: t('admin.visPublic'), unlisted: t('admin.visUnlisted'), private: t('admin.visPrivate') };
        var VIS_CLS = { public: 'is-on', unlisted: '', private: 'is-off' };
        var SORT_KEY = { name: 'name', created: 'created_at', updated: 'updated_at', views: 'views', visitors: 'unique_visitors', size: 'size_bytes', load: 'avg_lcp' };
        var fmtBytes = adBytes;
        // Unused = nothing has ever viewed it and it has had time to be seen (>30d old).
        function isUnused(a) {
          if ((Number(a.views) || 0) > 0) return false;
          var d = new Date(a.created_at); if (isNaN(d.getTime())) return false;
          return (Date.now() - d.getTime()) > 2592000000;
        }
        function sortedList() {
          var key = SORT_KEY[artSort] || 'created_at';
          var filtered = arts.slice();
          if (artVis === 'unused') filtered = filtered.filter(isUnused);
          else if (artVis) filtered = filtered.filter(function (a) { return a.visibility === artVis; });
          var numeric = key === 'views' || key === 'unique_visitors' || key === 'size_bytes' || key === 'avg_lcp';
          return filtered.sort(function (a, b) {
            var av = numeric ? (Number(a[key]) || 0) : (a[key] || '');
            var bv = numeric ? (Number(b[key]) || 0) : (b[key] || '');
            var cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return artAsc ? cmp : -cmp;
          });
        }
        function artRow(a) {
          var who = a.owner_name || a.owner_email || '\\u2014';
          var vis = a.visibility || 'public';
          var load = (a.avg_lcp != null && (Number(a.perf_samples) || 0) >= 5) ? Math.round(Number(a.avg_lcp)) + ' ms' : '\\u2014';
          var unused = isUnused(a) ? ' <span class="wsx-atbl__flag" title="' + esc(t('admin.unusedTitle')) + '">' + esc(t('admin.visUnused')) + '</span>' : '';
          var nextVis = vis === 'public' ? 'private' : 'public';
          return '<tr' + (a.paused ? ' class="is-paused"' : '') + '>'
            + '<td><a class="wsx-atbl__link" href="/@' + esc(a.workspace_slug || '') + '/' + esc(a.slug) + '" target="_blank">' + esc(a.name) + '</a><span class="wsx-atbl__type">' + esc(a.artifact_type) + '</span>' + unused + '</td>'
            + '<td class="wsx-atbl__owner" title="' + esc(who) + '">' + esc(who) + '</td>'
            + '<td class="wsx-atbl__date">' + adRelDate(a.created_at) + '</td>'
            + '<td class="wsx-atbl__date">' + adRelDate(a.updated_at) + '</td>'
            + '<td class="wsx-atbl__num">' + (a.views || 0) + '</td>'
            + '<td class="wsx-atbl__num">' + (a.unique_visitors || 0) + '</td>'
            + '<td class="wsx-atbl__num">' + fmtBytes(a.size_bytes) + '</td>'
            + '<td class="wsx-atbl__num">' + load + '</td>'
            + '<td><span class="wsx-admin__rolebadge ' + (VIS_CLS[vis] || '') + '">' + (VIS_LABEL[vis] || esc(vis)) + '</span></td>'
            + '<td><span class="wsx-admin__rolebadge ' + (a.paused ? 'is-off' : 'is-on') + '">' + (a.paused ? t('inspector.statusPaused') : t('admin.live')) + '</span></td>'
            + '<td class="wsx-atbl__actions">'
            + '<button class="wsx-atbl__act" data-art-vis="' + esc(a.id) + '" data-next="' + nextVis + '" title="' + esc(vis === 'public' ? t('admin.makePrivate') : t('admin.makePublic')) + '" type="button">' + (vis === 'public' ? t('admin.makePrivate') : t('admin.makePublic')) + '</button>'
            + '<button class="wsx-atbl__act" data-art-pause="' + esc(a.id) + '" data-next="' + (a.paused ? '0' : '1') + '" title="' + esc(a.paused ? t('admin.resume') : t('admin.pause')) + '" type="button">' + (a.paused ? t('admin.resume') : t('admin.pause')) + '</button>'
            + '<button class="wsx-atbl__act" data-art-reassign="' + esc(a.id) + '" title="' + esc(t('admin.reassignOwner')) + '" type="button">' + esc(t('admin.reassign')) + '</button>'
            + '</td>'
            + '</tr>';
        }
        function actUrl(id, action) { return wsUrl('/admin/artifacts/' + encodeURIComponent(id) + '/' + action); }
        function postAct(id, action, body, done) {
          fetch(actUrl(id, action), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
            .then(function (j) { if (!j || j.error) { try { alert((j && j.error) || t('admin.actionFailed')); } catch (e) {} done(false); } else { done(true, j); } })
            .catch(function () { done(false); });
        }
        function renderTable() {
          var filterBtns = '<div class="wsx-admin__artfilter wsx__chips">'
            + ['', 'public', 'private', 'unused'].map(function (v) {
              var lbl = v ? (VIS_LABEL[v] || (v === 'unused' ? t('admin.visUnused') : v)) : t('admin.visAll');
              return '<button class="wsx-chip' + (artVis === v ? ' is-on' : '') + '" data-avis="' + v + '" type="button">' + lbl + '</button>';
            }).join('') + '</div>';
          var thEl = function (k, lbl) { return '<th class="' + (artSort === k ? 'is-sort' : '') + '" data-asort="' + k + '">' + lbl + (artSort === k ? (artAsc ? ' \\u2191' : ' \\u2193') : '') + '</th>'; };
          var thead = '<thead><tr>' + thEl('name', t('widget.colName')) + '<th>' + esc(t('admin.colOwner')) + '</th>' + thEl('created', t('admin.colCreated')) + thEl('updated', t('widget.colUpdated')) + thEl('views', t('widget.colViews')) + thEl('visitors', t('tabs.visitors')) + thEl('size', t('admin.colSize')) + thEl('load', t('admin.colLoad')) + '<th>' + esc(t('admin.colVisibility')) + '</th><th>' + esc(t('admin.colStatus')) + '</th><th>' + esc(t('admin.colActions')) + '</th></tr></thead>';
          m.innerHTML = filterBtns + '<div class="wsx-atbl__wrap"><table class="wsx-atbl">' + thead + '<tbody>' + sortedList().map(artRow).join('') + '</tbody></table></div>';
          m.querySelectorAll('[data-avis]').forEach(function (b) {
            b.addEventListener('click', function () { artVis = b.getAttribute('data-avis') || ''; renderTable(); });
          });
          m.querySelectorAll('[data-asort]').forEach(function (th) {
            th.addEventListener('click', function () {
              var k = th.getAttribute('data-asort');
              if (artSort === k) { artAsc = !artAsc; } else { artSort = k; artAsc = false; }
              renderTable();
            });
          });
          m.querySelectorAll('[data-art-pause]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-art-pause'); var paused = b.getAttribute('data-next') === '1';
              if (paused && !window.confirm(t('admin.pauseConfirm'))) return;
              var a = arts.filter(function (x) { return x.id === id; })[0]; var prev = a ? a.paused : null;
              if (a) a.paused = paused ? 1 : 0; renderTable(); // optimistic
              postAct(id, 'pause', { paused: paused }, function (ok) {
                if (!ok && a) { a.paused = prev; renderTable(); } // roll back (postAct alerts)
              });
            });
          });
          m.querySelectorAll('[data-art-vis]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-art-vis'); var next = b.getAttribute('data-next');
              if (next === 'public' && !window.confirm(t('admin.makePublicConfirm'))) return;
              var a = arts.filter(function (x) { return x.id === id; })[0]; var prev = a ? a.visibility : null;
              if (a) a.visibility = next; renderTable(); // optimistic
              postAct(id, 'visibility', { visibility: next }, function (ok) {
                if (!ok && a) { a.visibility = prev; renderTable(); } // roll back (postAct alerts)
              });
            });
          });
          m.querySelectorAll('[data-art-reassign]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-art-reassign');
              var email = (window.prompt(t('admin.reassignPrompt')) || '').trim();
              if (!email) return;
              b.disabled = true;
              postAct(id, 'transfer', { email: email }, function (ok, j) {
                if (ok) { var a = arts.filter(function (x) { return x.id === id; })[0]; if (a) { a.owner_email = (j && j.new_owner) || email; a.owner_name = null; } renderTable(); } else { b.disabled = false; }
              });
            });
          });
        }
        renderTable();
    }, run);
  }

  function adMembers() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return Promise.all([
      fetch(wsUrl('/members/metrics'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      Promise.resolve(null), // no billing in this build — seat/plan data is gone
      fetch(wsUrl('/invites'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]); };
    swr('members', function (res) {
      var list = (res[0] && res[0].members) || [];
      var invites = (res[2] && res[2].invites) || [];
      var sub = res[1] && res[1].subscription;
      var seatsTotal = sub ? sub.seats : null;
      var atLimit = seatsTotal !== null && seatsTotal > 0 && list.length >= seatsTotal;
      var seatUtil = seatsTotal
        ? '<div class="wsx-admin__seat-util"><div class="wsx-admin__seat-info"><div class="wsx-admin__seat-label">' + esc(t('admin.seatUsage')) + '</div>'
          + '<div class="wsx-admin__seat-count">' + esc(t('admin.seatsCount').replace('{used}', String(list.length)).replace('{total}', String(seatsTotal))) + '</div>'
          + (atLimit ? '<div class="wsx-admin__seat-warn">' + esc(t('admin.seatLimitReached')) + '</div>' : '')
          + '</div><div class="wsx-admin__seatbar" style="width:80px"><div class="wsx-admin__seatfill" style="width:'
          + Math.min(100, Math.round(list.length / seatsTotal * 100)) + '%"></div></div></div>'
        : '';
      var invite = '<div class="wsx-admin__invite"><input class="wsx-admin__email" id="wsxInviteEmail" type="email" placeholder="' + esc(t('clients.inviteEmail')) + '" autocomplete="off">'
        + '<select class="wsx-admin__role" id="wsxInviteRoleSel"><option value="member">' + esc(t('admin.roleMember')) + '</option><option value="admin">' + esc(t('admin.roleAdmin')) + '</option></select>'
        + '<button class="wsx-abtn" id="wsxInviteBtn" type="button"' + (atLimit ? ' disabled title="' + esc(t('admin.seatLimitTitle')) + '"' : '') + '>' + esc(t('clients.invite')) + '</button></div>';
      // Inactive = joined >30d ago and no activity in the last 30d (reclaim candidate).
      function memInactive(mem) {
        if (mem.pending) return false;
        var j = new Date(mem.joined_at); if (isNaN(j.getTime()) || (Date.now() - j.getTime()) < 2592000000) return false;
        if (!mem.last_active) return true;
        var la = new Date(mem.last_active); if (isNaN(la.getTime())) return true;
        return (Date.now() - la.getTime()) > 2592000000;
      }
      var invitesSection = '';
      if (invites.length) {
        invitesSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.pendingInvitesTitle')) + '</div>'
          + '<div class="wsx-admin__list">' + invites.map(function (iv) {
            var expired = iv.expired ? '<span class="wsx-atbl__flag" title="' + esc(t('admin.inviteExpired')) + '">' + esc(t('admin.expired')) + '</span>' : '';
            var invitedSub = t('admin.invitedAt').replace('{when}', adRelDate(iv.created_at)) + (iv.invited_by_email ? ' ' + t('admin.invitedBy').replace('{email}', esc(iv.invited_by_email)) : '');
            return '<div class="wsx-admin__row" data-inv="' + esc(iv.id) + '"><span class="wsx-cm__av">@</span>'
              + '<div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(iv.email) + expired + '</span>'
              + '<span class="wsx-admin__sub">' + invitedSub + '</span></div>'
              + '<button class="wsx-atbl__act" data-inv-copy="' + esc(iv.id) + '" type="button">' + esc(t('admin.copyInviteLink')) + '</button>'
              + '<button class="wsx-atbl__act" data-inv-resend="' + esc(iv.id) + '" type="button">' + esc(t('admin.resend')) + '</button>'
              + '<button class="wsx-conn__del" data-inv-revoke="' + esc(iv.id) + '" title="' + esc(t('admin.revoke')) + '" type="button">\\u00D7</button></div>';
          }).join('') + '</div></div>';
      }
      var MEM_SORT = { name: 'name', role: 'role', joined: 'joined_at', login: 'last_login_at', active: 'last_active', arts: 'artifact_count', views: 'view_count', tokens: 'ai_tokens', comments: 'comment_count' };
      var memSort = 'active', memAsc = false;
      function sortedMembers() {
        var key = MEM_SORT[memSort] || 'last_active';
        var numeric = key === 'artifact_count' || key === 'view_count' || key === 'ai_tokens' || key === 'comment_count';
        var dateKey = key === 'joined_at' || key === 'last_login_at' || key === 'last_active';
        return list.slice().sort(function (a, b) {
          var av, bv;
          if (numeric) { av = Number(a[key]) || 0; bv = Number(b[key]) || 0; }
          else if (dateKey) { av = a[key] ? new Date(a[key]).getTime() : 0; bv = b[key] ? new Date(b[key]).getTime() : 0; if (isNaN(av)) av = 0; if (isNaN(bv)) bv = 0; }
          else { av = a[key] || ''; bv = b[key] || ''; }
          var cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return memAsc ? cmp : -cmp;
        });
      }
      function memRow(mem) {
        var who = mem.name || mem.email || t('admin.roleMember');
        var canRm = mem.role !== 'owner';
        var roleCtl = mem.role === 'owner'
          ? '<span class="wsx-admin__rolebadge is-owner">' + esc(t('admin.roleOwner')) + '</span>'
          : '<select class="wsx-admin__role wsx-admin__rolesel" data-mem-role="' + esc(mem.email || '') + '"><option value="member"' + (mem.role === 'member' ? ' selected' : '') + '>' + esc(t('admin.roleMember')) + '</option><option value="admin"' + (mem.role === 'admin' ? ' selected' : '') + '>' + esc(t('admin.roleAdmin')) + '</option></select>';
        var flag = mem.pending ? '<span class="wsx-atbl__flag" title="' + esc(t('admin.pendingTitle')) + '">' + esc(t('admin.pending')) + '</span>'
          : memInactive(mem) ? '<span class="wsx-atbl__flag" title="' + esc(t('admin.inactiveTitle')) + '">' + esc(t('admin.inactive')) + '</span>' : '';
        var aiTitle = mem.ai_cost_usd ? ' title="$' + Number(mem.ai_cost_usd).toFixed(2) + '"' : '';
        return '<tr data-mem="' + esc(mem.user_id) + '">'
          + '<td><span class="wsx-atbl__link">' + esc(who) + '</span>' + flag + '<span class="wsx-atbl__type">' + esc(mem.email || '') + '</span></td>'
          + '<td>' + roleCtl + '</td>'
          + '<td class="wsx-atbl__date">' + adRelDate(mem.joined_at) + '</td>'
          + '<td class="wsx-atbl__date">' + (mem.pending ? '\\u2014' : (mem.last_login_at ? adRelDate(mem.last_login_at) : esc(t('common.never')))) + '</td>'
          + '<td class="wsx-atbl__date">' + (mem.last_active ? adRelDate(mem.last_active) : '\\u2014') + '</td>'
          + '<td class="wsx-atbl__num">' + (mem.artifact_count || 0) + '</td>'
          + '<td class="wsx-atbl__num">' + adCompact(mem.view_count) + '</td>'
          + '<td class="wsx-atbl__num"' + aiTitle + '>' + adCompact(mem.ai_tokens) + '</td>'
          + '<td class="wsx-atbl__num">' + (mem.comment_count || 0) + '</td>'
          + '<td class="wsx-atbl__actions">' + (canRm ? '<button class="wsx-conn__del" data-mem-rm="' + esc(mem.user_id) + '" title="' + esc(t('common.delete')) + '" type="button">\\u00D7</button>' : '') + '</td>'
          + '</tr>';
      }
      function renderMembers() {
        var thEl = function (k, lbl) { return '<th class="' + (memSort === k ? 'is-sort' : '') + '" data-msort="' + k + '">' + lbl + (memSort === k ? (memAsc ? ' \\u2191' : ' \\u2193') : '') + '</th>'; };
        var thead = '<thead><tr>' + thEl('name', esc(t('admin.colMember'))) + thEl('role', esc(t('admin.colRole'))) + thEl('joined', esc(t('admin.colJoined'))) + thEl('login', esc(t('admin.colLastLogin'))) + thEl('active', esc(t('admin.colLastActive'))) + thEl('arts', esc(t('admin.colArtifacts'))) + thEl('views', esc(t('widget.colViews'))) + thEl('tokens', esc(t('admin.colAiTokens'))) + thEl('comments', esc(t('admin.colComments'))) + '<th></th></tr></thead>';
        var table = '<div class="wsx-atbl__wrap"><table class="wsx-atbl">' + thead + '<tbody>' + sortedMembers().map(memRow).join('') + '</tbody></table></div>';
        m.innerHTML = seatUtil + invite + table + invitesSection;
        bindMembers();
      }
      function bindMembers() {
        m.querySelectorAll('[data-msort]').forEach(function (th) {
          th.addEventListener('click', function () {
            var k = th.getAttribute('data-msort');
            if (memSort === k) { memAsc = !memAsc; } else { memSort = k; memAsc = false; }
            renderMembers();
          });
        });
        var sel = document.getElementById('wsxInviteRoleSel');
        var ib = document.getElementById('wsxInviteBtn');
        if (ib) ib.addEventListener('click', function () {
          var em = document.getElementById('wsxInviteEmail'); var v = (em.value || '').trim(); if (!v) return;
          adBusy(this);
          fetch(wsUrl('/members'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, role: sel.value }) })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { if (j && j.error) { try { alert(j.error); } catch (e) {} } adReload(); })
            .catch(function () { adReload(); });
        });
        m.querySelectorAll('[data-inv-resend]').forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true; b.textContent = t('admin.sending');
            fetch(wsUrl('/invites/' + encodeURIComponent(b.getAttribute('data-inv-resend')) + '/resend'), { method: 'POST', credentials: 'same-origin' })
              .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
              .then(function (j) { b.disabled = false; b.textContent = (j && !j.error) ? t('common.sent') : t('common.failed'); setTimeout(function () { b.textContent = t('admin.resend'); }, 1500); });
          });
        });
        m.querySelectorAll('[data-inv-copy]').forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true;
            // notify:false — minting a link must not re-email the invitee every time an
            // admin copies it. This is the only way to invite on an instance with no
            // EMAIL binding, so the link is shown even when the clipboard is unavailable.
            fetch(wsUrl('/invites/' + encodeURIComponent(b.getAttribute('data-inv-copy')) + '/resend'), {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' }, body: '{"notify":false}'
            })
              .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
              .then(function (j) {
                b.disabled = false;
                if (!j || !j.inviteUrl) { b.textContent = t('common.failed'); }
                else {
                  var done = function () { b.textContent = t('admin.inviteLinkCopied'); };
                  try {
                    navigator.clipboard.writeText(j.inviteUrl).then(done, function () { window.prompt(t('admin.copyInviteLink'), j.inviteUrl); done(); });
                  } catch (e) { window.prompt(t('admin.copyInviteLink'), j.inviteUrl); done(); }
                }
                setTimeout(function () { b.textContent = t('admin.copyInviteLink'); }, 1500);
              });
          });
        });
        m.querySelectorAll('[data-inv-revoke]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!window.confirm(t('admin.revokeInviteConfirm'))) return;
            adBusy(b);
            fetch(wsUrl('/invites/' + encodeURIComponent(b.getAttribute('data-inv-revoke'))), { method: 'DELETE', credentials: 'same-origin' })
              .then(function (r) { if (r.ok) adReload(); else adIdle(b); });
          });
        });
        m.querySelectorAll('[data-mem-rm]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!window.confirm(t('admin.removeMemberConfirm'))) return;
            fetch(wsUrl('/members/' + encodeURIComponent(b.getAttribute('data-mem-rm'))), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (r.ok) { var el = m.querySelector('[data-mem="' + b.getAttribute('data-mem-rm') + '"]'); if (el) el.remove(); delete adDataCache['members']; } });
          });
        });
        // Change role in place — POST /members upserts the role for an existing member.
        m.querySelectorAll('[data-mem-role]').forEach(function (s) {
          var prev = s.value;
          s.addEventListener('change', function () {
            s.disabled = true;
            fetch(wsUrl('/members'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: s.getAttribute('data-mem-role'), role: s.value }) })
              .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
              .then(function (j) { s.disabled = false; if (!j || j.error) { s.value = prev; if (j && j.error) try { alert(j.error); } catch (e) {} } else { prev = s.value; delete adDataCache['members']; } });
          });
        });
      }
      renderMembers();
    }, run);
  }

  function adSecurity() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return Promise.all([
      fetch(wsUrl('/audit?limit=50'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/access-policy'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/v1/access-requests/incoming', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/session-policy'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/agent-tokens'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/publish-approvals'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]); };
    swr('security', function (res) {
      var entries = (res[0] && res[0].entries) || [];
      var accessReqs = (res[2] && res[2].requests) || [];
      var sessionPol = res[3] || null;
      var agentTokens = (res[4] && res[4].tokens) || [];
      var approvals = (res[5] && res[5].approvals) || [];
      var policy = res[1] || { allowed_domains: [], allowed_emails: [] };
      var domains = (policy.allowed_domains || []).slice();
      var emails = (policy.allowed_emails || []).slice();
      function domainTagsHtml(arr) {
        if (!arr.length) return '<span class="wsx-admin__sub">' + esc(t('admin.policyOpen')) + '</span>';
        return arr.map(function (d) { return '<span class="wsx-admin__domain-tag">' + esc(d) + '<button class="wsx-admin__domain-rm" data-rm-domain="' + esc(d) + '" type="button">\\u00D7</button></span>'; }).join('');
      }
      var policySection = '<div class="wsx-admin__settings-section">'
        + '<div class="wsx-admin__settings-title">' + esc(t('admin.accessPolicy')) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(t('admin.accessPolicyIntro')) + '</p>'
        + '<div class="wsx-admin__cardlbl" style="margin-bottom:4px">' + esc(t('admin.allowedDomains')) + '</div>'
        + '<div class="wsx-admin__domain-list" id="wsxDomainList">' + domainTagsHtml(domains) + '</div>'
        + '<div class="wsx-admin__domain-add"><input class="wsx-admin__email" id="wsxDomainInput" type="text" placeholder="' + esc(t('admin.domainPlaceholder')) + '" style="max-width:200px">'
        + '<button class="wsx-abtn" id="wsxDomainAdd" type="button">' + esc(t('admin.addDomain')) + '</button><span class="wsx-admin__savemsg" id="wsxPolicyMsg"></span></div>'
        + '</div>';
      var auditSection = '<div class="wsx-admin__settings-section">'
        + '<div class="wsx-admin__settings-title">' + esc(t('admin.auditLog')) + '</div>'
        + (entries.length
          ? '<div class="wsx-admin__auditfeed">' + entries.map(function (e) {
              var actor = e.actor_email || e.actor_id || '?';
              return '<div class="wsx-admin__audit-row"><span class="wsx-admin__audit-actor">' + esc(actor) + '</span><span class="wsx-admin__audit-action">' + esc(e.action || '') + '</span><span class="wsx-admin__audit-ts">' + adRelDate(e.ts) + '</span></div>';
            }).join('') + '</div>'
          : i18nEmpty('admin.noAudit'))
        + '</div>';
      var reqSection = '';
      if (accessReqs.length) {
        reqSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.accessRequests')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.accessRequestsIntro')) + '</p>'
          + '<div class="wsx-admin__list">' + accessReqs.map(function (q) {
            var who = q.requester_name || q.requester_email || t('inspector.someone');
            return '<div class="wsx-admin__row" data-req="' + esc(q.id) + '"><span class="wsx-cm__av">' + esc((who[0] || '?').toUpperCase()) + '</span>'
              + '<div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(who) + '</span>'
              + '<span class="wsx-admin__sub">' + esc(t('admin.wantsArtifact').replace('{name}', q.artifact_name || t('admin.anArtifact'))) + ' \\u00B7 ' + adRelDate(q.created_at) + '</span></div>'
              + '<button class="wsx-atbl__act" data-req-approve="' + esc(q.id) + '" type="button">' + esc(t('common.approve')) + '</button>'
              + '<button class="wsx-atbl__act" data-req-deny="' + esc(q.id) + '" type="button">' + esc(t('common.deny')) + '</button></div>';
          }).join('') + '</div></div>';
      }
      // Session policy (Teams-gated).
      var sessionSection = '';
      if (sessionPol) {
        var cur = sessionPol.session_max_days;
        var def = sessionPol.platform_default_days || 30;
        sessionSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.sessionPolicy')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.sessionPolicyIntro').replace('{n}', String(def))) + '</p>'
          + (sessionPol.eligible
            ? '<div class="wsx-admin__domain-add"><label class="wsx-admin__field">' + esc(t('admin.maxSessionDays')) + ' <input type="number" id="wsxSessDays" min="1" max="' + def + '" placeholder="' + def + '" value="' + (cur || '') + '" style="width:80px"></label>'
              + '<button class="wsx-abtn" id="wsxSessSave" type="button">' + esc(t('common.save')) + '</button><span class="wsx-admin__savemsg" id="wsxSessMsg"></span></div>'
            : '<div class="wsx-admin__sub">' + esc(t('admin.teamsOnly')) + '</div>')
          + '</div>';
      }
      // Agent tokens (service accounts).
      var tokRows = agentTokens.map(function (tok) {
        var revoked = !!tok.revoked_at;
        return '<tr' + (revoked ? ' class="is-paused"' : '') + '><td><span class="wsx-atbl__link">' + esc(tok.name || t('admin.tokenDefault')) + '</span>' + (revoked ? '<span class="wsx-atbl__flag">' + esc(t('admin.revoked')) + '</span>' : '') + '</td>'
          + '<td class="wsx-atbl__owner">' + esc(((tok.scopes || []).join ? (tok.scopes || []).join(', ') : String(tok.scopes || ''))) + '</td>'
          + '<td class="wsx-atbl__date">' + (tok.last_used_at ? adRelDate(tok.last_used_at) : esc(t('common.never'))) + '</td>'
          + '<td class="wsx-atbl__actions">' + (revoked ? '' : '<button class="wsx-conn__del" data-tok-rm="' + esc(tok.id) + '" title="' + esc(t('admin.revoke')) + '" type="button">\\u00D7</button>') + '</td></tr>';
      }).join('');
      var tokensSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.agentTokens')) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(t('admin.agentTokensIntro')) + '</p>'
        + (agentTokens.length ? '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.colName')) + '</th><th>' + esc(t('admin.colScopes')) + '</th><th>' + esc(t('admin.colLastUsed')) + '</th><th></th></tr></thead><tbody>' + tokRows + '</tbody></table></div>' : i18nEmpty('admin.noTokens'))
        + '<div class="wsx-admin__domain-add" style="margin-top:10px"><input class="wsx-admin__email" id="wsxTokName" type="text" placeholder="' + esc(t('admin.tokNamePlaceholder')) + '" style="max-width:180px">'
        + '<input class="wsx-admin__email" id="wsxTokScopes" type="text" placeholder="' + esc(t('admin.tokScopesPlaceholder')) + '" style="max-width:240px">'
        + '<button class="wsx-abtn" id="wsxTokCreate" type="button">' + esc(t('common.create')) + '</button><span class="wsx-admin__savemsg" id="wsxTokMsg"></span></div></div>';
      // Publish approvals queue.
      var apprSection = '';
      if (approvals.length) {
        apprSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.publishApprovals')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.publishApprovalsIntro')) + '</p>'
          + '<div class="wsx-admin__list">' + approvals.map(function (a) {
            return '<div class="wsx-admin__row"><div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(a.artifact_name || t('inspector.artifact')) + '</span>'
              + '<span class="wsx-admin__sub">\\u2192 ' + esc(a.requested_visibility || 'public') + ' \\u00B7 ' + esc(t('admin.approvedCount').replace('{n}', String(a.approved_count || 0))) + ' \\u00B7 ' + adRelDate(a.created_at) + '</span></div>'
              + (a.viewer_can_decide ? '<button class="wsx-atbl__act" data-appr="' + esc(a.id) + '" data-appr-art="' + esc(a.artifact_id) + '" type="button">' + esc(t('common.approve')) + '</button>' : '<span class="wsx-admin__rolebadge">' + esc(a.status || t('admin.pending')) + '</span>') + '</div>';
          }).join('') + '</div></div>';
      }
      m.innerHTML = reqSection + apprSection + policySection + sessionSection + tokensSection + auditSection;
      // Session policy save.
      var sessSave = document.getElementById('wsxSessSave');
      if (sessSave) sessSave.addEventListener('click', function () {
        var btn = this; var msg = document.getElementById('wsxSessMsg'); var v = (document.getElementById('wsxSessDays').value || '').trim();
        adBusy(btn); msg.textContent = t('common.saving');
        fetch(wsUrl('/session-policy'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_max_days: v ? parseInt(v, 10) : null }) })
          .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
          .then(function (j) { adIdle(btn); if (j && !j.error) delete adDataCache['security']; msg.textContent = (j && !j.error) ? t('common.saved') : ((j && j.error) || t('common.failed')); setTimeout(function () { msg.textContent = ''; }, 1500); })
          .catch(function () { adIdle(btn); msg.textContent = t('modal.networkError'); });
      });
      // Agent token create + revoke.
      var tokCreate = document.getElementById('wsxTokCreate');
      if (tokCreate) tokCreate.addEventListener('click', function () {
        var msg = document.getElementById('wsxTokMsg'); var name = (document.getElementById('wsxTokName').value || '').trim();
        if (!name) { msg.textContent = t('admin.nameRequired'); return; }
        var scopes = (document.getElementById('wsxTokScopes').value || 'artifacts:publish,data:read').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        adBusy(tokCreate); msg.textContent = t('common.creating');
        fetch(wsUrl('/agent-tokens'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, scopes: scopes }) })
          .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
          .then(function (j) {
            adIdle(tokCreate);
            if (j && j.token) { try { window.prompt(t('admin.copyTokenPrompt'), j.token); } catch (e) {} adReload(); }
            else { msg.textContent = (j && j.error) || t('common.failed'); }
          }).catch(function () { adIdle(tokCreate); msg.textContent = t('modal.networkError'); });
      });
      m.querySelectorAll('[data-tok-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm(t('admin.revokeTokenConfirm'))) return;
          adBusy(b);
          fetch(wsUrl('/agent-tokens/' + encodeURIComponent(b.getAttribute('data-tok-rm'))), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (r.ok) adReload(); else adIdle(b); });
        });
      });
      m.querySelectorAll('[data-appr]').forEach(function (b) {
        b.addEventListener('click', function () {
          adBusy(b);
          fetch('/v1/artifacts/' + encodeURIComponent(b.getAttribute('data-appr-art')) + '/publish-approval/' + encodeURIComponent(b.getAttribute('data-appr')) + '/decision', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) })
            .then(function (r) { if (r.ok) adReload(); else adIdle(b); });
        });
      });
      function decideReq(id, action) {
        var row = m.querySelector('[data-req="' + id + '"]');
        fetch('/v1/access-requests/' + encodeURIComponent(id), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action }) })
          .then(function (r) { if (r.ok && row) { row.remove(); delete adDataCache['security']; } });
      }
      m.querySelectorAll('[data-req-approve]').forEach(function (b) { b.addEventListener('click', function () { decideReq(b.getAttribute('data-req-approve'), 'approve'); }); });
      m.querySelectorAll('[data-req-deny]').forEach(function (b) { b.addEventListener('click', function () { decideReq(b.getAttribute('data-req-deny'), 'deny'); }); });
      var pmsg = document.getElementById('wsxPolicyMsg');
      function saveDomains() {
        fetch(wsUrl('/access-policy'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_domains: domains, allowed_emails: emails }) })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (j && !j.error) {
              delete adDataCache['security'];
              pmsg.textContent = t('common.saved'); document.getElementById('wsxDomainList').innerHTML = domainTagsHtml(domains); bindDomainRm();
              setTimeout(function () { pmsg.textContent = ''; }, 1500);
            } else { pmsg.textContent = (j && j.error) || t('common.error'); }
          }).catch(function () { pmsg.textContent = t('modal.networkError'); });
      }
      function bindDomainRm() {
        m.querySelectorAll('[data-rm-domain]').forEach(function (b) {
          b.addEventListener('click', function () {
            var d = b.getAttribute('data-rm-domain'); domains = domains.filter(function (x) { return x !== d; }); saveDomains();
          });
        });
      }
      bindDomainRm();
      document.getElementById('wsxDomainAdd').addEventListener('click', function () {
        var inp = document.getElementById('wsxDomainInput'); var v = (inp.value || '').trim().toLowerCase().replace(/^@/, '');
        if (!v || domains.indexOf(v) !== -1) return; domains.push(v); inp.value = ''; saveDomains();
      });
    }, run);
  }
  var POLICIES = [['allow', 'admin.policy.allow', 'admin.policy.allowDesc'], ['require_approval', 'admin.policy.approval', 'admin.policy.approvalDesc'], ['prohibit', 'admin.policy.prohibit', 'admin.policy.prohibitDesc']];
  function adSettings() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return Promise.all([
      fetch(wsUrl('/publish-policy'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/branding'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/features'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]); };
    swr('settings', function (res) {
      var pol = res[0]; var brd = res[1] || {}; var feat = res[2];
      var cur = (pol && pol.policy) || 'allow'; var n = (pol && (pol.approvals_required || pol.approvalsRequired)) || 1;
      var pubSection = '<div class="wsx-admin__settings-section">'
        + '<div class="wsx-admin__settings-title">' + esc(t('admin.publishingPolicy')) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(t('admin.publishingPolicyIntro')) + '</p>'
        + '<div class="wsx-admin__opts">' + POLICIES.map(function (p) {
          return '<button class="wsx-admin__opt' + (p[0] === cur ? ' is-sel' : '') + '" data-pol="' + p[0] + '" type="button"><span class="wsx-admin__optt">' + esc(t(p[1])) + '</span><span class="wsx-admin__opts2">' + esc(t(p[2])) + '</span></button>';
        }).join('') + '</div>'
        + '<div class="wsx-admin__apprv" id="wsxApprvRow"' + (cur === 'require_approval' ? '' : ' hidden') + '><label>' + esc(t('admin.approvalsRequired')) + ' <input type="number" id="wsxApprvN" min="1" max="10" value="' + n + '"></label></div>'
        + '</div>';
      var accent = brd.accent_color || '${colors.primary}';
      var brdSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.branding')) + '</div>'
        + '<div class="wsx-admin__brand"><div class="wsx-admin__logocol">'
        + (brd.logo_url ? '<div class="wsx-admin__logo"><img src="' + esc(brd.logo_url) + '" alt="logo"></div>' : '<div class="wsx-admin__logo wsx-admin__logo--empty">' + esc(t('admin.noLogo')) + '</div>')
        + '<button class="wsx-abtn wsx-admin__logobtn" id="wsxBrandUpload" type="button">' + esc(brd.logo_url ? t('admin.replaceLogo') : t('admin.uploadLogo')) + '</button>'
        + (brd.logo_url ? '<button class="wsx-abtn danger wsx-admin__logobtn" id="wsxBrandLogoDel" type="button">' + esc(t('admin.remove')) + '</button>' : '')
        + '</div><div class="wsx-admin__brandfields"><label class="wsx-admin__field">' + esc(t('admin.accentColor')) + ' <input type="color" id="wsxBrandAccent" value="' + esc(accent) + '"></label>'
        + '<label class="wsx-admin__check"><input type="checkbox" id="wsxBrandFooter"' + (brd.hide_footer ? ' checked' : '') + '> ' + esc(t('admin.hideFooter')) + '</label>'
        + '<button class="wsx-abtn" id="wsxBrandSave" type="button">' + esc(t('common.save')) + '</button><span class="wsx-admin__savemsg" id="wsxBrandMsg"></span></div></div>'
        + '<p class="wsx-lens__intro" style="margin-top:12px">' + esc(t('admin.logoFormats')) + '</p></div>';
      var cat = (feat && feat.catalog) || [];
      var groups = {}, order = [];
      cat.forEach(function (f) { var c = f.category || t('admin.categoryOther'); if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(f); });
      var featSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.features')) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(t('admin.featuresIntro')) + '</p>'
        + (cat.length ? order.map(function (c) {
          return '<div class="wsx-conn__cat">' + esc(c) + '</div>' + groups[c].map(function (f) {
            return '<div class="wsx-admin__row"><div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(f.label) + '</span><span class="wsx-admin__sub">' + esc(f.description || '') + '</span></div><span class="wsx-admin__rolebadge ' + (f.enabled ? 'is-on' : 'is-off') + '">' + esc(f.enabled ? t('admin.on') : t('admin.off')) + '</span></div>';
          }).join('');
        }).join('') : i18nEmpty('admin.noFeatures')) + '</div>';
      var slug = window.WSX_SLUG || '';
      // Domain comes from the instance; empty when it has no email binding, in which
      // case there is no address to show rather than one that cannot receive.
      var inboxDom = window.WSX_INBOX_DOMAIN || '';
      var inboxAddr = (slug && inboxDom) ? (slug + '@' + inboxDom) : '';
      var inboxSection = inboxAddr
        ? '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.fileInbox')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.fileInboxIntro')) + '</p>'
          + '<div class="wsx-admin__row"><code class="wsx-admin__inboxaddr" id="wsxInboxAddr">' + esc(inboxAddr) + '</code>'
          + '<button class="wsx-abtn" id="wsxInboxCopy" type="button">' + esc(t('admin.copyAddress')) + '</button></div></div>'
        : '';
      var instanceSection = window.WSX_INSTANCE_ADMIN
        ? '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.instanceTitle')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.instanceIntro')) + '</p>'
          + '<div class="wsx-admin__row"><a class="wsx-abtn" href="/admin?view=instance">' + esc(t('admin.instanceOpen')) + '</a></div></div>'
        : '';
      m.innerHTML = instanceSection + inboxSection + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title" data-i18n="settings.language">Language</div>'
        + '<p class="wsx-lens__intro" data-i18n="settings.languageIntro">Choose the language for menus, labels, and messages in your workspace home.</p>'
        + '<div class="wsx-home-lang" role="group" aria-label="Language">'
        + '<button class="home-lang-btn" type="button" data-lang="en" aria-selected="true" title="English" data-i18n-title="settings.languageEn">\\uD83C\\uDDFA\\uD83C\\uDDF8 EN</button>'
        + '<button class="home-lang-btn" type="button" data-lang="es" aria-selected="false" title="Espa\\u00f1ol" data-i18n-title="settings.languageEs">\\uD83C\\uDDE6\\uD83C\\uDDF7 ES</button>'
        + '</div></div>' + pubSection + brdSection + featSection;
      if (typeof window.__SO_APPLY_HOME_I18N === 'function') window.__SO_APPLY_HOME_I18N();
      if (typeof window.__SO_WIRE_HOME_LANG === 'function') window.__SO_WIRE_HOME_LANG(m);
      var copyBtn = document.getElementById('wsxInboxCopy');
      if (copyBtn) copyBtn.addEventListener('click', function () {
        var addr = (document.getElementById('wsxInboxAddr') || {}).textContent || '';
        if (!addr) return;
        navigator.clipboard.writeText(addr).then(function () {
          copyBtn.textContent = t('admin.copied');
          setTimeout(function () { copyBtn.textContent = t('admin.copyAddress'); }, 1500);
        }).catch(function () {});
      });
      function savePol() {
        delete adDataCache['settings'];
        var num = parseInt((document.getElementById('wsxApprvN') || {}).value, 10) || 1;
        fetch(wsUrl('/publish-policy'), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy: cur, approvals_required: num }) });
      }
      m.querySelectorAll('[data-pol]').forEach(function (b) {
        b.addEventListener('click', function () {
          cur = b.getAttribute('data-pol');
          m.querySelectorAll('[data-pol]').forEach(function (x) { x.classList.toggle('is-sel', x === b); });
          document.getElementById('wsxApprvRow').hidden = cur !== 'require_approval';
          savePol();
        });
      });
      var nn = document.getElementById('wsxApprvN'); if (nn) nn.addEventListener('change', savePol);
      var bmsg = document.getElementById('wsxBrandMsg');
      document.getElementById('wsxBrandSave').addEventListener('click', function () {
        var btn = this; adBusy(btn); bmsg.textContent = t('common.saving');
        fetch(wsUrl('/branding'), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accent_color: document.getElementById('wsxBrandAccent').value, hide_footer: document.getElementById('wsxBrandFooter').checked }) })
          .then(function (r) { adIdle(btn); if (r.ok) delete adDataCache['settings']; bmsg.textContent = r.ok ? t('common.saved') : t('common.failed'); setTimeout(function () { bmsg.textContent = ''; }, 1500); });
      });
      var upBtn = document.getElementById('wsxBrandUpload');
      upBtn.addEventListener('click', function () {
        var f = document.createElement('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
        f.addEventListener('change', function () {
          var file = f.files && f.files[0]; if (!file) return;
          if (file.size > 512 * 1024) { bmsg.textContent = t('admin.tooLarge'); return; }
          adBusy(upBtn); bmsg.textContent = t('common.uploading');
          fetch(wsUrl('/logo'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { if (j) { bmsg.textContent = t('common.uploaded'); adReload(); } else { adIdle(upBtn); bmsg.textContent = t('admin.uploadFailed'); } });
        });
        f.click();
      });
      var del = document.getElementById('wsxBrandLogoDel');
      if (del) del.addEventListener('click', function () {
        if (!window.confirm(t('admin.removeLogoConfirm'))) return;
        adBusy(del); bmsg.textContent = t('common.removing');
        fetch(wsUrl('/logo'), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (r.ok) adReload(); else { adIdle(del); bmsg.textContent = t('common.failed'); } });
      });
    }, run);
  }


  // AI — token usage, cost, model breakdown, and bring-your-own key.
  function adAI() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return Promise.all([
      fetch(wsUrl('/llm'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/usage?limit=200'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/crew-usage'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]); };
    swr('ai', function (res) {
      var llm = res[0] || {};
      var usage = res[1] || {};
      var crew = res[2] || {};
      var totals = usage.totals || { requests: 0, inputTokens: 0, outputTokens: 0, billedUsd: 0 };
      var events = usage.events || [];
      // Aggregate model breakdown client-side from the recent event window.
      var byModel = {};
      events.forEach(function (e) {
        var k = e.model || 'unknown';
        if (!byModel[k]) byModel[k] = { model: k, requests: 0, input: 0, output: 0, cost: 0, byo: 0 };
        byModel[k].requests++; byModel[k].input += Number(e.inputTokens) || 0; byModel[k].output += Number(e.outputTokens) || 0;
        byModel[k].cost += Number(e.billedCostUsd) || 0; if (e.byo) byModel[k].byo++;
      });
      var models = Object.keys(byModel).map(function (k) { return byModel[k]; }).sort(function (a, b) { return b.requests - a.requests; });
      function card(lbl, val, sub2) { return '<div class="wsx-admin__card"><div class="wsx-admin__cardlbl">' + lbl + '</div><div class="wsx-admin__cardval">' + val + '</div>' + (sub2 ? '<div class="wsx-admin__cardsub">' + sub2 + '</div>' : '') + '</div>'; }
      var balUsd = (llm.balanceUsd != null) ? llm.balanceUsd : (llm.balanceMicroUsd != null ? llm.balanceMicroUsd / 1e6 : null);
      var spend = (llm.currentMonthSpendUsd != null) ? llm.currentMonthSpendUsd : 0;
      var cards = card(t('admin.aiMonthSpend'), '$' + Number(spend).toFixed(2), llm.period ? esc(String(llm.period)) : '')
        + (llm.hasByoKey ? card(t('admin.aiBilling'), t('admin.aiYourKey'), esc(llm.byoProvider || 'BYO') + ' \\u00B7 ' + t('admin.aiNotMetered')) : card(t('admin.aiBalance'), balUsd != null ? '$' + Number(balUsd).toFixed(2) : '\\u2014', t('admin.aiPlatformKey') + (llm.markup ? ' \\u00B7 ' + llm.markup + t('admin.aiMarkup') : '')))
        + card(t('admin.aiRequests'), adCompact(totals.requests), t('admin.aiRecentWindow'))
        + card(t('admin.aiTokens'), adCompact((Number(totals.inputTokens) || 0) + (Number(totals.outputTokens) || 0)), t('admin.aiTokensInOut').replace('{in}', adCompact(totals.inputTokens)).replace('{out}', adCompact(totals.outputTokens)))
        + card(t('admin.aiBilled'), '$' + Number(totals.billedUsd || 0).toFixed(2), t('admin.aiRecentWindow'))
        + (crew.summary ? card(t('admin.aiCrewRuns'), adCompact(crew.summary.runs), t('admin.aiErrorsCost').replace('{errors}', String(crew.summary.errors || 0)).replace('{cost}', Number(crew.summary.costUsd || 0).toFixed(2))) : '');
      var modelRows = models.map(function (mm) {
        return '<tr><td><span class="wsx-atbl__link">' + esc(mm.model) + '</span>' + (mm.byo ? '<span class="wsx-atbl__flag" title="' + esc(t('admin.aiByoFlag')) + '">' + esc(t('admin.aiByo')) + '</span>' : '') + '</td>'
          + '<td class="wsx-atbl__num">' + adCompact(mm.requests) + '</td>'
          + '<td class="wsx-atbl__num">' + adCompact(mm.input) + '</td>'
          + '<td class="wsx-atbl__num">' + adCompact(mm.output) + '</td>'
          + '<td class="wsx-atbl__num">$' + mm.cost.toFixed(2) + '</td></tr>';
      }).join('');
      var modelSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.aiModelsRecent').replace('{n}', String(events.length))) + '</div>'
        + (models.length ? '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.colModel')) + '</th><th>' + esc(t('admin.colRequests')) + '</th><th>' + esc(t('admin.colInput')) + '</th><th>' + esc(t('admin.colOutput')) + '</th><th>' + esc(t('admin.colCost')) + '</th></tr></thead><tbody>' + modelRows + '</tbody></table></div>' : i18nEmpty('admin.noAiUsage')) + '</div>';
      var byoSection = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.aiByoTitle')) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(t('admin.aiByoIntro')) + '</p>'
        + (llm.hasByoKey
          ? '<div class="wsx-admin__row"><div class="wsx-admin__who"><span class="wsx-admin__nm">' + esc(t('admin.aiKeyActive')) + ' <span class="wsx-admin__rolebadge is-on">' + esc(llm.byoProvider || 'custom') + '</span></span><span class="wsx-admin__sub">' + esc(t('admin.aiKeyActiveSub')) + '</span></div><button class="wsx-abtn danger" id="wsxByoDel" type="button">' + esc(t('admin.aiRemoveKey')) + '</button></div>'
          : '<div class="wsx-admin__domain-add"><select class="wsx-admin__role" id="wsxByoProvider" style="max-width:180px"><option value="openai">OpenAI</option><option value="vercel-gateway">Vercel AI Gateway</option></select>'
            + '<input class="wsx-admin__email" id="wsxByoKey" type="password" placeholder="' + esc(t('admin.aiApiKeyPlaceholder')) + '" autocomplete="off" style="max-width:280px">'
            + '<button class="wsx-abtn" id="wsxByoSave" type="button">' + esc(t('admin.aiSaveKey')) + '</button><span class="wsx-admin__savemsg" id="wsxByoMsg"></span></div>')
        + '</div>';
      m.innerHTML = '<div class="wsx-admin__cards">' + cards + '</div>' + modelSection + byoSection;
      var bsave = document.getElementById('wsxByoSave');
      if (bsave) bsave.addEventListener('click', function () {
        var msg = document.getElementById('wsxByoMsg'); var key = (document.getElementById('wsxByoKey').value || '').trim();
        if (key.length < 8) { msg.textContent = t('admin.aiKeyTooShort'); return; }
        adBusy(bsave); msg.textContent = t('common.saving');
        fetch(wsUrl('/llm'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: document.getElementById('wsxByoProvider').value, apiKey: key }) })
          .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
          .then(function (j) { if (j && !j.error) { adReload(); } else { adIdle(bsave); msg.textContent = (j && j.error) || t('common.failed'); } })
          .catch(function () { adIdle(bsave); msg.textContent = t('modal.networkError'); });
      });
      var bdel = document.getElementById('wsxByoDel');
      if (bdel) bdel.addEventListener('click', function () {
        if (!window.confirm(t('admin.aiRemoveKeyConfirm'))) return;
        adBusy(bdel);
        fetch(wsUrl('/llm'), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) { if (r.ok) adReload(); else adIdle(bdel); });
      });
    }, run);
  }
  function adTableSection(titleKey, introKey, headKeys, rowsHtml, emptyKey) {
    var body = rowsHtml
      ? '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr>' + headKeys.map(function (k) { return '<th>' + esc(t(k)) + '</th>'; }).join('') + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
      : i18nEmpty(emptyKey);
    return '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t(titleKey)) + '</div>'
      + '<p class="wsx-lens__intro">' + esc(t(introKey)) + '</p>' + body + '</div>';
  }
  function adAutomation() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var run = function () { return Promise.all([
      fetch(wsUrl('/connections'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/schedules'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(wsUrl('/automations'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]); };
    swr('automation', function (res) {
      var conns = (res[0] && res[0].connections) || [];
      var jobs = (res[1] && res[1].schedules) || [];
      var crews = (res[2] && res[2].automations) || [];
      function statusBadge(st, enabled) {
        if (enabled === false) return '<span class="wsx-admin__rolebadge is-off">' + esc(t('admin.autoPaused')) + '</span>';
        var cls = st === 'error' || st === 'failed' ? 'is-off' : st === 'ok' || st === 'success' ? 'is-on' : '';
        return '<span class="wsx-admin__rolebadge ' + cls + '">' + esc(st || 'idle') + '</span>';
      }
      var connRows = conns.map(function (c) {
        var used = (c.usageCount != null ? c.usageCount : (c.usage_count || 0));
        return '<tr><td><span class="wsx-atbl__link">' + esc(c.name || c.provider || t('admin.connectionDefault')) + '</span></td>'
          + '<td><span class="wsx-atbl__type">' + esc(c.provider || c.kind || '\\u2014') + '</span></td>'
          + '<td class="wsx-atbl__num">' + used + '</td>'
          + '<td class="wsx-atbl__date">' + adRelDate(c.created_at) + '</td></tr>';
      }).join('');
      var jobRows = jobs.map(function (j) {
        return '<tr><td><span class="wsx-atbl__link">' + esc(j.title || j.action || t('admin.jobDefault')) + '</span>' + (j.last_error ? '<span class="wsx-atbl__flag" title="' + esc(String(j.last_error)) + '">' + esc(t('admin.errorFlag')) + '</span>' : '') + '</td>'
          + '<td><span class="wsx-atbl__type">' + esc(j.schedule || j.trigger_type || '\\u2014') + '</span></td>'
          + '<td class="wsx-atbl__date">' + (j.last_run_at ? adRelDate(j.last_run_at) : '\\u2014') + '</td>'
          + '<td>' + statusBadge(j.last_status, j.enabled) + '</td></tr>';
      }).join('');
      var crewRows = crews.map(function (c) {
        return '<tr><td><span class="wsx-atbl__link">' + esc(c.crew_name || t('admin.crewDefault')) + '</span></td>'
          + '<td><span class="wsx-atbl__type">' + esc(c.cron || c.kind || '\\u2014') + '</span></td>'
          + '<td class="wsx-atbl__owner">' + esc(c.crew_model || '\\u2014') + '</td>'
          + '<td class="wsx-atbl__date">' + (c.last_run_at ? adRelDate(c.last_run_at) : '\\u2014') + '</td>'
          + '<td>' + statusBadge(c.crew_status, c.enabled) + '</td></tr>';
      }).join('');
      m.innerHTML = adTableSection('admin.autoConnectors', 'admin.autoConnectorsIntro', ['admin.colName', 'admin.colProvider', 'admin.colUsedBy', 'admin.colCreated'], connRows, 'admin.noConnectors')
        + adTableSection('admin.autoScheduledJobs', 'admin.autoScheduledIntro', ['admin.colName', 'admin.colSchedule', 'admin.colLastRun', 'admin.lblStatus'], jobRows, 'admin.noScheduledJobs')
        + adTableSection('admin.autoCrewAutomations', 'admin.autoCrewIntro', ['admin.colCrew', 'admin.colTrigger', 'admin.colModel', 'admin.colLastRun', 'admin.lblStatus'], crewRows, 'admin.noAutomations');
    }, run);
  }
  function supPriorityBadge(p) { var c = { urgent: 'var(--color-error)', high: 'var(--color-warning)', normal: 'var(--color-primary)', low: 'var(--color-text-tertiary)' }[p] || 'var(--color-text-tertiary)'; return p ? '<span class="wsx-atbl__badge" style="background:color-mix(in srgb,' + c + ' 10%,transparent);color:' + c + '">' + esc(p) + '</span>' : ''; }
  function adSupportDetail(id) {
    var m = document.getElementById('wsxAdminMount'); if (!m) return;
    adLoading(m);
    fetch('/v1/support/tickets/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ticket) { m.innerHTML = i18nEmpty('admin.couldNotTicket'); return; }
        var ticket = j.ticket;
        var thread = (j.thread || []).map(function (x) {
          var who = x.author === 'customer' ? t('admin.supportAuthorCustomer') : x.author === 'ai' ? t('admin.supportAuthorAi') : t('admin.supportAuthorStaff');
          return '<div class="wsx-admin__audit-row"><span class="wsx-admin__audit-actor">' + esc(who) + '</span>'
            + '<span class="wsx-admin__audit-action">' + esc(x.body) + '</span>'
            + '<span class="wsx-admin__audit-ts">' + adRelDate(x.created_at) + '</span></div>';
        }).join('');
        m.innerHTML = '<button class="wsx-abtn" id="supBack" type="button">' + esc(t('admin.allTickets')) + '</button>'
          + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(ticket.subject) + ' ' + supPriorityBadge(ticket.priority) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(ticket.channel) + ' \\u00B7 ' + esc(ticket.status) + (ticket.category ? ' \\u00B7 ' + esc(ticket.category) : '') + ' \\u00B7 ' + esc(ticket.requester_email || t('admin.unknown')) + '</p>'
          + '<div class="wsx-admin__auditfeed">' + thread + '</div></div>'
          + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.supportReply')) + '</div>'
          + '<p class="wsx-lens__intro">' + esc(t('admin.supportReplyIntro')) + '</p>'
          + '<textarea class="wsx-admin__email" id="supDraft" style="width:100%;min-height:120px">' + esc(ticket.ai_draft || '') + '</textarea>'
          + '<div class="wsx-admin__domain-add"><button class="wsx-abtn" id="supSend" type="button">' + esc(t('admin.supportApproveSend')) + '</button>'
          + '<button class="wsx-abtn" id="supResolve" type="button">' + esc(t('admin.supportResolve')) + '</button>'
          + '<span class="wsx-admin__savemsg" id="supMsg"></span></div></div>';
        var msg = function (s) { var e = document.getElementById('supMsg'); if (e) e.textContent = s; };
        document.getElementById('supBack').onclick = function () { adSupport(); };
        document.getElementById('supSend').onclick = function () {
          var btn = this;
          var body = (document.getElementById('supDraft') || {}).value || '';
          if (!body.trim()) { msg(t('admin.supportWriteReply')); return; }
          adBusy(btn); msg(t('admin.sending'));
          fetch('/v1/support/tickets/' + encodeURIComponent(id) + '/reply', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: body }) })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (res) { if (res && res.success) { adSupportDetail(id); } else { adIdle(btn); msg(t('admin.supportSendFailed')); } });
        };
        document.getElementById('supResolve').onclick = function () {
          adBusy(this);
          fetch('/v1/support/tickets/' + encodeURIComponent(id) + '/status', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) })
            .then(function (r) { if (r.ok) adSupport(); });
        };
      }).catch(function () { m.innerHTML = i18nEmpty('common.couldNotLoad'); });
  }
  function adSupport() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    adLoading(m);
    fetch('/v1/support/tickets?scope=workspace&workspace=' + encodeURIComponent(window.WSX_WS), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var tickets = (j && j.tickets) || [];
        var rows = tickets.map(function (tk) {
          return '<tr class="wsx-atbl__row is-click" data-sup-id="' + esc(tk.id) + '">'
            + '<td>' + esc(tk.subject) + '</td>'
            + '<td>' + supPriorityBadge(tk.priority) + '</td>'
            + '<td class="wsx-atbl__date">' + esc(tk.status) + '</td>'
            + '<td>' + esc(tk.channel) + '</td>'
            + '<td class="wsx-atbl__date">' + adRelDate(tk.last_msg_at) + '</td></tr>';
        }).join('');
        m.innerHTML = adTableSection('admin.supportTickets', 'admin.supportIntro', ['admin.colSubject', 'admin.colPriority', 'admin.lblStatus', 'admin.colChannel', 'admin.colUpdated'], rows, 'admin.noTickets');
        m.querySelectorAll('[data-sup-id]').forEach(function (row) {
          row.addEventListener('click', function () { adSupportDetail(row.getAttribute('data-sup-id')); });
        });
      }).catch(function () { m.innerHTML = i18nEmpty('common.couldNotLoad'); });
  }
  function loadAdmin() { if (adminTab === 'intelligence') { location.hash = '#l/knowledge'; return; } var fn = { overview: adOverview, artifacts: adArtifacts, members: adMembers, clients: adClients, automation: adAutomation, ai: adAI, security: adSecurity, support: adSupport, settings: adSettings }[adminTab]; if (fn) fn(); }
  ws.querySelectorAll('[data-admin-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      ws.querySelectorAll('[data-admin-tab]').forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.add('is-on'); adminTab = b.getAttribute('data-admin-tab'); loadAdmin();
    });
  });
`;
