// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildArtifactShareUrl } from '../../src/pages/home/utils';
import { getEditorBaseUrl } from '../../src/editor/page/config';
import { corsHeaders, setRequestOrigin } from '../../src/data/middleware';
import { DATA_ERRORS } from '../../src/types';
import type { Env } from '../../src/types';

const SELF = { SHAREOUT_BASE_URL: 'https://acme.com' } as unknown as Env;

describe('share URL on an artifact card', () => {
  // renderArtifactCard passed no platform host, so the default put every self-hosted
  // instance's share links on shareout.site — the copy-link button handed out a URL
  // pointing at another company.
  it('uses the serving instance on the apex', () => {
    expect(buildArtifactShareUrl('acme.com', 'q3', null, undefined, undefined, SELF))
      .toBe('https://acme.com/a/q3/');
  });

  it('uses the workspace subdomain of the serving instance', () => {
    expect(buildArtifactShareUrl('team.acme.com', 'q3', null, undefined, undefined, SELF))
      .toBe('https://team.acme.com/q3/');
  });

  it('does not treat another instance domain as its own subdomain', () => {
    expect(buildArtifactShareUrl('acme.shareout.site', 'q3', null, undefined, undefined, SELF))
      .toBe('https://acme.com/a/q3/');
  });

  it('still works on the hosted product', () => {
    const hosted = { SHAREOUT_BASE_URL: 'https://shareout.site' } as unknown as Env;
    expect(buildArtifactShareUrl('acme.shareout.site', 'q3', null, undefined, undefined, hosted))
      .toBe('https://acme.shareout.site/q3/');
  });
});

describe('editor base URL', () => {
  // window.EDITOR_CONFIG.baseUrl drives `fetch(baseUrl + '/v1/data/...', {credentials:
  // 'include'})` in the editor client. Hardcoded, a self-hosted editor asked another
  // company's server for its data, with credentials attached.
  it('is whatever the caller passes, so it can be this instance', () => {
    expect(getEditorBaseUrl('https://acme.com')).toBe('https://acme.com');
  });
});

describe('CORS headers with no Origin', () => {
  it('claims no origin rather than a hardcoded one', () => {
    setRequestOrigin(null);
    const h = corsHeaders() as Record<string, string>;
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain('shareout.site');
  });

  it('still reflects a real origin', () => {
    setRequestOrigin('https://acme.com');
    expect((corsHeaders() as Record<string, string>)['Access-Control-Allow-Origin'])
      .toBe('https://acme.com');
  });

  it('still allows the opaque origin sandboxed artifacts send', () => {
    setRequestOrigin('null');
    expect((corsHeaders() as Record<string, string>)['Access-Control-Allow-Origin']).toBe('null');
  });
});

describe('API error copy', () => {
  it('does not send API clients to another instance to authenticate', () => {
    expect(DATA_ERRORS.UNAUTHORIZED.suggestion).not.toContain('shareout.site');
  });
});
