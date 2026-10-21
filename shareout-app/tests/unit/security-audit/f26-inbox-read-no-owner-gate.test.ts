import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_f26_public';

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f26';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_f26_owner', 'f26owner@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, ?)')
      .bind(ART, ART, `slug-${ART}`, 'usr_f26_owner', 'public'),
  ]);
});

const run = (path: string, headers: Record<string, string> = {}) =>
  handleDataRequest(new Request(`https://so.test/v1/data/${ART}/inbox/${path}`, { headers }), e, `${ART}/inbox/${path}`);

describe('f26 inbox reads', () => {
  it('blocks: anonymous visitor of a public artifact cannot read the inbox', async () => {
    for (const p of ['status', 'messages', 'messages/inb_x', 'messages/inb_x/attachments/0']) {
      expect([401, 403]).toContain((await run(p)).status);
    }
  });

  it('the owner can still read the inbox', async () => {
    const token = await createSessionToken('usr_f26_owner', 'f26owner@x.test', e);
    const res = await run('messages', { Cookie: `shareout_session=${token}` });
    expect(res.status).toBe(200);
  });
});
