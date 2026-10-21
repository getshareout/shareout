// @vitest-environment happy-dom
//
// Right-click quick actions on artifact cards (grid) and rows (table): same actions and
// role gates as the card hover buttons.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_home_views_cardMenu_JS as MENU } from '../../../src/pages/home/render-workspace/client-script/home-views/card-menu';
import { renderArtifactRow } from '../../../src/pages/home/render-cards';
import type { ArtifactRow } from '../../../src/pages/home/types';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const t = (k: string) => HOME_COPY.en[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));

const art = (o: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id: 'art_1', name: 'Revenue', slug: 'revenue', display_slug: 'revenue', description: null,
  artifact_type: 'html', visibility: 'workspace', workspace_id: 'wsp_1',
  created_at: '2026-07-11T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  user_role: 'owner', owner_name: 'Leo', owner_picture: null,
  total_views: 0, unique_visitors: 0, is_favorite: 0,
  f_blobs: 0, f_datasets: 0, f_connections: 0, f_platform: 0, f_jobs: 0, f_agent: 0, f_tests: 0, f_skills: 0,
  tags: null, folder_id: null, is_example: 0, moderation_status: 'approved', moderation_held_visibility: null,
  ...o,
});

let calls: string[][] = [];
const rec = (name: string) => (...a: unknown[]) => { calls.push([name, ...a.map((x) => JSON.stringify(x))]); };
const scope: Record<string, unknown> = {
  t, esc, artEls: (id: string) => document.querySelectorAll(`[data-id="${id}"]`),
  openArtifact: rec('openArtifact'), copyLink: rec('copyLink'), toggleFavorite: rec('toggleFavorite'),
  toggleVisibility: rec('toggleVisibility'), openFolderPicker: rec('openFolderPicker'), confirmDelete: rec('confirmDelete'),
};
// Listeners live on document: load the fragment once, swap the page per test.
new Function(...Object.keys(scope), MENU)(...Object.values(scope));
function boot(html: string) { document.body.innerHTML = html; calls = []; }
const rightClick = (el: Element) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
const labels = () => [...document.querySelectorAll('.wsx-cmenu [data-cm] span')].map((s) => s.textContent);
const pick = (label: string) => ([...document.querySelectorAll('.wsx-cmenu [data-cm]')].find((b) => b.textContent === label) as HTMLButtonElement).click();

beforeEach(() => { document.body.innerHTML = ''; });

describe('artifact context menu', () => {
  it('opens on a table row with the owner actions', () => {
    boot(`<div class="wsx-tbl">${renderArtifactRow(art(), 'shareout.site')}</div>`);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('.wsx-tr')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(labels()).toEqual(['Open', 'Open in new tab', 'Edit', 'Share…', 'Copy link', 'Add to favorites', 'Make private', 'Move to folder', 'Export', 'Delete']);
  });

  it('gives a viewer only the safe actions', () => {
    boot(renderArtifactRow(art({ user_role: 'viewer' }), 'shareout.site'));
    rightClick(document.querySelector('.wsx-tr')!);
    expect(labels()).toEqual(['Open', 'Open in new tab', 'Copy link', 'Add to favorites']);
  });

  it('works on a grid card and runs the picked action, then closes', () => {
    boot('<article class="artifact-card" data-id="art_9" data-slug="deck" data-type="html" data-role="owner" data-favorite="1" data-visibility="private" data-workspace="wsp_1" data-url="https://x/deck/"><a class="card-title">Deck</a></article>');
    rightClick(document.querySelector('.card-title')!);
    expect(labels()).toContain('Remove from favorites');
    expect(labels()).toContain('Share with workspace');
    pick('Delete');
    expect(calls).toEqual([['confirmDelete', '"art_9"']]);
    expect(document.querySelector('.wsx-cmenu')).toBeNull();
  });

  it('Open passes slug, name, id and type so the tab opens the right editor', () => {
    boot(renderArtifactRow(art({ artifact_type: 'csv' }), 'shareout.site'));
    rightClick(document.querySelector('.wsx-tr')!);
    pick('Open');
    expect(calls[0]).toEqual(['openArtifact', '"revenue"', '"Revenue"', '"art_1"', '"csv"']);
  });

  it('leaves folder rows and the rest of the page to the browser menu', () => {
    boot('<div class="wsx-tr wsx-tr--folder" data-folder-id="f1"></div><p id="x">text</p>');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('x')!.dispatchEvent(ev);
    document.querySelector('.wsx-tr--folder')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector('.wsx-cmenu')).toBeNull();
  });
});
