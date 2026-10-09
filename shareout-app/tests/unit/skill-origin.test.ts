// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rewriteSkillOrigin, skillOriginRewriter } from '../../src/skill-origin';
import type { Env } from '../../src/types';

const env = (vars: Record<string, string> = {}) => vars as unknown as Env;

describe('skillOriginRewriter', () => {
  it('leaves founder-host literals alone on the founder host', () => {
    const rw = skillOriginRewriter(env({ SHAREOUT_BASE_URL: 'https://shareout.site' }))!;
    expect(rw('POST https://shareout.site/v1/publish')).toBe('POST https://shareout.site/v1/publish');
  });

  it('still fills $ORIGIN placeholders on the founder host', () => {
    expect(skillOriginRewriter(env())!('GET $ORIGIN/v1/skill')).toBe('GET https://shareout.site/v1/skill');
  });

  it('rewrites once SHAREOUT_BASE_URL names a different instance', () => {
    expect(skillOriginRewriter(env({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' }))).not.toBeNull();
  });
});

describe('$ORIGIN placeholders', () => {
  const self = env({ SHAREOUT_BASE_URL: 'https://shareout.acme.com' });

  it('bakes the instance origin and host in so agents never have to ask', () => {
    expect(rewriteSkillOrigin('curl "$ORIGIN/v1/publish"', self)).toBe('curl "https://shareout.acme.com/v1/publish"');
    expect(rewriteSkillOrigin('host: $ORIGIN_HOST', self)).toBe('host: shareout.acme.com');
  });

  it('leaves other $ORIGIN_* names alone', () => {
    expect(rewriteSkillOrigin('$ORIGIN_FOO', self)).toBe('$ORIGIN_FOO');
  });
});

describe('rewriteSkillOrigin', () => {
  const self = env({ SHAREOUT_BASE_URL: 'https://shareout.acme.com' });

  it('redirects absolute API URLs at the instance', () => {
    expect(rewriteSkillOrigin('POST https://shareout.site/v1/publish', self)).toBe(
      'POST https://shareout.acme.com/v1/publish'
    );
  });

  it('rewrites bare hostname mentions, including subdomain examples', () => {
    expect(rewriteSkillOrigin('Sign in at shareout.site', self)).toBe('Sign in at shareout.acme.com');
    expect(rewriteSkillOrigin('acme.shareout.site', self)).toBe('acme.shareout.acme.com');
    expect(rewriteSkillOrigin('inbox.shareout.site', self)).toBe('inbox.shareout.acme.com');
  });

  it('points the sandbox host at ARTIFACT_ORIGIN when one is configured', () => {
    const withCdn = env({
      SHAREOUT_BASE_URL: 'https://shareout.acme.com',
      ARTIFACT_ORIGIN: 'https://sandbox.acme.com',
    });
    expect(rewriteSkillOrigin('{hex}.shareoutcdn.site', withCdn)).toBe('{hex}.sandbox.acme.com');
  });

  it('falls the sandbox host back to the app host for same-zone self-hosting', () => {
    expect(rewriteSkillOrigin('{hex}.shareoutcdn.site', self)).toBe('{hex}.shareout.acme.com');
  });

  // A sequential replace chain would rewrite its own output here: the founder origin
  // becomes https://myshareout.site, and the following bare-host pass would match the
  // `shareout.site` inside it again, yielding https://mymyshareout.site.
  it('does not re-match its own output when the new host contains the old one', () => {
    const nested = env({ SHAREOUT_BASE_URL: 'https://myshareout.site' });
    expect(rewriteSkillOrigin('https://shareout.site/v1/publish', nested)).toBe(
      'https://myshareout.site/v1/publish'
    );
    expect(rewriteSkillOrigin('shareout.site', nested)).toBe('myshareout.site');
  });

  it('leaves unrelated text alone', () => {
    const text = 'See https://docs.example.com and shareoutlet.site';
    expect(rewriteSkillOrigin(text, self)).toBe(text);
  });

  it('returns the input unchanged on the founder host', () => {
    const text = 'POST https://shareout.site/v1/publish';
    expect(rewriteSkillOrigin(text, env({ SHAREOUT_BASE_URL: 'https://shareout.site' }))).toBe(text);
  });
});
