import { describe, expect, it } from 'vitest';
import { renderArtifactRow } from '../../../src/pages/home/render-cards';
import type { ArtifactRow } from '../../../src/pages/home/types';

function row(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: 'art1', name: 'My Page', slug: 'my-page', display_slug: 'my-page', description: null,
    artifact_type: 'html', visibility: 'workspace', workspace_id: 'wsp_1',
    created_at: '2026-07-11T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    user_role: 'owner', owner_name: 'Leo', owner_picture: null,
    total_views: 12, unique_visitors: 5, is_favorite: 0,
    f_blobs: 0, f_datasets: 1, f_connections: 0, f_platform: 0, f_jobs: 1, f_agent: 0, f_tests: 0, f_skills: 0,
    tags: 'safety\nhse\nreports', folder_id: null, is_example: 0,
    moderation_status: 'approved', moderation_held_visibility: null,
    my_collab_role: null,
    shared_raw: 'Ana Ruiz\x1fhttps://img/ana.png\x1ebob@x.com\x1f',
    shared_count: 6,
    ...overrides,
  };
}

const cell = (html: string, col: string) => {
  const m = html.match(new RegExp(`<span class="wsx-tr__${col}">([\\s\\S]*?)</span>\\n`));
  return m ? m[1] : '';
};

describe('artifact table row', () => {
  it('renders every column the header declares, in order', () => {
    const html = renderArtifactRow(row(), 'shareout.site');
    const cols = [...html.matchAll(/\n {4}<span class="wsx-tr__([a-z]+)"/g)].map((m) => m[1]);
    expect(cols).toEqual(['icon', 'name', 'owner', 'shared', 'access', 'type', 'feat', 'tags', 'views', 'visitors', 'created', 'date']);
  });

  it('shows who it is shared with to the owner, with a +N overflow', () => {
    const html = renderArtifactRow(row(), 'shareout.site');
    expect(html).toContain('title="Ana Ruiz, bob@x.com +4"');
    expect(html).toContain('<span class="wsx-tr__more">+4</span>');
  });

  it('shows it to a collaborator too', () => {
    const html = renderArtifactRow(row({ user_role: 'viewer', my_collab_role: 'viewer' }), 'shareout.site');
    expect(html).toContain('Ana Ruiz');
  });

  it('hides it from a workspace member who is not a collaborator (same rule as the collaborators API)', () => {
    const html = renderArtifactRow(row({ user_role: 'viewer', my_collab_role: null }), 'shareout.site');
    expect(html).not.toContain('Ana Ruiz');
    expect(html).not.toContain('bob@x.com');
    expect(cell(html, 'shared')).toContain('wsx-tr__none');
  });

  it('caps tags at two with a +N, and shows capability icons', () => {
    const html = renderArtifactRow(row(), 'shareout.site');
    expect((html.match(/class="wsx-tr__tag"/g) || []).length).toBe(2);
    expect(html).toContain('title="reports">+1</span>');
    expect((cell(html, 'feat').match(/class="feature"/g) || []).length).toBe(2);
  });
});
