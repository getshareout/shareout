import { describe, expect, it } from 'vitest';
import { ShareOutError } from '../src/shareout-error';

describe('ShareOutError', () => {
  it('sets name, message, code, and status', () => {
    const error = new ShareOutError('Not found', 'KEY_NOT_FOUND', 404);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ShareOutError');
    expect(error.message).toBe('Not found');
    expect(error.code).toBe('KEY_NOT_FOUND');
    expect(error.status).toBe(404);
  });
});
