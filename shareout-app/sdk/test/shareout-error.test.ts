import { describe, expect, it } from 'vitest';
import { ShareOut } from '../src/index';
import { McpError } from '../src/stores/mcp-store';
import { ConsentRequiredError, ShareOutError } from '../src/shareout-error';

describe('ShareOutError', () => {
  it('sets name, message, code, and status', () => {
    const error = new ShareOutError('Not found', 'KEY_NOT_FOUND', 404);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ShareOutError');
    expect(error.message).toBe('Not found');
    expect(error.code).toBe('KEY_NOT_FOUND');
    expect(error.status).toBe(404);
  });

  it('carries requestId and reason', () => {
    const error = new ShareOutError('Unauthorized', 'UNAUTHORIZED', 401, undefined, undefined, undefined, undefined, 'req_1', 'expired');
    expect(error.requestId).toBe('req_1');
    expect(error.reason).toBe('expired');
  });

  it('is reachable as a static on the ShareOut class (script-tag build exposes only the class)', () => {
    expect(ShareOut.ShareOutError).toBe(ShareOutError);
    expect(ShareOut.ConsentRequiredError).toBe(ConsentRequiredError);
    expect(ShareOut.McpError).toBe(McpError);
  });
});
