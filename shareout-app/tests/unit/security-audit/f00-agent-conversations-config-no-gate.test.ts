import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_f00_public';
const THREAD = 'thr_f00_admin';

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f00';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_f00_owner', 'f00owner@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, ?)')
      .bind(ART, ART, `slug-${ART}`, 'usr_f00_owner', 'public'),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifact_agent_config (artifact_id, visitor_enabled, visitor_system_prompt) VALUES (?, 1, 'ORIGINAL SECRET PROMPT')").bind(ART),
    e.DB.prepare("INSERT INTO agent_threads (id, scope_type, scope_key, title) VALUES (?, 'artifact_admin', ?, 'owner chat')").bind(THREAD, ART),
  ]);
  await e.DB.prepare("INSERT INTO agent_messages (id, thread_id, role, content) VALUES ('msg_f00', ?, 'user', 'owner private note')").bind(THREAD).run();
});

const run = (path: string, init: RequestInit = {}) =>
  handleDataRequest(new Request(`https://so.test/v1/data/${ART}/agent/${path}`, init), e, `${ART}/agent/${path.split('?')[0]}`);

describe('f00 agent conversations and visitor config', () => {
  it('blocks: anonymous caller cannot list, read, delete conversations or rewrite config', async () => {
    for (const [path, init] of [
      ['conversations?mode=admin', {}],
      [`conversations/${THREAD}`, {}],
      ['config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor_system_prompt: 'X' }) }],
      [`conversations/${THREAD}`, { method: 'DELETE' }],
    ] as [string, RequestInit][]) {
      const res = await run(path, init);
      expect(res.status, path).toBe(403);
    }
    expect(await e.DB.prepare('SELECT id FROM agent_threads WHERE id = ?').bind(THREAD).first()).not.toBeNull();
    const cfg = await e.DB.prepare('SELECT visitor_system_prompt FROM artifact_agent_config WHERE artifact_id = ?').bind(ART).first<{ visitor_system_prompt: string }>();
    expect(cfg?.visitor_system_prompt).toBe('ORIGINAL SECRET PROMPT');
  });

  it('blocks: anonymous GET config does not leak the system prompt but still reports pilot_enabled', async () => {
    const res = await run('config');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('ORIGINAL SECRET PROMPT');
    expect(text).toContain('pilot_enabled');
  });

  it('the owner can still list, read, update config and delete', async () => {
    const cookie = { Cookie: `shareout_session=${await createSessionToken('usr_f00_owner', 'f00owner@x.test', e)}` };
    const list = await run('conversations?mode=admin', { headers: cookie });
    expect(list.status).toBe(200);
    expect(await list.text()).toContain(THREAD);
    expect((await run(`conversations/${THREAD}`, { headers: cookie })).status).toBe(200);
    const get = await run('config', { headers: cookie });
    expect(await get.text()).toContain('ORIGINAL SECRET PROMPT');
    const put = await run('config', { method: 'PUT', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor_system_prompt: 'NEW' }) });
    expect(put.status).toBe(200);
    expect((await run(`conversations/${THREAD}`, { method: 'DELETE', headers: cookie })).status).toBe(200);
  });
});
