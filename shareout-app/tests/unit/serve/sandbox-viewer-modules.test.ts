import { describe, expect, it } from 'vitest';
import { serializeForInlineScript } from '../../../src/serve/sandbox-viewer/serialize';
import { parsePwaConfig, renderPwaMetaTags } from '../../../src/serve/sandbox-viewer/pwa-tags';
import { renderInlinedStyleBlock } from '../../../src/serve/sandbox-viewer/manifest-preload';
import {
  renderBridgeScript,
  renderEarlyCdnBridgeHook,
  renderDeferredBridgeDelivery,
} from '../../../src/serve/sandbox-viewer/bridge-script';
import { buildToolbarContext } from '../../../src/serve/sandbox-viewer/toolbar/context';
import { renderToolbar } from '../../../src/serve/sandbox-viewer/toolbar';
import { renderEarlyHead } from '../../../src/serve/sandbox-viewer/early-head';
import { renderLoadingHideScript } from '../../../src/serve/sandbox-viewer/loading';

describe('sandbox-viewer modules', () => {
  it('renderEarlyHead paints the loading skeleton and opens body in the first chunk', () => {
    const head = renderEarlyHead('My Artifact', '', '', undefined, false);
    expect(head).toContain('<!DOCTYPE html>');
    expect(head).toContain('id="so-loading"');
    expect(head).toContain('so-sk-card');
    expect(head).not.toContain('so-sk-row');
    expect(head).toContain('<body>');
    // Body stays open for the rest of the streamed body (iframe/toolbar/scripts).
    expect(head).not.toContain('</body>');
  });

  it('the header gives signed-out visitors the title and Comments only, signed-in viewers the full bar', () => {
    const base = {
      loggedIn: false, isFav: false, commentsEnabled: true, commentsIdentityMode: 'anonymous', commentsGuest: false,
      commentCount: 0, hasMetrics: false, adminInfo: null, currentUser: null, hideToolbar: false,
      baseUrl: 'https://x.dev', slug: 's', artifactId: 'art_1', title: 'Demo page', attachedSkills: [], locale: 'es',
    } as unknown as Parameters<typeof buildToolbarContext>[0];
    const anon = renderToolbar(buildToolbarContext(base)!);
    expect(anon).toContain('class="so-hd so-hd--guest"');
    expect(anon).toContain('Comentarios');
    expect(anon).not.toContain('id="so-share-btn"');
    expect(anon).not.toContain('soOpenSchedule(');
    expect(anon).not.toContain('href="https://x.dev/home"');
    const signed = renderToolbar(buildToolbarContext({ ...base, loggedIn: true })!);
    expect(signed).toContain('id="so-header" class="so-hd"');
    expect(signed).toContain('href="https://x.dev/home"');
    expect(signed).toContain('id="so-share-btn"');
    expect(signed).toContain('id="so-fav-btn"');
    // No floating logo menu any more.
    expect(signed).not.toContain('so-toolbar-trigger');
    const en = renderToolbar(buildToolbarContext({ ...base, locale: 'en' })!);
    expect(en).toContain('Comments');
    expect(en).not.toContain('Comentarios');
  });

  it('renderLoadingHideScript hides the skeleton on content-ready with fallbacks', () => {
    const script = renderLoadingHideScript();
    expect(script).toContain("'shareout:content-ready'");
    expect(script).toContain("addEventListener('load'");
    expect(script).toContain('so-loaded');
  });

  it('serializeForInlineScript escapes script-breaking characters', () => {
    const serialized = serializeForInlineScript({
      html: '</script><script>alert(1)</script>',
      amp: 'a&b',
    });

    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c/script\\u003e');
    expect(serialized).toContain('\\u0026');
  });

  it('parsePwaConfig ignores invalid JSON', () => {
    expect(parsePwaConfig('{not json')).toBeNull();
    expect(parsePwaConfig(null)).toBeNull();
    expect(parsePwaConfig(JSON.stringify({ enabled: true, name: 'Demo' }))).toEqual({
      enabled: true,
      name: 'Demo',
    });
  });

  it('renderPwaMetaTags returns empty string when PWA is disabled', () => {
    expect(renderPwaMetaTags({ enabled: false }, 'https://shareout.site', 'demo')).toBe('');
  });

  it('renderPwaMetaTags emits manifest link when enabled', () => {
    const tags = renderPwaMetaTags(
      { enabled: true, name: 'My App', theme_color: '#2563eb' },
      'https://shareout.site',
      'demo',
    );

    expect(tags).toContain('rel="manifest"');
    expect(tags).toContain('My App');
    expect(tags).toContain('#2563eb');
  });

  it('renderPwaMetaTags defaults theme_color to design token primary', () => {
    const tags = renderPwaMetaTags(
      { enabled: true, name: 'My App' },
      'https://shareout.site',
      'demo',
    );

    expect(tags).toContain('#2563eb');
    expect(tags).not.toContain('#3b82f6');
  });

  it('renderInlinedStyleBlock wraps CSS when present', () => {
    expect(renderInlinedStyleBlock('body{color:red}')).toContain('inlined-critical');
    expect(renderInlinedStyleBlock('')).toBe('');
  });

  it('renderBridgeScript embeds serialized data and optional mobile SDK', () => {
    const serialized = serializeForInlineScript({ artifactId: 'art_1' });
    const withoutPwa = renderBridgeScript(serialized, null, 'https://shareout.site');
    expect(withoutPwa).toContain('shareout:init');
    expect(withoutPwa).not.toContain('shareout-mobile.js');

    const withPwa = renderBridgeScript(serialized, { enabled: true }, 'https://shareout.site');
    expect(withPwa).toContain('shareout-mobile.js');
  });

  it('CDN early hook + deferred delivery pair for fast iframe streaming', () => {
    const hook = renderEarlyCdnBridgeHook();
    expect(hook).toContain('__shareoutDeliverInit');
    expect(hook).toContain('shareout:ready');

    const serialized = serializeForInlineScript({ artifactId: 'art_abc', baseUrl: 'https://shareout.site' });
    const delivery = renderDeferredBridgeDelivery(serialized);
    expect(delivery).toContain('__shareoutDeliverInit');
    expect(delivery).toContain('"artifactId":"art_abc"');
  });

  it('buildToolbarContext returns null when toolbar should be hidden', () => {
    expect(buildToolbarContext({
      loggedIn: false,
      isFav: false,
      commentsEnabled: false,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: null,
      currentUser: null,
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
    })).toBeNull();
  });

  it('buildToolbarContext returns null when hideToolbar is set', () => {
    expect(buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: true,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: { role: 'owner' } as never,
      currentUser: { email: 'o@example.com', name: 'Owner', picture: '' },
      hideToolbar: true,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
    })).toBeNull();
  });

  it('shows the owner and version to signed-in viewers only', () => {
    const base = {
      loggedIn: true, isFav: false, commentsEnabled: true, commentCount: 0, hasMetrics: false,
      adminInfo: null, currentUser: { email: 'leo@example.com', name: 'Leo Example', picture: '' }, hideToolbar: false,
      baseUrl: 'https://shareout.site', slug: 'demo', artifactId: 'art_1', attachedSkills: [],
      title: 'Q3 <review>', ownerName: 'Ana Acme', versionNo: 12,
    };
    const signed = renderToolbar(buildToolbarContext(base)!);
    expect(signed).toContain('Q3 &lt;review&gt;');
    expect(signed).toContain('Ana Acme');
    expect(signed).toContain('>v12<');
    const anon = buildToolbarContext({ ...base, loggedIn: false, currentUser: null })!;
    expect(anon.ownerName).toBeNull();
    expect(anon.versionNo).toBeNull();
    const anonHtml = renderToolbar(anon);
    expect(anonHtml).toContain('Q3 &lt;review&gt;');
    expect(anonHtml).not.toContain('Ana Acme');
    expect(anonHtml).not.toContain('>v12<');
  });

  function followCtx(hasMetrics: boolean) {
    return buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: false,
      commentCount: 0,
      hasMetrics,
      adminInfo: null,
      currentUser: { email: 'leo@example.com', name: 'Leo', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
    })!;
  }

  it('renders the Follow metric button only when the artifact has metrics', () => {
    const withMetrics = renderToolbar(followCtx(true));
    expect(withMetrics).toContain('Follow metric');
    // It lives in the title menu, which closes when it opens the modal.
    expect(withMetrics).toContain('onclick="soHdMenu(false);soOpenFollow()"');
    expect(withMetrics).toContain('id="so-hd-menu"');

    const without = renderToolbar(followCtx(false));
    expect(without).not.toContain('Follow metric');
    // Nothing to put in the menu: the title is plain text, no caret.
    expect(without).not.toContain('id="so-hd-menu"');
  });

  it('wires the Follow metric modal to the metric-alerts API', () => {
    const html = renderToolbar(followCtx(true));
    // Loads followable metric definitions and posts a personal Slack-DM alert rule.
    expect(html).toContain('/v1/metric-alerts/definitions?artifact_id=art_1');
    expect(html).toContain("fetch('https://shareout.site/v1/metric-alerts'");
    expect(html).toContain('Pick a metric first.');
    expect(html).toContain("targetType: 'dm'");
  });

  it('offers Telegram in the Notify-me / Schedule modal', () => {
    const html = renderToolbar(followCtx(true));
    expect(html).toContain('id="so-sched-dest"');
    expect(html).toContain('My Telegram');
    expect(html).toContain("action = 'telegram'");
  });

  it('offers email in the Schedule modal', () => {
    const html = renderToolbar(followCtx(true));
    expect(html).toContain("destCard('email'");
    expect(html).toContain("action = 'email'");
    expect(html).toContain('soSchedEmailConfig');
    expect(html).toContain('/brand/telegram-icon.png');
    expect(html).toContain('/brand/slack-icon.png');
  });

  it('offers Telegram as a Follow-metric delivery option', () => {
    const html = renderToolbar(followCtx(true));
    expect(html).toContain('id="so-follow-dest"');
    expect(html).toContain('My Telegram');
    expect(html).toContain("kind: 'telegram'");
  });

  it('lets a viewer see and cancel their own alerts from the toolbar', () => {
    const html = renderToolbar(followCtx(true));
    // Lists the viewer's own rules for this artifact and exposes a cancel (DELETE).
    expect(html).toContain('/v1/metric-alerts?artifact_id=art_1');
    expect(html).toContain('window.soFollowLoadMine');
    expect(html).toContain('window.soFollowCancel');
    expect(html).toContain("method: 'DELETE'");
  });

  it('renders the toolbar in Spanish (voseo) for a Spanish workspace, and only that copy', () => {
    const es = renderToolbar(buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: true,
      commentCount: 0,
      hasMetrics: true,
      adminInfo: { role: 'owner' } as never,
      currentUser: { email: 'o@example.com', name: 'Owner', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
      locale: 'es',
    })!);
    expect(es).toContain('Volver a ShareOut');
    expect(es).toContain('Abrir en ShareOut');
    expect(es).toContain('Programar');
    expect(es).toContain('Escribí un comentario…');
    expect(es).toContain('No pudimos cargar los comentarios');
    expect(es).toContain('Compartir');
    expect(es).not.toContain('Back to ShareOut');
    expect(es).not.toContain('Add a comment');
    expect(es).not.toContain("Couldn\\'t load comments");
    expect(es).not.toContain('Follow a metric');
  });

  it('opens the early head with the given language', () => {
    expect(renderEarlyHead('x', '', '', undefined, false, 'es')).toContain('<html lang="es">');
    expect(renderEarlyHead('x', '', '', undefined, false)).toContain('<html lang="en">');
  });

  it('the header sits above the page on every screen and pushes the frame down', () => {
    const html = renderToolbar(followCtx(false));
    expect(html).toContain('body > iframe { display: block; margin-top: var(--so-hd-h); height: calc(100% - var(--so-hd-h)); }');
    // Phones get the same header with icon-only buttons, not a hidden toolbar.
    expect(html).toContain('@media (max-width: 640px)');
    expect(html).toContain('.so-hd__label, .so-hd__meta');
    expect(html).not.toContain('so-hide-toolbar-mobile');
  });

  it('keeps owner tools in ShareOut: no Editor, Stats or Settings, one link to open it there', () => {
    const owner = renderToolbar(buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: false,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: { role: 'owner', canEdit: true } as never,
      currentUser: { email: 'o@example.com', name: 'Owner', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
    })!);
    expect(owner).toContain('href="https://shareout.site/home#a/demo"');
    expect(owner).toContain('Open in ShareOut');
    expect(owner).not.toContain('/a/demo/edit');
    expect(owner).not.toContain('openStats');
    expect(owner).not.toContain('openAdmin');
    expect(owner).not.toContain('so-admin-overlay');
    // Owners schedule deliveries to others; everyone else schedules it for themselves.
    expect(owner).toContain('soOpenSchedule(false)');
    const viewer = renderToolbar(followCtx(false));
    expect(viewer).toContain('soOpenSchedule(true)');
    expect(viewer).toContain('>Schedule<');
    expect(viewer).not.toContain('Open in ShareOut');
  });

  it('wires comments post toasts and connection state messaging in the viewer client script', () => {
    const html = renderToolbar(buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: true,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: null,
      currentUser: { email: 'leo@example.com', name: 'Leo', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
    })!);

    expect(html).toContain("cmtToast('Comment posted.', 'success')");
    expect(html).toContain("cmtToast(err.message === 'auth' ?");
    expect(html).toContain('Please log in to comment.');
    expect(html).toContain("post comment. Try again?', 'error')");
    expect(html).toContain("setConnState('reconnecting')");
    expect(html).toContain('id="so-cmt-conn"');
  });

  it('renders live presence UI and polling script on the toolbar chrome', () => {
    const html = renderToolbar(buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: false,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: null,
      currentUser: { email: 'leo@example.com', name: 'Leo', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      title: 'Demo page',
      attachedSkills: [],
    })!);

    expect(html).toContain('id="so-live-presence-btn"');
    expect(html).toContain("fetch('https://shareout.site/v1/artifacts/art_1/presence'");
    expect(html).toContain("safeCount + ' viewing now'");
    // Hidden until someone besides you is here.
    expect(html).toContain('livePresenceBtn.hidden = safeCount < 2;');
  });

  function guestCtx(commentsGuest: boolean, locale: 'en' | 'es' = 'en') {
    return buildToolbarContext({
      loggedIn: false, isFav: false, commentsEnabled: true, commentsIdentityMode: 'authenticated', commentsGuest,
      commentCount: 0, hasMetrics: false, adminInfo: null, currentUser: null, hideToolbar: false,
      baseUrl: 'https://shareout.site', slug: 'demo', artifactId: 'art_1', title: 'Demo page', attachedSkills: [], locale,
    })!;
  }

  it('offers "Comment as guest" (name, email, code) to a viewer with no account only when guests are on', () => {
    const on = renderToolbar(guestCtx(true));
    expect(on).toContain('data-guest="1"');
    expect(on).toContain('Comment as guest');
    expect(on).toContain('id="so-cmt-guest-email"');
    expect(on).toContain('id="so-cmt-guest-code"');
    expect(on).toContain("var gApi = cmtApi + '/_guest';");
    expect(on).not.toContain('Log in to comment');

    const off = renderToolbar(guestCtx(false));
    expect(off).toContain('Log in to comment');
    expect(off).not.toContain('so-cmt-guest-email');
    expect(off).not.toContain('/_guest');

    expect(renderToolbar(guestCtx(true, 'es'))).toContain('Comentá como invitado');
  });
});
