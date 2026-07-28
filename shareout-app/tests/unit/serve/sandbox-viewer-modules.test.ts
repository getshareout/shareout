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
    expect(head).toContain('<body>');
    // Body stays open for the rest of the streamed body (iframe/toolbar/scripts).
    expect(head).not.toContain('</body>');
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
      visualEditorEnabled: true,
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
      visualEditorEnabled: true,
      attachedSkills: [],
    })).toBeNull();
  });

  it('buildToolbarContext builds avatar fallback when no picture', () => {
    const ctx = buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: false,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: null,
      currentUser: { email: 'leo@example.com', name: 'Leo Example', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      visualEditorEnabled: true,
      attachedSkills: [],
    });

    expect(ctx?.showToolbar).toBe(true);
    expect(ctx?.avatarInner).toContain('so-avatar-fallback');
    expect(ctx?.avatarInner).toContain('LE');
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
      visualEditorEnabled: true,
      attachedSkills: [],
    })!;
  }

  it('renders the Follow metric button only when the artifact has metrics', () => {
    const withMetrics = renderToolbar(followCtx(true));
    expect(withMetrics).toContain('Follow metric');
    expect(withMetrics).toContain('onclick="soOpenFollow()"');

    const without = renderToolbar(followCtx(false));
    expect(without).not.toContain('Follow metric');
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

  it('toolbar styles hide chrome on mobile unless opted in', () => {
    const html = renderToolbar(followCtx(false));
    expect(html).toContain('body.so-hide-toolbar-mobile #shareout-admin-toolbar');
  });

  it('greys out the Editor toolbar control when Live Studio is off', () => {
    const html = renderToolbar(buildToolbarContext({
      loggedIn: true,
      isFav: false,
      commentsEnabled: false,
      commentCount: 0,
      hasMetrics: false,
      adminInfo: { role: 'owner' } as never,
      currentUser: { email: 'o@example.com', name: 'Owner', picture: '' },
      hideToolbar: false,
      baseUrl: 'https://shareout.site',
      slug: 'demo',
      artifactId: 'art_1',
      visualEditorEnabled: false,
      attachedSkills: [],
    })!);
    expect(html).toContain('so-toolbar-btn is-disabled');
    expect(html).toContain('Live Studio is not enabled for this workspace');
    expect(html).not.toContain('href="https://shareout.site/a/demo/edit"');
  });
});
