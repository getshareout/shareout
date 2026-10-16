import type { PWAConfig } from '../../types';

/**
 * CDN mode: stream immediately after the iframe so the parent can deliver
 * shareout:init as soon as prefetch finishes — the artifact may already be
 * executing ShareOut.create() in the opaque-origin sandbox (ADR 30).
 */
export function renderEarlyCdnBridgeHook(): string {
  return `<script>
(function() {
  var pending = null;
  function send() {
    if (!pending) return;
    var iframe = document.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'shareout:init', data: pending }, '*');
  }
  window.__shareoutDeliverInit = function(data) {
    pending = data;
    send();
  };
  function bind() {
    var iframe = document.querySelector('iframe');
    if (!iframe) return;
    iframe.addEventListener('load', send);
    window.addEventListener('message', function(e) {
      if (e.source !== iframe.contentWindow) return;
      if (e.data && e.data.type === 'shareout:ready') send();
    });
    send();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
</script>`;
}

/** Late-streamed delivery for CDN mode (pairs with renderEarlyCdnBridgeHook). */
export function renderDeferredBridgeDelivery(serializedInitialData: string): string {
  return `<script>window.__shareoutDeliverInit && window.__shareoutDeliverInit(${serializedInitialData});</script>`;
}

/**
 * Parent-page bridge: forwards initial data into the sandboxed iframe and
 * optionally boots the mobile SDK when PWA mode is enabled.
 */
export function renderBridgeScript(
  serializedInitialData: string,
  pwaConfig: PWAConfig | null,
  baseUrl: string,
): string {
  const mobileSDKScript = pwaConfig?.enabled
    ? `<script src="${baseUrl}/sdk/v1/shareout-mobile.js"></script>\n  `
    : '';

  return `${mobileSDKScript}<script>
(function() {
  var data = ${serializedInitialData};
  function init() {
    var iframe = document.querySelector('iframe');
    if (!iframe) return;
    // The artifact runs in an opaque-origin sandbox, so its messages arrive with
    // origin "null" and targetOrigin can't be pinned — we post with '*'. Guard the
    // handshake by source identity instead: only react to ready events coming from
    // our own iframe window, and only post the init (with the viewer's data token)
    // to that same window.
    function send() {
      if (iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'shareout:init', data: data }, '*');
    }
    iframe.addEventListener('load', send);
    window.addEventListener('message', function(e) {
      if (e.source !== iframe.contentWindow) return;
      if (e.data && e.data.type === 'shareout:ready') send();
    });
    if (iframe.contentWindow) send();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Auto-init mobile SDK if available and PWA enabled
  if (window.ShareOut && window.ShareOut.mobile && ${pwaConfig?.enabled || false}) {
    ShareOut.mobile.init({ registerServiceWorker: true });
  }
})();
</script>`;
}

/**
 * Pages that declare MCP connections: hand the frame a short-lived broker token on
 * request. The fetch rides this page's session cookie (same-origin), which the
 * sandboxed frame can never send itself.
 */
export function renderMcpHostBridge(artifactId: string): string {
  return `<script>
(function() {
  if (window.__shareoutMcpBridge) return;
  window.__shareoutMcpBridge = true;
  var id = ${JSON.stringify(artifactId)};
  window.addEventListener('message', function(e) {
    var iframe = document.querySelector('iframe');
    if (!iframe || e.source !== iframe.contentWindow) return;
    var d = e.data;
    if (!d || d.type !== 'shareout:mcp-token-request') return;
    function reply(msg) {
      msg.type = 'shareout:mcp-token';
      msg.requestId = d.requestId;
      if (iframe.contentWindow) iframe.contentWindow.postMessage(msg, '*');
    }
    fetch('/v1/artifacts/' + encodeURIComponent(id) + '/mcp/token', { credentials: 'same-origin' })
      .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b || {} }; }); })
      .then(function(res) {
        if (res.ok) reply({ token: res.body.token, expiresAt: res.body.expiresAt });
        else reply({ token: null, code: res.body.code || 'UPSTREAM_ERROR', error: res.body.error || 'MCP token request failed' });
      })
      .catch(function() { reply({ token: null, code: 'UPSTREAM_ERROR', error: 'MCP token request failed' }); });
  });
})();
</script>`;
}
