// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { createJob, updateJob } from '../../../src/scheduling/jobs/crud';
import { executeJobAction } from '../../../src/scheduling/jobs/runner';
import { checkViewerSelfDelivery } from '../../../src/scheduling/jobs/permissions';

const POLICY = JSON.stringify({ version: 1, field: 'region', default: 'deny', rules: [{ match: { email: 'v@example.test' }, values: ['EU'] }] });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f58_ow', 'ow@example.test', 'o'), ('usr_f58_v', 'v@example.test', 'v'), ('usr_f58_ed', 'ed@example.test', 'e')"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES ('art_f58', 'usr_f58_ow', 'P', 'f58', 'private')"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, access_policy) VALUES ('art_f59', 'usr_f58_ow', 'P', 'f59', 'private', ?)").bind(POLICY),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('c1', 'art_f58', 'v@example.test', 'viewer'), ('c2', 'art_f58', 'ed@example.test', 'editor'), ('c3', 'art_f59', 'v@example.test', 'viewer')"),
  ]);
});

const mine = { recipients: ['v@example.test'], subject: 's', body: 'b' };

describe('f58 PATCH skips create-time validation', () => {
  it('blocks: a viewer cannot repoint their self-delivery job at other recipients', async () => {
    const made = await createJob(e, 'usr_f58_v', { artifact_id: 'art_f58', action: 'email', schedule: '0 9 * * *', config: mine } as never);
    expect(made.error).toBeUndefined();
    const id = made.job!.id;
    const bad = await updateJob(e, 'usr_f58_v', id, { config: { ...mine, recipients: ['victim@example.test', 'v@example.test'] } as never });
    expect(bad.error).toMatch(/Viewers can only/);
    const ok = await updateJob(e, 'usr_f58_v', id, { config: { ...mine, subject: 'new' } as never });
    expect(ok.error).toBeUndefined();
  });

  it('blocks: an invalid destination config is rejected on update', async () => {
    const made = await createJob(e, 'usr_f58_ed', { artifact_id: 'art_f58', action: 'email', schedule: '0 9 * * *', config: { recipients: ['x@example.test'], subject: 's', body: 'b' } } as never);
    expect(made.error).toBeUndefined();
    const bad = await updateJob(e, 'usr_f58_ed', made.job!.id, { config: { recipients: [] } as never });
    expect(bad.error).toBeTruthy();
  });
});

describe('f59 owner-scope render for scoped viewers', () => {
  const render = { ...mine, renderPdf: true };
  it('blocks: viewer self-delivery with a render option is refused on a row-policy artifact', async () => {
    expect(await checkViewerSelfDelivery(e, 'usr_f58_v', 'email', render as never, 'art_f59')).toMatch(/limits rows per viewer/);
    expect(await checkViewerSelfDelivery(e, 'usr_f58_v', 'telegram', { mode: 'snapshot' } as never, 'art_f59')).toMatch(/limits rows per viewer/);
    expect(await checkViewerSelfDelivery(e, 'usr_f58_v', 'email', mine as never, 'art_f59')).toBeNull();
    expect(await checkViewerSelfDelivery(e, 'usr_f58_v', 'email', render as never, 'art_f58')).toBeNull();
    const made = await createJob(e, 'usr_f58_v', { artifact_id: 'art_f59', action: 'email', schedule: '0 9 * * *', config: render } as never);
    expect(made.error).toMatch(/limits rows per viewer/);
  });

  it('blocks: an already-stored viewer render job does not run on a row-policy artifact', async () => {
    const res = await executeJobAction(e, 'email', 'art_f59', 'usr_f58_v', render as never, 'cron');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/limits rows per viewer/);
  });
});
