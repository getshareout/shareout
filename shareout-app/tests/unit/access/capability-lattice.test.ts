// @vitest-environment node
/**
 * Pure capability lattice — critical for external sharing and access control.
 * A linear rank would wrongly let "comment" imply "edit"; keep the set model honest.
 */
import { describe, expect, it } from 'vitest';
import { capabilitySatisfies, type Capability } from '../../../src/access/can-access';

const ALL: Capability[] = ['view', 'comment', 'create', 'edit', 'manage', 'api'];

describe('capabilitySatisfies', () => {
  it('view only satisfies view', () => {
    expect(capabilitySatisfies('view', 'view')).toBe(true);
    for (const c of ALL.filter((x) => x !== 'view')) {
      expect(capabilitySatisfies('view', c)).toBe(false);
    }
  });

  it('comment implies view but not edit/create/manage', () => {
    expect(capabilitySatisfies('comment', 'view')).toBe(true);
    expect(capabilitySatisfies('comment', 'comment')).toBe(true);
    expect(capabilitySatisfies('comment', 'edit')).toBe(false);
    expect(capabilitySatisfies('comment', 'create')).toBe(false);
    expect(capabilitySatisfies('comment', 'manage')).toBe(false);
  });

  it('edit implies create, comment, and view', () => {
    expect(capabilitySatisfies('edit', 'edit')).toBe(true);
    expect(capabilitySatisfies('edit', 'create')).toBe(true);
    expect(capabilitySatisfies('edit', 'comment')).toBe(true);
    expect(capabilitySatisfies('edit', 'view')).toBe(true);
    expect(capabilitySatisfies('edit', 'manage')).toBe(false);
  });

  it('manage is the full read/write lattice (not api)', () => {
    expect(capabilitySatisfies('manage', 'manage')).toBe(true);
    expect(capabilitySatisfies('manage', 'edit')).toBe(true);
    expect(capabilitySatisfies('manage', 'view')).toBe(true);
    expect(capabilitySatisfies('manage', 'api')).toBe(false);
  });

  it('api is orthogonal — implies only itself', () => {
    expect(capabilitySatisfies('api', 'api')).toBe(true);
    expect(capabilitySatisfies('api', 'view')).toBe(false);
    expect(capabilitySatisfies('view', 'api')).toBe(false);
  });
});
