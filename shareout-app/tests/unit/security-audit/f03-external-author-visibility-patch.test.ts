// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const EXT_TOKEN = 'so_f03_external_token';
const MEM_TOKEN = 'so_f03_member_token';
const WS = 'wsp_f03';

const patch = (id: string, token: string, body: unknown) =>
  handleFetch(new Request(`${BASE}/v1/artifacts/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

const visibilityOf = async (id: string) =>
  (await e.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?').bind(id).first<{ visibility: string }>())?.visibility;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f03_x', 'f03x@example.test', 'x'), ('usr_f03_m', 'f03m@example.test', 'm')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f03-w', 'usr_f03_m')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f03_x', ?, 'usr_f03_x', 'member', 'external'), ('wm_f03_m', ?, 'usr_f03_m', 'owner', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f03_x', 'user', 'usr_f03_x', 'usr_f03_x', ?, 'x'), ('tok_f03_m', 'user', 'usr_f03_m', 'usr_f03_m', ?, 'm')")
      .bind(await hashToken(EXT_TOKEN), await hashToken(MEM_TOKEN)),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_f03_x', 'x', 'f03-x', 'usr_f03_x', ?, 'private'), ('art_f03_m', 'm', 'f03-m', 'usr_f03_m', ?, 'private'), ('art_f03_x2', 'x2', 'f03-x2', 'usr_f03_x', ?, 'private')").bind(WS, WS, WS),
  ]);
});

describe('f03 external author PATCH visibility', () => {
  it('blocks: an external author cannot widen their artifact to workspace or public', async () => {
    for (const visibility of ['workspace', 'public']) {
      const res = await patch('art_f03_x', EXT_TOKEN, { visibility });
      expect(res.status, visibility).toBe(403);
    }
    expect(await visibilityOf('art_f03_x')).toBe('private');
  });

  it('external author can still PATCH other fields and re-assert private; internal owner can widen', async () => {
    expect((await patch('art_f03_x2', EXT_TOKEN, { name: 'renamed', visibility: 'private' })).status).toBe(200);
    expect((await patch('art_f03_m', MEM_TOKEN, { visibility: 'workspace' })).status).toBe(200);
    expect(await visibilityOf('art_f03_m')).toBe('workspace');
  });
});
