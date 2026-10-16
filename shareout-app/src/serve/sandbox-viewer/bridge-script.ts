import type { PWAConfig } from '../../types';
import { componentStylesheet } from '../../design-system/components/stylesheet';

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

const MCP_DIALOG_COPY = {
  en: {
    title: 'Use your {name} account on this page?',
    body: 'This page reads {name} as you, with your own account. Only you see your results.',
    tools: 'It can use: {tools}',
    trust: 'Someone in your workspace built this page. Allow it only if you trust them.',
    connectFirst: 'Connect your {name} account first.',
    connect: 'Connect {name}',
    allow: 'Allow',
    notNow: 'Not now',
    close: 'Close',
    failed: 'That did not work. Try again.',
  },
  es: {
    title: '¿Usar tu cuenta de {name} en este artefacto?',
    body: 'Este artefacto lee {name} como vos, con tu propia cuenta. Solo vos ves tus resultados.',
    tools: 'Puede usar: {tools}',
    trust: 'Alguien de tu workspace hizo este artefacto. Permitilo solo si confiás en esa persona.',
    connectFirst: 'Primero conectá tu cuenta de {name}.',
    connect: 'Conectar {name}',
    allow: 'Permitir',
    notNow: 'Ahora no',
    close: 'Cerrar',
    failed: 'No funcionó. Probá de nuevo.',
  },
} as const;

/**
 * Pages that declare MCP connections. The host page (never the sandboxed frame):
 * - hands the frame a short-lived broker token on request, fetched with this page's
 *   session cookie (same-origin), which the frame can never send itself;
 * - shows the allow / connect dialog when the frame asks for access to a connection.
 *   "Not now" is final for this page load, so a page can't nag.
 */
