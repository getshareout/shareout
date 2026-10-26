// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderArtifactCard } from '../../../src/pages/home/render-cards';
import { renderCreatePage } from '../../../src/pages/create';
import type { ArtifactRow } from '../../../src/pages/home/types';

function row(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: 'art1', name: 'My Page', slug: 'my-page', display_slug: 'my-page', description: null,
    artifact_type: 'html', visibility: 'private', workspace_id: 'wsp_1',
    created_at: '2026-07-11T00:00:00Z', updated_at: '2026-07-11T00:00:00Z',
    user_role: 'owner', owner_name: 'Leo', owner_picture: null,
    total_views: 0, unique_visitors: 0, is_favorite: 0,
    f_blobs: 0, f_datasets: 0, f_connections: 0, f_platform: 0, f_jobs: 0, f_agent: 0, f_tests: 0, f_skills: 0,
    tags: null, folder_id: null, is_example: 0,
    moderation_status: 'approved', moderation_held_visibility: null,
    ...overrides,
  };
}

describe('card visibility badge shows what is stored', () => {
  it('labels a public artifact Public, never Private', () => {
    const html = renderArtifactCard(row({ visibility: 'public' }), 'shareout.site');
    expect(html).toContain('badge-public');
    expect(html).toContain('data-i18n="inspector.visName.public"');
    expect(html).not.toContain('badge-private');
    expect(html).toContain("toggleVisibility('art1','private')");
  });

  it('folds legacy unlisted into Public', () => {
    expect(renderArtifactCard(row({ visibility: 'unlisted' }), 'shareout.site')).toContain('badge-public');
  });

  it('keeps Private and Workspace as before', () => {
    const priv = renderArtifactCard(row({ visibility: 'private' }), 'shareout.site');
    expect(priv).toContain('badge-private');
    expect(priv).toContain("toggleVisibility('art1','workspace')");
    expect(renderArtifactCard(row({ visibility: 'workspace' }), 'shareout.site')).toContain('badge-workspace');
  });
});

describe('/create visibility chooser', () => {
  const html = (openAllowed?: boolean) =>
    renderCreatePage('a page', { id: 'usr_1', email: 'a@b.test' }, undefined, 'x.dev', openAllowed).text();

  it('offers "Anyone with the link" when public links can take effect', async () => {
    const out = await html(true);
    expect(out).toContain('openAllowed: true');
  });

  it('defaults to allowed so existing callers are unchanged', async () => {
    expect(await html()).toContain('openAllowed: true');
  });

  it('disables it and says why when public links are off', async () => {
    const out = await html(false);
    expect(out).toContain('openAllowed: false');
    expect(out).toContain("(S.openAllowed ? '' : ' disabled title=\"Public links are turned off here.\"')");
  });

  it('only calls a private result "turned off" when it was downgraded', async () => {
    const out = await html(true);
    expect(out).toContain("d.visibility_downgraded ? 'Published privately.");
    expect(out).not.toContain("d.visibility === 'private' ? 'Published privately.");
  });
});
