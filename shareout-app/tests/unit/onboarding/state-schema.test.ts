// @vitest-environment node
// Onboarding dismiss/skill-ack/celebrate against the real migrated schema: the
// personal checklist ('personal' sentinel) must persist, and a workspace the
// caller does not belong to is refused rather than a 500.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import {
  handleOnboardingDismissApi,
  handleOnboardingSkillAckApi,
  handleOnboardingCelebrateApi,
} from '../../../src/onboarding/api';
import { getPersonalOnboardingStatus } from '../../../src/onboarding/status';

const user = { id: 'usr_onb', email: 'onb@example.com' };
const WS = 'wsp_onb';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(user.id, user.email, 'Onb'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Onb', 'onb-ws', user.id),
    e.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(WS, user.id),
  ]);
});

const req = (qs = '') => new Request(`https://shareout.site/v1/home/onboarding/dismiss${qs}`, { method: 'POST', body: '{}' });

describe('onboarding state writes', () => {
  it('persists the personal checklist state', async () => {
    for (const handler of [handleOnboardingDismissApi, handleOnboardingSkillAckApi, handleOnboardingCelebrateApi]) {
      expect((await handler(req(), e, user)).status).toBe(200);
    }
    const status = await getPersonalOnboardingStatus(e, user.id);
    expect(status).toMatchObject({ dismissed: true, celebrated: true });
  });

  it('writes for a workspace the caller belongs to', async () => {
    expect((await handleOnboardingDismissApi(req(`?workspace=${WS}`), e, user)).status).toBe(200);
  });

  it('refuses a workspace the caller does not belong to', async () => {
    const res = await handleOnboardingDismissApi(req('?workspace=wsp_000000000000000000000000'), e, user);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FORBIDDEN' });
  });
});
