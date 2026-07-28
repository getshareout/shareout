// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildInstanceConfig } from '../../../src/superadmin/instance-config';
import type { Env } from '../../../src/types';

/** `schemaReady` probes `users`; `ok: false` makes it look like an unmigrated D1. */
function makeEnv(vars: Record<string, unknown> = {}, ok = true): Env {
  return {
    ...vars,
    DB: {
      prepare: () => ({
        first: async () => {
          if (!ok) throw new Error('D1_ERROR: no such table: users');
          return { n: 1 };
        },
        bind: () => ({ first: async () => ({ n: 1 }) }),
      }),
    },
  } as unknown as Env;
}

const CONFIGURED = {
  SHAREOUT_BASE_URL: 'https://acme.workers.dev',
  OPENAI_API_KEY: 'sk-test',
  CREDENTIALS_KEY: 'x'.repeat(64),
  EMAIL: {},
  EMAIL_DEFAULT_FROM: 'noreply@acme.test',
  INSTANCE_ADMIN_EMAILS: 'boss@acme.test',
};

describe('buildInstanceConfig', () => {
  it('reports a fully configured instance with no gaps', async () => {
    const cfg = await buildInstanceConfig(makeEnv(CONFIGURED));
    expect(cfg.origin).toBe('https://acme.workers.dev');
    expect(cfg.schema).toBe('ready');
    expect(cfg.ai).toEqual({ providers: ['openai'], byo_keys: true });
    expect(cfg.auth).toMatchObject({ password: true, google: false, email_otp_delivery: 'email' });
    expect(cfg.gaps).toEqual([]);
  });

  // The point of the endpoint: not "what is set" but "what is missing and what does
  // that cost me". A self-hoster used to learn AI was dead by using an AI feature.
  it('names each gap with the capability it disables and the fix', async () => {
    const cfg = await buildInstanceConfig(makeEnv({}));
    const settings = cfg.gaps.map((g) => g.setting);

    expect(settings).toContain('SHAREOUT_BASE_URL');
    expect(settings).toContain('VERCEL_AI_GATEWAY or OPENAI_API_KEY');
    expect(settings).toContain('CREDENTIALS_KEY');
    expect(settings).toContain('EMAIL binding');
    expect(settings).toContain('INSTANCE_ADMIN_EMAILS');

    const ai = cfg.gaps.find((g) => g.setting.includes('OPENAI_API_KEY'))!;
    expect(ai.disables).toContain('Crew AI');
    expect(ai.fix).toContain('wrangler secret put');

    // Every gap carries an actionable fix — a gap without one is just a complaint.
    expect(cfg.gaps.every((g) => g.fix.length > 0 && g.disables.length > 0)).toBe(true);
  });

  it('leads with the schema gap when D1 has no tables', async () => {
    const cfg = await buildInstanceConfig(makeEnv(CONFIGURED, false));
    expect(cfg.schema).toBe('missing');
    expect(cfg.gaps[0].setting).toBe('D1 schema');
    expect(cfg.gaps[0].fix).toContain('migrations apply');
  });

  it('says where one-time codes actually go', async () => {
    expect((await buildInstanceConfig(makeEnv({}))).auth.email_otp_delivery).toBe('worker_log');
    expect((await buildInstanceConfig(makeEnv({ EMAIL: {} }))).auth.email_otp_delivery).toBe('email');
  });

  it('orders AI providers as the failover chain does', async () => {
    const cfg = await buildInstanceConfig(makeEnv({ OPENAI_API_KEY: 'sk', VERCEL_AI_GATEWAY: 'vg' }));
    expect(cfg.ai.providers).toEqual(['vercel-gateway', 'openai']);
  });

  it('never leaks a secret, only whether it is present', async () => {
    const cfg = await buildInstanceConfig(makeEnv(CONFIGURED));
    const serialized = JSON.stringify(cfg);
    expect(serialized).not.toContain('sk-test');
    expect(serialized).not.toContain('x'.repeat(64));
    // Nor the admin addresses — presence is enough to answer "is this configured".
    expect(serialized).not.toContain('boss@acme.test');
    expect(cfg.admins.configured).toBe(true);
  });

  it('reports the caps and switches an operator can actually change', async () => {
    const cfg = await buildInstanceConfig(makeEnv({
      ...CONFIGURED,
      STORAGE_QUOTA_BYTES: '5000',
      DAILY_BANDWIDTH_BYTES_PER_OWNER: '900',
      OPEN_VISIBILITY_DISABLED: '1',
      ARTIFACT_BADGE: '1',
    }));
    expect(cfg.storage).toMatchObject({ quota_bytes: 5000, daily_bandwidth_bytes_per_owner: 900 });
    expect(cfg.sharing).toMatchObject({ open_visibility: false, artifact_badge: true });
  });
});
