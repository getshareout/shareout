import { describe, expect, it } from 'vitest';
import { e } from '../helpers/migrated-db';
import { buildInitialViewerData } from '../../../src/serve/sandbox-viewer/initial-data';
import { verifyOwner } from '../../../src/data/middleware';

const env = { ...e, SESSION_SECRET: 'f62-secret' } as any;

describe('f62 owner-role token in artifact JS', () => {
  it('CONFIRMED: token embedded for the owner is accepted by verifyOwner', async () => {
    const d = await buildInitialViewerData({ id: 'usr_o', email: 'o@example.com' }, env, 'art_f62', 'https://x.test', null, null,
      { isOwner: true, role: 'owner', canEdit: true }, null);
    const token = d.payload.sessionToken as string;
    const ok = await verifyOwner(new Request('https://x.test/', { headers: { Authorization: `Bearer ${token}` } }),
      { artifact: { owner_id: 'usr_o' }, artifactId: 'art_f62', env } as any);
    expect(ok).toBe(true);
  });
});
