import { describe, expect, it } from 'vitest';
import { ownerOf } from '../../src/artifacts/crud';

describe('artifact owner in GET /v1/artifacts/:id', () => {
  const row = { owner_name: 'Ana', owner_email: 'ana@acme.com' };

  it('workspace members (and the owner) see name + email', () => {
    expect(ownerOf(row, true)).toEqual({ name: 'Ana', email: 'ana@acme.com' });
  });

  it('viewers outside the workspace see the name only, never the email', () => {
    expect(ownerOf(row, false)).toEqual({ name: 'Ana', email: null });
    expect(ownerOf({ owner_name: null, owner_email: 'ana@acme.com' }, false)).toBeNull();
  });
});
