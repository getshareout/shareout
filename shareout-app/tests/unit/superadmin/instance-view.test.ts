// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { instanceBody } from '../../../src/superadmin/views/bodies/instance';
import { VIEWS, resolveView } from '../../../src/superadmin/views/config';
import type { InstanceConfig } from '../../../src/superadmin/instance-config';

const base: InstanceConfig = {
  origin: 'https://acme.workers.dev',
  schema: 'ready',
  auth: { password: true, google: false, email_otp_delivery: 'worker_log' },
  ai: { providers: [], byo_keys: false },
  email: { binding: false, default_from: null, inbox_domain: null },
  storage: { quota_bytes: 0, max_file_bytes: 0, daily_bandwidth_bytes_per_owner: 0 },
  sharing: { open_visibility: false, signups_paused: false, artifact_badge: true, artifact_origin: null },
  bindings: {
    durable_objects: true,
    workers_ai: false,
    vectorize: false,
    browser: false,
    views_queue: false,
    rate_limit_kv: false,
  },
  admins: { configured: false, setup_admin_email: false },
  gaps: [],
};

const withGaps = (): InstanceConfig => ({
  ...base,
  gaps: [
    { setting: 'ANTHROPIC_API_KEY', disables: 'Every AI feature', fix: 'npx wrangler secret put ANTHROPIC_API_KEY' },
  ],
});

describe('instance view', () => {
  it('is reachable from the admin sidebar', () => {
    expect(VIEWS.some((v) => v.key === 'instance')).toBe(true);
    expect(resolveView(new URL('https://x/admin?view=instance')).key).toBe('instance');
  });

  // The point of the view: a gap is a thing to act on, so it names the setting, what
  // it costs, and the exact command.
  it('shows each gap with what it disables and how to fix it', () => {
    const html = instanceBody(withGaps());
    expect(html).toContain('ANTHROPIC_API_KEY');
    expect(html).toContain('Every AI feature');
    expect(html).toContain('npx wrangler secret put ANTHROPIC_API_KEY');
  });

  it('says so plainly when nothing is unset', () => {
    const html = instanceBody(base);
    expect(html).toContain('Nothing unset');
  });

  it('reports the instance origin and an inert AI chain', () => {
    const html = instanceBody(base);
    expect(html).toContain('https://acme.workers.dev');
    expect(html).toContain('every AI feature is inert');
  });

  it('names the configured AI providers in failover order', () => {
    const html = instanceBody({ ...base, ai: { providers: ['anthropic', 'openai'], byo_keys: true } });
    expect(html).toContain('anthropic');
    expect(html).toContain('openai');
    expect(html).not.toContain('every AI feature is inert');
  });

  // Both endpoints shipped in #47 with no caller; these are the controls that call them.
  it('offers the workspace and role controls the write API needs', () => {
    const html = instanceBody(base);
    for (const id of ['sa-ws-name', 'sa-ws-owner', 'sa-ws-create', 'sa-appoint-email', 'sa-appoint-role', 'sa-appoint-btn']) {
      expect(html).toContain(id);
    }
  });

  it('uses the shared input and button primitives, not invented classes', () => {
    const html = instanceBody(base);
    expect(html).toContain('so-c-input');
    expect(html).toContain('so-c-btn');
    expect(html).not.toContain('sa-input');
  });

  // buildInstanceConfig never returns secret values; the view must not invent a place
  // to print one either.
  it('renders presence, never a credential', () => {
    const html = instanceBody({
      ...base,
      ai: { providers: ['anthropic'], byo_keys: true },
      email: { binding: true, default_from: 'hello@acme.com', inbox_domain: 'inbox.acme.com' },
    });
    expect(html).not.toContain('sk-');
    expect(html).toContain('hello@acme.com');
  });
});
