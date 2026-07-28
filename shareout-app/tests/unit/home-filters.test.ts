// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseHomeFilters, artifactTypeGroup } from '../../src/pages/home/filters';

describe('parseHomeFilters', () => {
  it('defaults to page 1 and all scope', () => {
    const f = parseHomeFilters(new URL('https://shareout.site/home'));
    expect(f).toEqual({
      page: 1,
      search: '',
      sort: 'recent',
      type: '',
      scope: 'all',
      workspace: '',
      folder: '',
      filesScope: 'team',
      folderKind: '',
    });
  });

  it('parses query params', () => {
    const f = parseHomeFilters(new URL('https://shareout.site/home?q=hello&page=3&sort=name&type=apps&scope=favorites&workspace=wsp_1'));
    expect(f.page).toBe(3);
    expect(f.search).toBe('hello');
    expect(f.sort).toBe('name');
    expect(f.type).toBe('apps');
    expect(f.scope).toBe('favorites');
    expect(f.workspace).toBe('wsp_1');
  });

  it('parses folder param', () => {
    const f = parseHomeFilters(new URL('https://shareout.site/home?folder=fld_reports'));
    expect(f.folder).toBe('fld_reports');
  });

  it('parses personal files scope and folder kind', () => {
    const f = parseHomeFilters(new URL('https://acme.shareout.site/home?files=personal&folderKind=personal&folder=fld_private'));
    expect(f.filesScope).toBe('personal');
    expect(f.folderKind).toBe('personal');
    expect(f.folder).toBe('fld_private');
  });

  it('clamps page to minimum 1', () => {
    expect(parseHomeFilters(new URL('https://shareout.site/home?page=0')).page).toBe(1);
    expect(parseHomeFilters(new URL('https://shareout.site/home?page=-5')).page).toBe(1);
  });
});

describe('artifactTypeGroup', () => {
  it('maps known types to groups', () => {
    expect(artifactTypeGroup('html')).toBe('apps');
    expect(artifactTypeGroup('csv')).toBe('data');
    expect(artifactTypeGroup('markdown')).toBe('docs');
    expect(artifactTypeGroup('image')).toBe('media');
  });

  it('returns other for unknown types', () => {
    expect(artifactTypeGroup('unknown')).toBe('other');
  });
});
