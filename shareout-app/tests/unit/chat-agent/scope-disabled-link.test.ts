// A disabled account in an identity group lends no workspace role to the accounts
// linked to it, against the real schema.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { internalAgentRole, resolveAgentScope } from '../../../src/chat-agent/scope';
import { isMemberSql } from '../../../src/search/scope-sql';

const WS = 'wsp_dl_a';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, identity_id, disabled) VALUES
      ('usr_dl_on', 'on@example.com', 'on', 'idn_dl', 0),
      ('usr_dl_off', 'off@example.com', 'off', 'idn_dl', 1),
      ('usr_dl_mate', 'mate@example.com', 'mate', 'idn_dl2', 0),
      ('usr_dl_mate2', 'mate2@example.com', 'mate2', 'idn_dl2', 0)`),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'A', 'dl-a', 'usr_dl_off')").bind(WS),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_dl_1', ?, 'usr_dl_off', 'owner', 'internal'), ('wm_dl_2', ?, 'usr_dl_mate2', 'admin', 'internal')`).bind(WS, WS),
  ]);
});

describe('linked accounts and workspace roles', () => {
  it('a disabled linked account lends no role', async () => {
    expect(await internalAgentRole(e, 'usr_dl_on', WS)).toBeNull();
    expect(await resolveAgentScope(e, 'usr_dl_on', WS)).toBeNull();
    const m = isMemberSql('usr_dl_on', WS);
    expect(await e.DB.prepare(`SELECT ${m.sql} AS ok`).bind(...m.binds).first<{ ok: number }>()).toEqual({ ok: 0 });
  });

  it('an enabled linked account still lends its role', async () => {
    expect(await internalAgentRole(e, 'usr_dl_mate', WS)).toBe('admin');
    const m = isMemberSql('usr_dl_mate', WS);
    expect(await e.DB.prepare(`SELECT ${m.sql} AS ok`).bind(...m.binds).first<{ ok: number }>()).toEqual({ ok: 1 });
  });
});
