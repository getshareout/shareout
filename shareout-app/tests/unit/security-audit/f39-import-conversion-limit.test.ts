import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const convertOfficeImport = vi.hoisted(() => vi.fn());

vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId: async () => null }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole: async () => 'member' }));
vi.mock('../../../src/publish/publish-artifact', () => ({ publishArtifact: async () => ({ artifact: { id: 'a' }, deployment: { slug: 's' } }) }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota: async () => ({ allowed: true }) }));
vi.mock('../../../src/pages/home/import-office', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  convertOfficeImport,
}));

import { handleHomeImportApi } from '../../../src/pages/home/import';
import { ImportError } from '../../../src/pages/home/import-office';

const user = { id: 'usr_f39', email: 'f39@x.test' };
const post = () => handleHomeImportApi(
  new Request('https://shareout.site/v1/home/import', {
    method: 'POST',
    body: JSON.stringify({ name: 'a.docx', content: btoa('not a docx'), encoding: 'base64' }),
  }),
  {} as Env,
  user,
);

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  convertOfficeImport.mockReset().mockRejectedValue(new ImportError('CONVERT_FAILED', 'bad'));
});

describe('f39 import conversion is behind the publish limit', () => {
  it('blocks: a capped user is refused before any conversion runs', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Math.floor(Date.now() / 1000) + 60 });
    expect((await post()).status).toBe(429);
    expect(convertOfficeImport).not.toHaveBeenCalled();
  });

  it('blocks: a failed conversion still counts against the limit', async () => {
    expect((await post()).status).toBe(422);
    expect(incrementRateLimit).toHaveBeenCalledOnce();
  });
});
