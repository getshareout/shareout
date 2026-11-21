import { describe, expect, it } from 'vitest';
import { renderArtifactMini } from '../../../src/pages/home/render-cards';
import { handleHomeBrowserApi } from '../../../src/pages/home/api';
import type { ArtifactRow } from '../../../src/pages/home/types';
import type { Env } from '../../../src/types';

function row(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: 'art1', name: 'Daily sales', slug: 'daily-sales', display_slug: 'daily-sales', description: null,
    artifact_type: 'html', visibility: 'workspace', workspace_id: 'wsp_1',
    created_at: '2026-07-11T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    user_role: 'owner', owner_name: 'Leo', owner_picture: null,
    total_views: 12, unique_visitors: 5, is_favorite: 0,
    f_blobs: 0, f_datasets: 0, f_connections: 0, f_platform: 0, f_jobs: 0, f_agent: 0, f_tests: 0, f_skills: 0,
    tags: null, folder_id: null, is_example: 0,
    moderation_status: 'approved', moderation_held_visibility: null,
    my_collab_role: null, shared_raw: null, shared_count: 0,
    ...overrides,
  } as ArtifactRow;
}

describe('Home small tile', () => {
  it('links to the artifact with what the tab opener needs, and a cache-busted preview', () => {
    const html = renderArtifactMini(row());
    expect(html).toContain('href="/a/daily-sales/"');
    expect(html).toContain('data-id="art1"');
    expect(html).toContain('data-name="Daily sales"');
    expect(html).toContain('src="/t/art1_card.webp?v=2026-08-01T00%3A00%3A00Z"');
  });

  it('says You for the owner (localized) and the owner name otherwise', () => {
    expect(renderArtifactMini(row())).toContain('<span data-i18n="cards.you">You</span>');
    const theirs = renderArtifactMini(row({ user_role: 'viewer', owner_name: 'Ana Ruiz' }));
    expect(theirs).toContain('<span>Ana Ruiz</span>');
    expect(theirs).not.toContain('cards.you');
  });

  it('carries when it was last viewed, else when it was updated', () => {
    expect(renderArtifactMini(row(), '2026-11-20 09:15:00')).toContain('data-ts="2026-11-20 09:15:00"');
    expect(renderArtifactMini(row())).toContain('data-ts="2026-08-01T00:00:00Z"');
  });

  it('escapes the name everywhere it appears', () => {
    const html = renderArtifactMini(row({ name: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('GET /v1/home/browser?mini=1', () => {
  const user = { id: 'usr_1', email: 'owner@example.com' };
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => (sql.includes('COUNT(DISTINCT a.id) as total') ? { total: 0 } : null),
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    },
  } as unknown as Env;
  const get = async (q: string) => (await (await handleHomeBrowserApi(new Request(`https://shareout.site/v1/home/browser${q}`, { headers: { host: 'shareout.site' } }), env, user)).json()) as Record<string, unknown>;

  it('adds the small tiles only when Home asks for them', async () => {
    expect(await get('?scope=favorites&mini=1')).toHaveProperty('miniHtml', '');
    expect(await get('?scope=favorites')).not.toHaveProperty('miniHtml');
  });
});
