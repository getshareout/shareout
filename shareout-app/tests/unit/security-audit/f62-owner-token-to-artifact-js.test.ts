import { describe, expect, it } from 'vitest';
import { e } from '../helpers/migrated-db';
import { buildInitialViewerData } from '../../../src/serve/sandbox-viewer/initial-data';
import { verifyOwner } from '../../../src/data/middleware';

const env = { ...e, SESSION_SECRET: 'f62-secret' } as any;
const admin = { isOwner: true, role: 'owner' as const, canEdit: true };

async function ownerCheck(tokenRole?: 'editor') {
  const d = await buildInitialViewerData({ id: 'usr_o', email: 'o@example.com' }, env, 'art_f62', 'https://x.test', null, null,
    admin, null, null, tokenRole);
  const token = d.payload.sessionToken as string;
  return verifyOwner(new Request('https://x.test/', { headers: { Authorization: `Bearer ${token}` } }),
    { artifact: { owner_id: 'usr_o' }, artifactId: 'art_f62', env } as any);
}

describe('f62 owner-role token in artifact JS', () => {
  it('blocks: owner token is downgraded when an editor authored the live version', async () => {
    expect(await ownerCheck('editor')).toBe(false);
  });
  it('legit: owner-published version still embeds an owner token', async () => {
    expect(await ownerCheck()).toBe(true);
  });
});
