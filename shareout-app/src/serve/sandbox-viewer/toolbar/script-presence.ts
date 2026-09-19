/** Auto-extracted client script for live viewer presence in toolbar chrome. */
export function renderToolbarScriptPresence(baseUrl: string, artifactId: string): string {
  return `
    var livePresenceBtn = document.getElementById('so-live-presence-btn');
    function renderLivePresence(count) {
      if (!livePresenceBtn) return;
      var label = document.getElementById('so-live-presence-label');
      var avatars = document.getElementById('so-live-presence-avatars');
      var safeCount = Math.max(0, Number(count) || 0);
      if (label) {
        label.textContent = safeCount === 1 ? '1 viewing now' : safeCount + ' viewing now';
      }
      if (avatars) {
        var visible = Math.min(safeCount, 3);
        var html = '';
        for (var i = 0; i < visible; i++) {
          var token = i === 0 ? 'Y' : '•';
          html += '<span class="so-live-presence-avatar' + (i === 0 ? ' is-you' : '') + '">' + token + '</span>';
        }
        if (safeCount > 3) {
          html += '<span class="so-live-presence-avatar so-live-presence-more">+' + (safeCount - 3) + '</span>';
        }
        avatars.innerHTML = html;
      }
      livePresenceBtn.classList.toggle('is-active', safeCount > 0);
    }
    function pollLivePresence() {
      if (!livePresenceBtn) return;
      fetch('${baseUrl}/v1/artifacts/${artifactId}/presence', { credentials: 'include' })
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) { renderLivePresence(data && data.count); })
        .catch(function() {
          livePresenceBtn.hidden = true;
        });
    }
    if (livePresenceBtn) {
      pollLivePresence();
      window.setInterval(function() {
        if (document.visibilityState !== 'hidden') pollLivePresence();
      }, 15000);
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState !== 'hidden') pollLivePresence();
      });
    }`;
}
