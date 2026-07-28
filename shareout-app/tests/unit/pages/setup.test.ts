import { describe, expect, it } from 'vitest';
import { getSetupStatus, needsSetup, renderSetupPage, schemaReady } from '../../../src/pages/setup';
import type { Env } from '../../../src/types';

function env(partial: Partial<Env> & { userCount?: number | 'error' } = {}): Env {
  const { userCount = 0, ...rest } = partial;
  return {
    SHAREOUT_BASE_URL: 'https://example.com',
    SESSION_SECRET: 'x'.repeat(32),
    DB: {
      prepare() {
        const chain = {
          bind: () => chain,
          first: async () => {
            if (userCount === 'error') throw new Error('no such table');
            return { n: userCount };
          },
        };
        return chain;
      },
    },
    ...rest,
  } as unknown as Env;
}

describe('needsSetup', () => {
  it('is true while the instance has no users', async () => {
    expect(await needsSetup(env({ userCount: 0 }))).toBe(true);
  });

  it('is false once a user exists', async () => {
    expect(await needsSetup(env({ userCount: 3, }))).toBe(false);
  });

  it('is true when self-host and users table is missing', async () => {
    expect(await needsSetup(env({ userCount: 'error', }))).toBe(true);
  });
});

describe('schemaReady', () => {
  it('is true when the users table answers', async () => {
    expect(await schemaReady(env({ userCount: 0 }))).toBe(true);
  });

  it('is false when the table does not exist', async () => {
    expect(await schemaReady(env({ userCount: 'error' }))).toBe(false);
  });
});

describe('renderSetupPage', () => {
  // The admin account is created here with a password. Sending the operator to
  // email OTP would block setup on standing up a mail provider first — and without
  // one the code only lands in the Worker log.
  it('offers a first-admin form once the session secret is set', async () => {
    const res = await renderSetupPage(env({ }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Set up ShareOut');
    expect(html).toContain('id="setup-form"');
    expect(html).toContain('/v1/auth/password/register');
    expect(html).toContain('Create admin account');
  });

  it('pre-fills and locks the email when SETUP_ADMIN_EMAIL pins it', async () => {
    const html = await (await renderSetupPage(env({ SETUP_ADMIN_EMAIL: 'boss@example.com' }))).text();
    expect(html).toContain('value="boss@example.com" readonly');
  });

  // The Deploy button provisions D1 but never applies migrations, so this is what a
  // button-deployed instance shows on first open.
  it('blocks the form and names the migration when the schema is missing', async () => {
    const html = await (await renderSetupPage(env({ userCount: 'error' }))).text();
    expect(html).toContain('wrangler d1 migrations apply DB --remote');
    expect(html).toContain('Apply the database schema first');
    expect(html).not.toContain('id="setup-form"');
  });

  it('blocks the CTA and shows wrangler command when SESSION_SECRET is missing', async () => {
    const res = await renderSetupPage(env({ SESSION_SECRET: '', }));
    const html = await res.text();
    expect(html).toContain('wrangler secret put SESSION_SECRET');
    expect(html).toContain('Set SESSION_SECRET first');
    expect(html).not.toContain('id="setup-form"');
  });

  it('exposes optional Google secret commands', async () => {
    const html = await (await renderSetupPage(env({ }))).text();
    expect(html).toContain('GOOGLE_CLIENT_ID');
    expect(getSetupStatus(env({ })).google).toBe(false);
  });

  // Unset, the instance serves agent-facing URLs that point at the hosted
  // instance — anything an agent publishes lands on someone else's server.
  it('warns when SHAREOUT_BASE_URL is unset', async () => {
    const html = await (await renderSetupPage(env({ SHAREOUT_BASE_URL: '' }))).text();
    expect(getSetupStatus(env({ SHAREOUT_BASE_URL: '' })).hasBaseUrl).toBe(false);
    expect(html).toContain('SHAREOUT_BASE_URL');
    expect(html).toContain('would land there, not on this Worker');
  });

  it('reports the configured instance URL without a warning', async () => {
    const html = await (await renderSetupPage(env({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' }))).text();
    expect(getSetupStatus(env({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' })).hasBaseUrl).toBe(true);
    expect(html).toContain('https://acme.workers.dev');
    expect(html).not.toContain('would land there, not on this Worker');
  });
});
