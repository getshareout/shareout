import { describe, it, expect } from 'vitest';
import { visibilityOptions } from '../src/workspace/details-panel';

describe('visibilityOptions (EDIT-08 Stage A)', () => {
  it('offers all four visibilities when open visibility is enabled', () => {
    expect(visibilityOptions(false).map((o) => o.value)).toEqual(['private', 'unlisted', 'workspace', 'public']);
  });

  it('offers only the closed visibilities when the launch flag disables open visibility', () => {
    // matches the server: open visibilities (public/unlisted) are coerced to private when disabled
    expect(visibilityOptions(true).map((o) => o.value)).toEqual(['private', 'workspace']);
  });

  it('uses human-readable labels', () => {
    const opts = visibilityOptions(false);
    expect(opts.find((o) => o.value === 'unlisted')?.label).toBe('Link Only');
    expect(opts.find((o) => o.value === 'private')?.label).toBe('Private');
  });
});
