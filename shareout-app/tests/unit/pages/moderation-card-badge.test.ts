import { describe, expect, it } from 'vitest';
import { renderArtifactCard } from '../../../src/pages/home/render-cards';
import { artifactCardSelect } from '../../../src/pages/home/queries/artifact-card';
import type { ArtifactRow } from '../../../src/pages/home/types';

function row(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: 'art1', name: 'My Page', slug: 'my-page', display_slug: 'my-page', description: null,
    artifact_type: 'html', visibility: 'private', workspace_id: null,
    created_at: '2026-07-11T00:00:00Z', updated_at: '2026-07-11T00:00:00Z',
    user_role: 'owner', owner_name: 'Leo', owner_picture: null,
    total_views: 0, unique_visitors: 0, is_favorite: 0,
    f_blobs: 0, f_datasets: 0, f_connections: 0, f_platform: 0, f_jobs: 0, f_agent: 0, f_tests: 0, f_skills: 0,
    tags: null, folder_id: null, is_example: 0,
    moderation_status: 'approved', moderation_held_visibility: null,
    ...overrides,
  };
}

describe('moderation card chip', () => {
  it('shows an amber "Under review" chip on a held-from-public page', () => {
    const html = renderArtifactCard(row({ moderation_status: 'pending', moderation_held_visibility: 'public' }), 'shareout.site');
    expect(html).toContain('badge-review');
    expect(html).toContain('Under review');
    expect(html).not.toContain('badge-blocked');
  });

  it('shows a red "Blocked" chip on a blocked page', () => {
    const html = renderArtifactCard(row({ moderation_status: 'blocked' }), 'shareout.site');
    expect(html).toContain('badge-blocked');
    expect(html).toContain('Blocked');
  });

  it('shows no moderation chip on an approved page', () => {
    const html = renderArtifactCard(row(), 'shareout.site');
    expect(html).not.toContain('badge-review');
    expect(html).not.toContain('badge-blocked');
  });

  it('shows no review chip on a plain pending page that was never held public', () => {
    const html = renderArtifactCard(row({ moderation_status: 'pending', moderation_held_visibility: null }), 'shareout.site');
    expect(html).not.toContain('badge-review');
  });
});

describe('artifact card query projection', () => {
  it('selects the moderation columns the chip needs', () => {
    const sql = artifactCardSelect('?');
    // Moderation lives in artifact_moderation now; a missing row reads as approved.
    expect(sql).toContain("COALESCE(mod_a.status, 'approved') AS moderation_status");
    expect(sql).toContain('mod_a.held_visibility AS moderation_held_visibility');
  });
});
