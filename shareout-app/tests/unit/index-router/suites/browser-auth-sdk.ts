/**
 * Index router test suite: browser auth sdk.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function registerBrowserAuthSdkTests(handlers: HandlerMocks): void {
describe('index router — browser auth and skill/sdk', () => {
  it('dispatches legacy auth routes', async () => {
    expect((await fetchPath('/auth/google')).status).toBe(302);
    expect(await handlerTag(await fetchPath('/auth/dev'))).toBe('handleDevLogin');
    expect(await handlerTag(await fetchPath('/auth/logout'))).toBe('handleLogout');
    expect(await handlerTag(await fetchPath('/auth/password', { method: 'POST', body: '{}' }))).toBe('handlePasswordAuth');
    expect(await handlerTag(await fetchPath('/auth/credentials', { method: 'POST', body: '{}' }))).toBe('handleCredentialsAuth');
  });

  it('routes OAuth callback by state payload', async () => {
    expect(await handlerTag(await fetchPath(`/auth/callback?state=${sheetsState()}`))).toBe('handleSheetsOAuthCallback');
    expect(await handlerTag(await fetchPath(`/auth/callback?state=${githubState()}`))).toBe('handleGitHubOAuthCallback');
    expect(await handlerTag(await fetchPath('/auth/callback?code=abc'))).toBe('handleGoogleCallback');
    expect(await handlerTag(await fetchPath('/auth/callback?state=not-json'))).toBe('handleGoogleCallback');
  });

  it('dispatches skill and SDK asset routes', async () => {
    expect(await handlerTag(await fetchPath('/v1/skill'))).toBe('handleGetSkill');
    expect(await handlerTag(await fetchPath('/v1/skill', { method: 'HEAD' }))).toBe('handleGetSkill');
    expect(await handlerTag(await fetchPath('/v1/skill/version'))).toBe('handleGetSkillVersion');
    expect(await handlerTag(await fetchPath('/v1/skill/meta'))).toBe('handleGetSkillMeta');
    expect(await handlerTag(await fetchPath('/sdk/shareout.js'))).toBe('handleServeSDK');
    expect(await handlerTag(await fetchPath('/sdk/shareout-mobile.js'))).toBe('handleServeMobileSDK');
    expect(await handlerTag(await fetchPath('/sdk/shareout-charts.js'))).toBe('handleServeChartsSDK');
    expect(await handlerTag(await fetchPath('/sdk/editor.js'))).toBe('handleServeEditor');
    expect(await handlerTag(await fetchPath('/sdk/shareout.css'))).toBe('handleServeArtifactCSS');
    expect(await handlerTag(await fetchPath('/sdk/shareout-ui.js'))).toBe('handleServeArtifactUI');
  });

  it('dispatches versioned SDK paths and 404s unknown majors', async () => {
    expect(await handlerTag(await fetchPath('/sdk/v1/shareout.js'))).toBe('handleServeSDK');
    expect(await handlerTag(await fetchPath('/sdk/v1/shareout-charts.js'))).toBe('handleServeChartsSDK');
    expect(await handlerTag(await fetchPath('/sdk/v1/shareout.css'))).toBe('handleServeArtifactCSS');
    expect((await fetchPath('/sdk/v9/shareout.js')).status).toBe(404);
  });
});
}
