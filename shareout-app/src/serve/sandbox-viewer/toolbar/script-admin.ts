/** Auto-extracted client script for the sandbox viewer toolbar. */
export function renderToolbarScriptAdmin(baseUrl: string, slug: string, artifactId: string): string {
  return `
    var statsLoaded = false;
    var adminLoaded = false;
    window.openStats = function() {
      document.getElementById('so-stats-overlay').classList.add('open');
      if (!statsLoaded) {
        loadStats();
        statsLoaded = true;
      }
    };
    window.closeStats = function() {
      document.getElementById('so-stats-overlay').classList.remove('open');
    };
    window.openAdmin = function() {
      document.getElementById('so-admin-overlay').classList.add('open');
      if (!adminLoaded) {
        loadAdmin();
        adminLoaded = true;
      }
    };
    window.closeAdmin = function() {
      document.getElementById('so-admin-overlay').classList.remove('open');
    };
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { closeStats(); closeAdmin(); }
    });
    function loadStats() {
      fetch('${baseUrl}/v1/artifacts/${artifactId}/analytics', { credentials: 'include' })
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          if (data.error) throw new Error(data.error);
          renderStats(data);
        })
        .catch(function(err) {
          console.error('Stats error:', err);
          document.getElementById('so-stats-content').innerHTML =
            '<div class="so-stats-empty">Could not load stats</div>';
        });
    }
    function renderStats(data) {
      var views = data.totalViews || 0;
      var uniqueVisitors = data.uniqueVisitors || 0;
      var dailyStats = data.dailyStats || [];
      var todayStr = new Date().toISOString().split('T')[0];
      var todayViews = 0;
      dailyStats.forEach(function(d) { if (d.date === todayStr) todayViews = d.views; });
      var viewers = data.viewerTracking || [];
      var topCountries = data.topCountries || [];

      var html = '<div class="so-stats-grid">' +
        '<div class="so-stat-card highlight"><div class="so-stat-value">' + formatNumber(views) + '</div><div class="so-stat-label">Total Views</div></div>' +
        '<div class="so-stat-card"><div class="so-stat-value">' + formatNumber(uniqueVisitors) + '</div><div class="so-stat-label">Unique Visitors</div></div>' +
        '<div class="so-stat-card"><div class="so-stat-value">' + formatNumber(todayViews) + '</div><div class="so-stat-label">Views Today</div></div>' +
        '<div class="so-stat-card"><div class="so-stat-value">' + (topCountries.length || '—') + '</div><div class="so-stat-label">Countries</div></div>' +
      '</div>';

      var seen = viewers.filter(function(v) { return v.hasViewed; });
      if (seen.length > 0) {
        var viewerRow = function(v) {
          var label = v.name || v.email || 'Anonymous';
          var initials = (v.name || v.email || '?').substring(0, 2).toUpperCase();
          var time = v.lastViewedAt ? timeAgo(new Date(v.lastViewedAt)) : '';
          return '<div class="so-recent-item" title="' + escapeHtml(v.email || '') + '"><div class="so-recent-avatar">' + initials + '</div><div class="so-recent-info"><div class="so-recent-name">' + escapeHtml(label) + '</div><div class="so-recent-time">' + time + '</div></div></div>';
        };
        html += '<div class="so-stats-section"><div class="so-stats-section-title">Viewers (' + seen.length + ')</div><div class="so-recent-list">';
        html += seen.slice(0, 10).map(viewerRow).join('');
        html += '</div>';
        if (seen.length > 10) {
          html += '<div class="so-recent-list" hidden>' + seen.slice(10).map(viewerRow).join('') + '</div>';
          html += '<button type="button" class="so-viewers-more" data-more="Show all" data-less="Show fewer" onclick="var m=this.previousElementSibling;m.hidden=!m.hidden;this.textContent=m.hidden?this.getAttribute(\\'data-more\\'):this.getAttribute(\\'data-less\\')">Show all</button>';
        }
        html += '</div>';
      }

      if (topCountries.length > 0) {
        html += '<div class="so-stats-section"><div class="so-stats-section-title">Top Countries</div><div class="so-recent-list">';
        topCountries.slice(0, 5).forEach(function(c) {
          html += '<div class="so-recent-item" style="padding:8px 12px"><div style="flex:1;font-size:14px;color:var(--color-text)">' + escapeHtml(c.name) + '</div><div style="font-size:14px;font-weight:600;color:var(--color-text-secondary)">' + formatNumber(c.count) + '</div></div>';
        });
        html += '</div></div>';
      }

      document.getElementById('so-stats-content').innerHTML = html;
    }
    function formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }
    function formatTime(seconds) {
      if (seconds < 60) return Math.round(seconds) + 's';
      if (seconds < 3600) return Math.round(seconds / 60) + 'm';
      return Math.round(seconds / 3600) + 'h';
    }
    function loadAdmin() {
      fetch('${baseUrl}/v1/artifacts/${artifactId}', { credentials: 'include' })
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          if (data.error) throw new Error(data.error);
          renderAdmin(data);
        })
        .catch(function(err) {
          console.error('Admin error:', err);
          document.getElementById('so-admin-content').innerHTML =
            '<div class="so-stats-empty">Could not load settings</div>';
        });
    }
    function renderAdmin(data) {
      var visClass = data.visibility === 'private' ? 'so-badge-private' : 'so-badge-public';
      var statusClass = data.paused ? 'so-badge-paused' : 'so-badge-active';
      var authLabel = { google: 'Google Sign-in', password: 'Password', credentials: 'Username/Password', none: 'None' };

      var html = '<div class="so-stats-section"><div class="so-stats-section-title">General</div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">Name</span><span class="so-prop-value">' + escapeHtml(data.name) + '</span></div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">Type</span><span class="so-prop-value">' + escapeHtml(data.artifact_type || 'html').toUpperCase() + '</span></div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">Version</span><span class="so-prop-value">v' + (data.current_version || 1) + '</span></div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">Visibility</span><span class="so-badge ' + visClass + '">' + escapeHtml(data.visibility) + '</span></div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">Status</span><span class="so-badge ' + statusClass + '">' + (data.paused ? 'Paused' : 'Active') + '</span></div>';
      if (data.visibility === 'private') {
        html += '<div class="so-prop-row"><span class="so-prop-label">Auth Method</span><span class="so-prop-value">' + (authLabel[data.auth_method] || data.auth_method) + '</span></div>';
      }
      html += '</div>';

      html += '<div class="so-stats-section"><div class="so-stats-section-title">URL</div>';
      html += '<div class="so-url-box"><span class="so-url-text">' + escapeHtml(data.url) + '</span><button class="so-url-copy" onclick="copyUrl(\\''+escapeHtml(data.url)+'\\')">Copy</button></div>';
      html += '</div>';

      html += '<div class="so-stats-section"><div class="so-stats-section-title">Viewer</div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">ShareOut toolbar</span><button class="so-url-copy" id="so-toolbar-toggle" onclick="toggleViewerToolbar()">…</button></div>';
      html += '<div class="so-prop-row" id="so-mobile-toolbar-row"><span class="so-prop-label">Show on mobile</span><button class="so-url-copy" id="so-mobile-toolbar-toggle" onclick="toggleViewerToolbarMobile()">…</button></div>';
      html += '<div class="so-prop-row"><span class="so-prop-label" style="font-size:12px;color:var(--color-text-tertiary)">Floating logo button (Stats, Settings). Hidden on phones by default.</span></div>';
      html += '</div>';
      loadViewerConfig();

      html += '<div class="so-stats-section"><div class="so-stats-section-title">Comments</div>';
      html += '<div class="so-prop-row"><span class="so-prop-label">Comments overlay</span><button class="so-url-copy" id="so-cmt-toggle" onclick="toggleCommentsOverlay()">…</button></div>';
      html += '<div class="so-prop-row"><span class="so-prop-label" style="font-size:12px;color:var(--color-text-tertiary)">Lets viewers leave comments on this page</span></div>';
      html += '</div>';
      loadCommentsConfig();

      html += '<div class="so-stats-section" id="so-connectors-section"><div class="so-stats-section-title">Data connectors</div><div id="so-connectors-content"><div class="so-stats-loading">Loading…</div></div></div>';

      if (data.embed_allowed) {
        html += '<div class="so-stats-section"><div class="so-stats-section-title">Embed</div>';
        html += '<div class="so-prop-row"><span class="so-prop-label">Embedding</span><span class="so-badge so-badge-active">Enabled</span></div>';
        if (data.embed_origins && data.embed_origins.length > 0) {
          html += '<div class="so-prop-row"><span class="so-prop-label">Allowed Origins</span><span class="so-prop-value">' + data.embed_origins.length + ' domains</span></div>';
        }
        html += '<div class="so-url-box"><span class="so-url-text">' + escapeHtml(data.embed_url) + '</span><button class="so-url-copy" onclick="copyUrl(\\''+escapeHtml(data.embed_url)+'\\')">Copy</button></div>';
        html += '</div>';
      }

      var viewers = data.viewers || [];
      if (viewers.length > 0) {
        html += '<div class="so-stats-section"><div class="so-stats-section-title">Collaborators (' + viewers.length + ')</div>';
        html += '<div class="so-collab-list">';
        viewers.slice(0, 8).forEach(function(email) {
          var initials = email.substring(0, 2).toUpperCase();
          html += '<div class="so-collab-item"><div class="so-collab-avatar">' + initials + '</div><span class="so-collab-email">' + escapeHtml(email) + '</span><span class="so-collab-role">viewer</span></div>';
        });
        if (viewers.length > 8) {
          html += '<div style="text-align:center;color:var(--color-text-tertiary);font-size:12px;padding:8px">+' + (viewers.length - 8) + ' more</div>';
        }
        html += '</div></div>';
      }

      if (data.created_at) {
        html += '<div class="so-stats-section"><div class="so-stats-section-title">Dates</div>';
        html += '<div class="so-prop-row"><span class="so-prop-label">Created</span><span class="so-prop-value">' + formatDate(data.created_at) + '</span></div>';
        if (data.updated_at) {
          html += '<div class="so-prop-row"><span class="so-prop-label">Last Updated</span><span class="so-prop-value">' + formatDate(data.updated_at) + '</span></div>';
        }
        html += '</div>';
      }

      document.getElementById('so-admin-content').innerHTML = html;
      loadArtifactConnectors();
    }
    var CONN_LABELS = { rest_api: 'REST API', bigquery: 'BigQuery', snowflake: 'Snowflake', postgres: 'PostgreSQL', snowflake_kp: 'Snowflake', 'google-sheets': 'Google Sheets', 'google-analytics': 'Google Analytics', google_analytics: 'Google Analytics', shopify: 'Shopify', tiendanube: 'Tiendanube', slack: 'Slack' };
    function connProviderLabel(p) {
      if (!p) return 'Connector';
      var k = String(p).toLowerCase().replace(/_/g, '-');
      return CONN_LABELS[k] || CONN_LABELS[p] || String(p).replace(/[-_]/g, ' ').replace(/\\b\\w/g, function(c) { return c.toUpperCase(); });
    }
    function mergeArtifactConnectors(generic, platform, sheets) {
      var seen = {}, out = [];
      function add(name, provider, scope) {
        var key = String(name || '').toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = 1;
        out.push({ name: name, provider: provider, scope: scope || 'artifact' });
      }
      (generic || []).forEach(function(c) { add(c.name, c.type, c.scope); });
      (platform || []).forEach(function(c) { add(c.name, c.provider, c.scope); });
      (sheets || []).forEach(function(c) { add(c.name, 'google-sheets', 'artifact'); });
      out.sort(function(a, b) { return a.name.localeCompare(b.name); });
      return out;
    }
    function loadArtifactConnectors() {
      var box = document.getElementById('so-connectors-content');
      if (!box) return;
      Promise.all([
        fetch('${baseUrl}/v1/data/${artifactId}/connections', { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }),
        fetch('${baseUrl}/v1/data/${artifactId}/platform/connections', { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }),
        fetch('${baseUrl}/v1/data/${artifactId}/sheets', { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }),
      ]).then(function(rs) {
        var items = mergeArtifactConnectors(rs[0] && rs[0].connections, rs[1] && rs[1].connections, rs[2] && rs[2].connections);
        if (!items.length) {
          box.innerHTML = '<div class="so-stats-empty">No data connectors configured</div>';
          return;
        }
        box.innerHTML = '<div class="so-conn-list">' + items.map(function(c) {
          var sub = connProviderLabel(c.provider) + (c.scope === 'workspace' ? ' · workspace shared' : '');
          return '<div class="so-conn-item"><span class="so-conn-name">' + escapeHtml(c.name) + '</span><span class="so-conn-meta">' + escapeHtml(sub) + '</span></div>';
        }).join('') + '</div>';
      }).catch(function() {
        box.innerHTML = '<div class="so-stats-empty">Could not load connectors</div>';
      });
    }
    function formatDate(d) {
      var date = new Date(d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    window.copyUrl = function(url) {
      navigator.clipboard.writeText(url).then(function() {
        var btns = document.querySelectorAll('.so-url-copy');
        btns.forEach(function(b) { if (b.previousElementSibling.textContent === url) b.textContent = 'Copied!'; });
        setTimeout(function() { btns.forEach(function(b) { if (b.id !== 'so-cmt-toggle' && b.id !== 'so-toolbar-toggle' && b.id !== 'so-mobile-toolbar-toggle') b.textContent = 'Copy'; }); }, 1500);
      });
    };
    var cmtOverlayOn = true;
    var viewerToolbarOn = true;
    var viewerToolbarMobileOn = false;
    function updateViewerToggles() {
      var tb = document.getElementById('so-toolbar-toggle');
      var mob = document.getElementById('so-mobile-toolbar-toggle');
      var mobRow = document.getElementById('so-mobile-toolbar-row');
      if (tb) tb.textContent = viewerToolbarOn ? 'On' : 'Off';
      if (mob) mob.textContent = viewerToolbarMobileOn ? 'On' : 'Off';
      if (mobRow) mobRow.style.display = viewerToolbarOn ? '' : 'none';
    }
    function saveViewerConfig(patch, reload) {
      var next = {
        hide_toolbar: patch.hide_toolbar !== undefined ? patch.hide_toolbar : !viewerToolbarOn,
        show_on_mobile: patch.show_on_mobile !== undefined ? patch.show_on_mobile : viewerToolbarMobileOn,
      };
      return fetch('${baseUrl}/v1/data/${artifactId}/json/_viewer_config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function() {
          viewerToolbarOn = !next.hide_toolbar;
          viewerToolbarMobileOn = next.show_on_mobile;
          updateViewerToggles();
          if (reload) window.location.reload();
        });
    }
    function loadViewerConfig() {
      fetch('${baseUrl}/v1/data/${artifactId}/json/_viewer_config', { credentials: 'include' })
        .then(function(r) {
          if (r.status === 404) return {};
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(res) {
          var cfg = (res && res.data && res.data.value) || (res && res.value) || {};
          viewerToolbarOn = cfg.hide_toolbar !== true;
          viewerToolbarMobileOn = cfg.show_on_mobile === true;
          updateViewerToggles();
        })
        .catch(function() { updateViewerToggles(); });
    }
    window.toggleViewerToolbar = function() {
      var b = document.getElementById('so-toolbar-toggle');
      if (b) b.disabled = true;
      saveViewerConfig({ hide_toolbar: viewerToolbarOn }, true)
        .catch(function(err) { console.error('Toggle viewer toolbar error:', err); })
        .finally(function() { if (b) b.disabled = false; });
    };
    window.toggleViewerToolbarMobile = function() {
      var b = document.getElementById('so-mobile-toolbar-toggle');
      if (b) b.disabled = true;
      saveViewerConfig({ show_on_mobile: !viewerToolbarMobileOn }, true)
        .catch(function(err) { console.error('Toggle mobile toolbar error:', err); })
        .finally(function() { if (b) b.disabled = false; });
    };
    function updateCmtToggle() {
      var b = document.getElementById('so-cmt-toggle');
      if (b) b.textContent = cmtOverlayOn ? 'On' : 'Off';
    }
    function loadCommentsConfig() {
      fetch('${baseUrl}/v1/data/${artifactId}/comments/_config', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          var cfg = (res && res.data) || res || {};
          cmtOverlayOn = cfg.enabled !== false && cfg.overlayEnabled !== false;
          updateCmtToggle();
        })
        .catch(function() { updateCmtToggle(); });
    }
    window.toggleCommentsOverlay = function() {
      var next = !cmtOverlayOn;
      var b = document.getElementById('so-cmt-toggle');
      if (b) b.disabled = true;
      fetch('${baseUrl}/v1/data/${artifactId}/comments/_config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlayEnabled: next })
      })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function() { cmtOverlayOn = next; updateCmtToggle(); })
        .catch(function(err) { console.error('Toggle comments error:', err); })
        .finally(function() { if (b) b.disabled = false; });
    };`;
}
