// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderFolderCard } from '../../src/pages/home/render-cards';
import type { HomeFolder } from '../../src/pages/home/types';

const folder = (over: Partial<HomeFolder> = {}): HomeFolder => ({
  id: 'fld_1',
  name: 'Marketing',
  artifact_count: 3,
  ...over,
});

describe('renderFolderCard (Drive-style folder tile)', () => {
  it('renders name, pluralized count (English fallback + data-count), and an enterFolder drill-in', () => {
    const html = renderFolderCard(folder(), 'workspace', false);
    expect(html).toContain('wsx-folder-card');
    expect(html).toContain('data-scope="workspace"');
    expect(html).toContain('Marketing');
    expect(html).toContain('3 artifacts');
    expect(html).toContain('data-count="3"');
    expect(html).toContain("enterFolder('fld_1'");
  });

  it('singularizes a one-artifact folder', () => {
    expect(renderFolderCard(folder({ artifact_count: 1 }), 'personal', false)).toContain('1 artifact');
    expect(renderFolderCard(folder({ artifact_count: 1 }), 'personal', false)).not.toContain('1 artifacts');
  });

  it('shows rename/delete only when the user can manage folders', () => {
    const managed = renderFolderCard(folder(), 'workspace', true);
    expect(managed).toContain('renameFolder(');
    expect(managed).toContain('deleteFolder(');
    const readonly = renderFolderCard(folder(), 'workspace', false);
    expect(readonly).not.toContain('renameFolder(');
    expect(readonly).not.toContain('deleteFolder(');
  });

  it('escapes the folder name', () => {
    const html = renderFolderCard(folder({ name: '<b>x</b>' }), 'personal', false);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});
