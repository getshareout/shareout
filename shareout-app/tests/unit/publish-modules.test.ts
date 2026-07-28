import { describe, expect, it } from 'vitest';
import { determinePriority, buildEnhancedManifest } from '../../src/publish/manifest';
import { getCacheControl } from '../../src/publish/assets';
import { resolveVisibility, resolveAuthMethod } from '../../src/publish/request-auth';
import {
  assemblePublishResponse,
  MODERATION_PENDING_MESSAGE,
  MODERATION_BLOCKED_MESSAGE,
} from '../../src/publish/deployment';
import type { AssetMetadata } from '../../src/publish/types';
import type { Env, PublishRequest } from '../../src/types';

const env = { OPEN_VISIBILITY_DISABLED: 'false' } as Env;

describe('publish/manifest', () => {
  it('classifies root CSS as critical', () => {
    expect(determinePriority('styles.css', 'text/css', 100)).toBe('critical');
  });

  it('classifies nested CSS as normal', () => {
    expect(determinePriority('css/styles.css', 'text/css', 100)).toBe('normal');
  });

  it('classifies main JS as critical', () => {
    expect(determinePriority('main.js', 'application/javascript', 500)).toBe('critical');
  });

  it('classifies large images as lazy', () => {
    expect(determinePriority('hero.png', 'image/png', 200_000)).toBe('lazy');
  });

  it('builds manifest with SDK pins and critical lists', () => {
    const assets: AssetMetadata[] = [
      { path: 'styles.css', mime: 'text/css', size: 100, priority: 'critical', inlineable: true },
      { path: 'app.js', mime: 'application/javascript', size: 500, priority: 'critical', inlineable: false },
    ];
    const manifest = buildEnhancedManifest('index.html', assets);
    expect(manifest.version).toBe(2);
    expect(manifest.entrypoint).toBe('index.html');
    expect(manifest.critical.css).toEqual(['styles.css']);
    expect(manifest.critical.js).toEqual(['app.js']);
    expect(manifest.sdk?.major).toBeDefined();
    expect(manifest.capabilityContract).toBeDefined();
  });

  it('includes mobile entrypoint when provided', () => {
    const manifest = buildEnhancedManifest('index.html', [], 'mobile.html');
    expect(manifest.mobile).toEqual({ entrypoint: 'mobile.html' });
  });
});

describe('publish/assets', () => {
  it('sets immutable cache for images', () => {
    expect(getCacheControl('image/png')).toContain('immutable');
  });

  it('sets must-revalidate for HTML', () => {
    expect(getCacheControl('text/html')).toContain('must-revalidate');
  });
});

describe('publish/request-auth', () => {
  it('defaults to public visibility when no restrictions', () => {
    const body = { name: 'x', files: [] } as PublishRequest;
    expect(resolveVisibility(body, env, true)).toBe('public');
  });

  it('forces private when password is set', () => {
    const body = { name: 'x', files: [], password: 'secret' } as PublishRequest;
    expect(resolveVisibility(body, env, true)).toBe('private');
  });

  it('resolves auth method from body', () => {
    expect(resolveAuthMethod({ password: 'x' } as PublishRequest)).toBe('password');
    expect(resolveAuthMethod({ credentials: [{ user: 'a', password: 'b' }] } as PublishRequest)).toBe('credentials');
    expect(resolveAuthMethod({} as PublishRequest)).toBe('google');
  });
});

describe('publish/deployment assemblePublishResponse moderation', () => {
  const resEnv = { SHAREOUT_BASE_URL: 'https://shareout.site' } as Env;
  const base = {
    artifactId: 'art_1',
    artifactType: 'html' as const,
    versionId: 'ver_1',
    versionNo: 1,
    routingSlug: 'my-app',
    humanSlug: 'my-app',
    name: 'My App',
    hasMobile: false,
    workspaceUrls: {},
    blocking: false,
  };

  it('enriches a pending hold with reason, shared message, and requested_visibility', () => {
    const res = assemblePublishResponse(resEnv, {
      ...base,
      moderationStatus: 'pending',
      moderationReason: 'unknown domain x.com',
    });
    expect(res.moderation).toEqual({
      status: 'pending',
      reason: 'unknown domain x.com',
      message: MODERATION_PENDING_MESSAGE,
      requested_visibility: 'public',
      forced_private: true,
    });
  });

  it('omits reason when the classifier gave none', () => {
    const res = assemblePublishResponse(resEnv, {
      ...base,
      moderationStatus: 'pending',
      moderationReason: null,
    });
    expect(res.moderation).toEqual({
      status: 'pending',
      message: MODERATION_PENDING_MESSAGE,
      requested_visibility: 'public',
      forced_private: true,
    });
  });

  it('uses the blocked message for a blocked verdict', () => {
    const res = assemblePublishResponse(resEnv, { ...base, moderationStatus: 'blocked' });
    expect(res.moderation).toEqual({ status: 'blocked', message: MODERATION_BLOCKED_MESSAGE, forced_private: true });
  });

  it('stays silent when approved', () => {
    const res = assemblePublishResponse(resEnv, { ...base, moderationStatus: 'approved' });
    expect(res.moderation).toBeUndefined();
  });
});
