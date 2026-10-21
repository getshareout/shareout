// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
import { handleAbuseReport } from '../../../src/moderation/abuse-reports';

const report = (artifactId: string, ip: string, category: string) =>
  handleAbuseReport(new Request(`https://shareout.example.com/report/${artifactId}`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body: new URLSearchParams({ category }),
  }), Object.assign(e, { RATE_LIMIT_KV: kv }), artifactId);

const modStatus = async (id: string) =>
  (await e.DB.prepare('SELECT status FROM artifact_moderation WHERE artifact_id = ?').bind(id).first<{ status: string }>())?.status ?? 'approved';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f48','f48@example.test','o')"),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES ('art_f48_old','a','slug-f48-old','usr_f48','public'), ('art_f48_new','b','slug-f48-new','usr_f48','public')"),
  ]);
  const old = new Date(Date.now() - 90 * 86400_000).toISOString();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO abuse_reports (id, artifact_id, reporter_ip, category, status, created_at) VALUES ('rep_f48_1','art_f48_old','198.51.100.1','spam','open',?), ('rep_f48_2','art_f48_old','198.51.100.2','spam','open',?)").bind(old, old),
  ]);
});

describe('f48 abuse report auto-block', () => {
  it('blocks: reports older than the window do not add up to an auto-block', async () => {
    await report('art_f48_old', '203.0.113.9', 'spam');
    expect(await modStatus('art_f48_old')).toBe('approved');
  });

  it('three recent distinct-IP reports still auto-block, and a csam report still blocks at once', async () => {
    for (const ip of ['203.0.113.1', '198.51.100.2', '192.0.2.3']) await report('art_f48_new', ip, 'spam');
    expect(await modStatus('art_f48_new')).toBe('blocked');
    await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES ('art_f48_csam','c','slug-f48-csam','usr_f48','public')").run();
    await report('art_f48_csam', '203.0.113.4', 'csam');
    expect(await modStatus('art_f48_csam')).toBe('blocked');
  });
});
