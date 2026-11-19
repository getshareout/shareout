// The shared Telegram/WhatsApp bot against the real schema: a chat only ever works in a
// workspace the linked person is an INTERNAL member of and whose admin turned the app on;
// link codes never cross apps; a disabled account's link stops resolving.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import {
  consumeBotLinkCode,
  getBotLinkedUserId,
  linkBotSession,
  mintBotLinkCode,
} from '../../../src/chat-platforms/bot/links';
import { eligibleBotWorkspaces, resolveBotWorkspace } from '../../../src/chat-platforms/bot/workspace';
import type { Env } from '../../../src/types';

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, disabled) VALUES
      ('usr_bi_ana', 'ana@example.com', 'ana', 0), ('usr_bi_off', 'off@example.com', 'off', 1), ('usr_bi_out', 'out@example.com', 'out', 0)`),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id, feature_flags) VALUES
      ('wsp_bi_on', 'On', 'bi-on', 'usr_bi_ana', '{"ai.whatsapp_bot":true}'),
      ('wsp_bi_off', 'Off', 'bi-off', 'usr_bi_ana', NULL),
      ('wsp_bi_ext', 'Ext', 'bi-ext', 'usr_bi_out', '{"ai.whatsapp_bot":true}'),
      ('wsp_bi_none', 'None', 'bi-none', 'usr_bi_out', '{"ai.whatsapp_bot":true}')`),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_bi_1', 'wsp_bi_on', 'usr_bi_ana', 'member', 'internal'),
      ('wm_bi_2', 'wsp_bi_off', 'usr_bi_ana', 'owner', 'internal'),
      ('wm_bi_3', 'wsp_bi_ext', 'usr_bi_ana', 'member', 'external'),
      ('wm_bi_4', 'wsp_bi_ext', 'usr_bi_out', 'owner', 'internal'),
      ('wm_bi_5', 'wsp_bi_none', 'usr_bi_out', 'owner', 'internal')`),
  ]);
});

describe('shared bot isolation', () => {
  it('offers only internal workspaces with the app turned on', async () => {
    const { eligible, all } = await eligibleBotWorkspaces(e, 'whatsapp', 'usr_bi_ana');
    expect(eligible.map((w) => w.id)).toEqual(['wsp_bi_on']);
    // An external (sharee) membership never counts, even where WhatsApp is on.
    expect(all.map((w) => w.id).sort()).toEqual(['wsp_bi_off', 'wsp_bi_on']);
  });

  it('never keeps a stored workspace the person may not chat in', async () => {
    const persist = vi.fn(async () => {});
    const state = await resolveBotWorkspace(e, 'whatsapp', 'usr_bi_ana', 'wsp_bi_none', persist);
    expect(state).toMatchObject({ kind: 'ready', workspace: { id: 'wsp_bi_on' } });
    expect(persist).toHaveBeenCalledWith('wsp_bi_on');
  });

  it('tells a member whose workspaces all have WhatsApp off that it is off', async () => {
    await e.DB.prepare(`UPDATE workspaces SET feature_flags = NULL WHERE id = 'wsp_bi_on'`).run();
    const env = { ...e, SLUGS: undefined } as Env; // skip the flag cache: read the row just written
    const state = await resolveBotWorkspace(env, 'whatsapp', 'usr_bi_ana', 'wsp_bi_on', async () => {});
    expect(state).toEqual({ kind: 'none', member: true });
    await e.DB.prepare(`UPDATE workspaces SET feature_flags = '{"ai.whatsapp_bot":true}' WHERE id = 'wsp_bi_on'`).run();
  });

  it('resolves a WhatsApp link to its account, not a disabled one', async () => {
    await linkBotSession(e, 'whatsapp', 'AR.bi1', 'usr_bi_ana', '5491100000001');
    await linkBotSession(e, 'whatsapp', 'AR.bi2', 'usr_bi_off', null);
    expect(await getBotLinkedUserId(e, 'whatsapp', 'AR.bi1')).toBe('usr_bi_ana');
    expect(await getBotLinkedUserId(e, 'whatsapp', 'AR.bi2')).toBeNull();
    // The same key on another app is another chat.
    expect(await getBotLinkedUserId(e, 'telegram', 'AR.bi1')).toBeNull();
  });

  it('never lets a code minted for one app link a chat on the other', async () => {
    const env = { ...e, RATE_LIMIT_KV: fakeKv() } as Env;
    const tg = await mintBotLinkCode(env, 'telegram', 'usr_bi_ana');
    expect(await consumeBotLinkCode(env, 'whatsapp', tg!)).toBeNull();
    expect(await consumeBotLinkCode(env, 'telegram', tg!)).toBe('usr_bi_ana');
    expect(await consumeBotLinkCode(env, 'telegram', tg!)).toBeNull(); // one use
  });
});
