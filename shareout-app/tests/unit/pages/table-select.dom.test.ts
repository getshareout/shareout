// @vitest-environment happy-dom
//
// Table view gets the grid's multi-select + favorite: row checkbox, Shift-range,
// Cmd/Ctrl-toggle, click-while-selecting, and the inline star.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_home_views_cardActions_JS as ACTIONS } from '../../../src/pages/home/render-workspace/client-script/home-views/card-actions';
import { renderArtifactRow } from '../../../src/pages/home/render-cards';
import type { ArtifactRow } from '../../../src/pages/home/types';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const t = (k: string) => HOME_COPY.en[k] ?? k;
const esc = (s: unknown) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));
const art = (id: string, o: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id, name: id, slug: id, display_slug: id, description: null, artifact_type: 'html', visibility: 'workspace', workspace_id: 'wsp_1',
  created_at: '2026-07-11T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', user_role: 'owner', owner_name: 'Leo', owner_picture: null,
  total_views: 0, unique_visitors: 0, is_favorite: 0,
  f_blobs: 0, f_datasets: 0, f_connections: 0, f_platform: 0, f_jobs: 0, f_agent: 0, f_tests: 0, f_skills: 0,
  tags: null, folder_id: null, is_example: 0, moderation_status: 'approved', moderation_held_visibility: null, ...o,
});

const requests: string[] = [];
const toasts: string[] = [];
const scope: Record<string, unknown> = {
  t, esc, showToast: (m: string) => toasts.push(m),
  optimistic: (o: { apply?: () => void; request: () => unknown }) => { o.apply?.(); requests.push('req'); return Promise.resolve(); },
  fetch: () => Promise.resolve(new Response('{}')),
};
const win = globalThis as unknown as Record<string, (...a: unknown[]) => void>;
new Function(...Object.keys(scope), ACTIONS)(...Object.values(scope));

const ids = ['a1', 'a2', 'a3', 'a4'];
function boot(favs: string[] = []) {
  document.getElementById('cmdbarClear')?.click();
  let root = document.getElementById('root');
  if (!root) { root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root); }
  root.innerHTML = '<div class="wsx-tbl">' + ids.map((id) => renderArtifactRow(art(id, { is_favorite: favs.includes(id) ? 1 : 0 }), 'shareout.site')).join('') + '</div>';
  // happy-dom has no layout: make every row count as on-screen.
  document.querySelectorAll('.wsx-tr').forEach((r) => Object.defineProperty(r, 'offsetParent', { get: () => document.body }));
  requests.length = 0; toasts.length = 0;
}
const row = (id: string) => document.querySelector(`.wsx-tr[data-id="${id}"]`) as HTMLElement;
const selected = () => ids.filter((id) => row(id).classList.contains('is-selected'));
const click = (el: Element, o: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...o }));
// happy-dom doesn't run inline onclick attributes: invoke what the row buttons call.
const sel = (id: string, o: { shiftKey?: boolean } = {}) => { expect(row(id).querySelector('.wsx-tr__sel')!.getAttribute('onclick')).toContain(`toggleSelect('${id}',event)`); win.toggleSelect(id, o); };

beforeEach(() => boot());

describe('table multi-select', () => {
  it('row checkbox selects, and Shift+click selects the range', () => {
    sel('a1');
    sel('a3', { shiftKey: true });
    expect(selected()).toEqual(['a1', 'a2', 'a3']);
    expect(document.body.classList.contains('selecting')).toBe(true);
  });

  it('Cmd/Ctrl+click toggles a row without opening it', () => {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    row('a2').querySelector('.wsx-tr__nm')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(selected()).toEqual(['a2']);
  });

  it('while selecting, a plain click adds or removes instead of opening', () => {
    sel('a1');
    click(row('a4').querySelector('.wsx-tr__nm')!);
    click(row('a1').querySelector('.wsx-tr__nm')!);
    expect(selected()).toEqual(['a4']);
  });

  it('bulk favorite reads row state and skips ones already starred', () => {
    boot(['a2']);
    sel('a1');
    sel('a2');
    (document.getElementById('cmdbarFav') as HTMLButtonElement).click();
    expect(requests).toHaveLength(1);
    expect(row('a1').getAttribute('data-favorite')).toBe('1');
    expect(selected()).toEqual([]);
  });
});

describe('table favorite star', () => {
  it('the inline star favorites the row and lights up', () => {
    const star = row('a3').querySelector('.wsx-tr__star') as HTMLButtonElement;
    expect(star.classList.contains('is-on')).toBe(false);
    expect(star.getAttribute('onclick')).toContain("toggleFavorite('a3')");
    win.toggleFavorite('a3');
    expect(requests).toHaveLength(1);
    expect(star.classList.contains('is-on')).toBe(true);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(selected()).toEqual([]);
  });

  it('visibility toggles update the row Access cell', () => {
    win.toggleVisibility('a1', 'private');
    expect(row('a1').getAttribute('data-visibility')).toBe('private');
    expect(row('a1').querySelector('.wsx-tr__vis')!.classList.contains('is-ws')).toBe(false);
  });
});
