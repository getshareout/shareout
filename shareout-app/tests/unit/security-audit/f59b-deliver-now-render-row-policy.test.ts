// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ran: 0 }));
vi.mock('../../../src/scheduling/jobs/runner', async (orig) => ({
  ...(await orig<typeof import('../../../src/scheduling/jobs/runner')>()),
  executeJobAction: async () => { h.ran++; return { success: true, steps: [] }; },
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { handleDeliverNow } from '../../../src/router/api/artifact-deliver';

const POLICY = JSON.stringify({ version: 1, field: 'region', default: 'deny', rules: [{ match: { email: 'v@f59b.test' }, values: ['EU'] }] });
const viewer = { id: 'usr_f59b_v', email: 'v@f59b.test', username: null };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f59b_ow', 'ow@f59b.test', 'o'), ('usr_f59b_v', 'v@f59b.test', 'v')"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES ('art_f59b_open', 'usr_f59b_ow', 'P', 'f59b-open', 'private')"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, access_policy) VALUES ('art_f59b_pol', 'usr_f59b_ow', 'P', 'f59b-pol', 'private', ?)").bind(POLICY),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('c_f59b_1', 'art_f59b_open', 'v@f59b.test', 'viewer'), ('c_f59b_2', 'art_f59b_pol', 'v@f59b.test', 'viewer')"),
  ]);
});

const deliver = (artifactId: string, config: Record<string, unknown>) =>
  handleDeliverNow(new Request('https://shareout.test/x', { method: 'POST', body: JSON.stringify({ action: 'email', config }) }), e, viewer as never, artifactId);
const mine = { recipients: ['v@f59b.test'], subject: 's', body: 'b' };

describe('f59b manual deliver-now path honours the row-policy render guard', () => {
  it('blocks: a scoped viewer cannot deliver a rendered PDF of a row-policy artifact', async () => {
    h.ran = 0;
    const res = await deliver('art_f59b_pol', { ...mine, renderPdf: true });
    expect(res.status).toBe(403);
    expect(h.ran).toBe(0);
  });

  it('still lets the viewer deliver a rendered PDF of an artifact without a row policy', async () => {
    h.ran = 0;
    const res = await deliver('art_f59b_open', { ...mine, renderPdf: true });
    expect(res.status).toBe(200);
    expect(h.ran).toBe(1);
  });
});
