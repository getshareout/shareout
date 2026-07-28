// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildResultLabel, fmtCount, buildArtifactShareUrl } from '../../src/pages/home/utils';

describe('buildResultLabel', () => {
  const base = { page: 1, search: '', sort: 'recent', type: '', scope: 'all', workspace: '' };

  it('formats search results', () => {
    expect(buildResultLabel({ ...base, search: 'foo' }, 2)).toBe('2 results for “foo”');
    expect(buildResultLabel({ ...base, search: 'foo' }, 1)).toBe('1 result for “foo”');
  });

  it('formats scope and type labels', () => {
    expect(buildResultLabel({ ...base, scope: 'shared' }, 5)).toBe('5 shared with you');
    expect(buildResultLabel({ ...base, scope: 'favorites' }, 1)).toBe('1 favorite');
    expect(buildResultLabel({ ...base, type: 'apps' }, 3)).toBe('3 apps');
  });

  it('defaults to artifact count', () => {
    expect(buildResultLabel(base, 10)).toBe('10 artifacts');
    expect(buildResultLabel(base, 1)).toBe('1 artifact');
  });
});

describe('fmtCount', () => {
  it('formats large numbers compactly', () => {
    expect(fmtCount(999)).toBe('999');
    expect(fmtCount(1500)).toBe('1.5k');
    expect(fmtCount(2000000)).toBe('2M');
  });
});

describe('buildArtifactShareUrl', () => {
  it('uses workspace subdomain shorthand on team hosts', () => {
    expect(buildArtifactShareUrl('acme.shareout.site', 'route-slug', 'my-report'))
      .toBe('https://acme.shareout.site/my-report/');
  });

  it('uses apex /a/ URL on shareout.site', () => {
    expect(buildArtifactShareUrl('shareout.site', 'route-slug', 'my-report'))
      .toBe('https://shareout.site/a/route-slug/');
  });
});