export function renderMcpHostBridge(artifactId: string, lang: string = 'en'): string {
  const copy = lang.startsWith('es') ? MCP_DIALOG_COPY.es : MCP_DIALOG_COPY.en;
  return `<style>${componentStylesheet({ withVars: true })}
.so-mcp-tools { margin: 10px 0 0; font-size: 0.8125rem; color: var(--color-text-secondary); }
.so-mcp-trust { margin: 10px 0 0; font-size: 0.8125rem; color: var(--color-text-secondary); }
.so-mcp-err { margin: 10px 0 0; font-size: 0.8125rem; color: var(--color-error); }
</style><script>
(function() {
  if (window.__shareoutMcpBridge) return;
  window.__shareoutMcpBridge = true;
  var id = ${JSON.stringify(artifactId)};
  var copy = ${JSON.stringify(copy)};
  var declined = {};
  var dialogOpen = false;
  function frame() { return document.querySelector('iframe'); }
  function post(msg) { var f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); }
  function fill(s, name, tools) { return s.split('{name}').join(name).split('{tools}').join(tools || ''); }
  function api(path, init) {
    var opts = { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (init) { for (var k in init) opts[k] = init[k]; }
    return fetch('/v1/artifacts/' + encodeURIComponent(id) + '/mcp/' + path, opts).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(b) { if (!r.ok) throw b || {}; return b; });
    });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function showDialog(conn, workspaceId, done) {
    dialogOpen = true;
    var overlay = el('div', 'so-c-modal-overlay so-c-modal-overlay--top');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    var panel = el('div', 'so-c-modal');
    var head = el('div', 'so-c-modal__head');
    var title = el('span', 'so-c-modal__title', fill(copy.title, conn.name));
    title.id = 'so-mcp-title';
    overlay.setAttribute('aria-labelledby', 'so-mcp-title');
    var x = el('button', 'so-c-modal__close', '\u00d7');
    x.type = 'button';
    x.setAttribute('aria-label', copy.close);
    head.appendChild(title); head.appendChild(x);
    var body = el('div', 'so-c-modal__body');
    var lead = el('p', null, fill(copy.body, conn.name));
    var tools = el('p', 'so-mcp-tools', fill(copy.tools, conn.name, (conn.tools || []).join(', ')));
    var trust = el('p', 'so-mcp-trust', copy.trust);
    var err = el('p', 'so-mcp-err');
    err.setAttribute('role', 'alert');
    body.appendChild(lead); body.appendChild(tools); body.appendChild(trust); body.appendChild(err);
    var foot = el('div', 'so-c-modal__foot');
    var later = el('button', 'so-c-btn so-c-btn--secondary', copy.notNow);
    later.type = 'button';
    var primary = el('button', 'so-c-btn so-c-btn--primary');
    primary.type = 'button';
    foot.appendChild(later); foot.appendChild(primary);
    panel.appendChild(head); panel.appendChild(body); panel.appendChild(foot);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function render() {
      primary.textContent = conn.connected ? copy.allow : fill(copy.connect, conn.name);
      if (!conn.connected) err.textContent = '';
    }
    function finish(result) {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onPopup);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      dialogOpen = false;
      done(result);
    }
    function decline() { declined[conn.name] = true; finish({ allowed: false, connected: !!conn.connected, code: 'declined' }); }
    function onKey(e) { if (e.key === 'Escape') decline(); }
    var popup = null;
    function onPopup(e) {
      if (!popup || e.source !== popup || !e.data) return;
      if (e.data.type === 'shareout:workspace:connection:connected') {
        api('consent').then(function(state) {
          for (var i = 0; i < state.connections.length; i++) if (state.connections[i].name === conn.name) conn = state.connections[i];
          render();
        }).catch(function() { err.textContent = copy.failed; });
      } else if (e.data.type === 'shareout:workspace:connection:error') {
        err.textContent = (e.data.message && String(e.data.message)) || copy.failed;
      }
    }
    x.addEventListener('click', decline);
    later.addEventListener('click', decline);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) decline(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onPopup);
    primary.addEventListener('click', function() {
      err.textContent = '';
      if (!conn.connected) {
        popup = window.open('about:blank', 'so_mcp_' + conn.connectionId, 'width=640,height=760');
        fetch('/v1/workspaces/' + encodeURIComponent(workspaceId) + '/connections/' + encodeURIComponent(conn.connectionId) + '/mcp/connect', { credentials: 'same-origin' })
          .then(function(r) { return r.json().then(function(b) { if (!r.ok || !b.authUrl) throw b; return b; }); })
          .then(function(b) { if (popup) popup.location.href = b.authUrl; else window.open(b.authUrl, '_blank'); })
          .catch(function(b) { try { if (popup) popup.close(); } catch (_) {} err.textContent = (b && b.error) || copy.failed; });
        return;
      }
      primary.disabled = true;
      api('consent', { method: 'POST', body: JSON.stringify({ connections: [conn.name] }) })
        .then(function() { finish({ allowed: true, connected: true }); })
        .catch(function(b) { primary.disabled = false; err.textContent = (b && b.error) || copy.failed; });
    });
    render();
    primary.focus();
  }

  window.addEventListener('message', function(e) {
    var iframe = frame();
    if (!iframe || e.source !== iframe.contentWindow) return;
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;

    if (d.type === 'shareout:mcp-token-request') {
      api('token')
        .then(function(b) { post({ type: 'shareout:mcp-token', requestId: d.requestId, token: b.token, expiresAt: b.expiresAt }); })
        .catch(function(b) { post({ type: 'shareout:mcp-token', requestId: d.requestId, token: null, code: (b && b.code) || 'UPSTREAM_ERROR', error: (b && b.error) || 'MCP token request failed' }); });
      return;
    }

    if (d.type === 'shareout:mcp-access-request') {
      var name = String(d.connection || '');
      var reply = function(r) { post({ type: 'shareout:mcp-access', requestId: d.requestId, connection: name, allowed: !!r.allowed, connected: !!r.connected, code: r.code || null }); };
      if (declined[name]) { reply({ allowed: false, code: 'declined' }); return; }
      if (dialogOpen) { reply({ allowed: false, code: 'busy' }); return; }
      api('consent').then(function(state) {
        var conn = null;
        for (var i = 0; i < state.connections.length; i++) if (state.connections[i].name === name) conn = state.connections[i];
        if (!conn || !conn.available) { reply({ allowed: false, code: 'not_in_manifest' }); return; }
        if (conn.connected && conn.allowed) { reply({ allowed: true, connected: true }); return; }
        showDialog(conn, state.workspaceId, reply);
      }).catch(function(b) { reply({ allowed: false, code: (b && b.code) || 'upstream_error' }); });
    }
  });
})();
</script>`;
}
