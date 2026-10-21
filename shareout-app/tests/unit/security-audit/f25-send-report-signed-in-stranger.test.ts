// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEmail } from '../../../src/data/email/handler';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

vi.mock('../../../src/scheduling/jobs/artifact-email', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getArtifactEmail: vi.fn().mockResolvedValue('report@artifacts.shareout.site'),
}));
vi.mock('../../../src/scheduling/email', () => ({
  sendArtifactEmail: vi.fn(),
  checkEmailRateLimit: vi.fn(),
  incrementEmailCount: vi.fn(),
}));

import { sendArtifactEmail, checkEmailRateLimit } from '../../../src/scheduling/email';

const ART = 'art_f25';

function ctxFor(over: { visibility: string; allowAnonEmail: number; viewer: { email: string | null; isOwner: boolean }; isOwner?: boolean }): DataContext {
  const env = {
    SESSION_SECRET: 's',
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
    EMAIL: { send: vi.fn() },
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ owner_id: 'usr_owner', email: 'owner@example.com' }) }) }) },
  } as unknown as Env;
  return {
    artifactId: ART,
    artifact: { id: ART, name: 'Report', visibility: over.visibility, auth_method: null, allow_anon_email: over.allowAnonEmail },
    env,
    origin: 'https://app.example.com',
    viewer: over.viewer,
    isOwner: over.isOwner ?? over.viewer.isOwner,
  } as unknown as DataContext;
}

const send = (ctx: DataContext) =>
  handleEmail(
    new Request(`https://example.com/v1/data/${ART}/email/send-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ to: 'victim@example.com', subject: 's', html: '<b>x</b>' }),
    }),
    ctx,
    '/send-report',
  );

beforeEach(() => {
  vi.mocked(sendArtifactEmail).mockReset().mockResolvedValue({ success: true, messageId: 'm' });
  vi.mocked(checkEmailRateLimit).mockResolvedValue({ allowed: true, resetAt: 1_700_000_000 });
});

describe('f25 send-report recipient gate', () => {
  it('blocks: a signed-in stranger on a public artifact cannot mail arbitrary recipients', async () => {
    const res = await send(ctxFor({ visibility: 'public', allowAnonEmail: 0, viewer: { email: 'stranger@example.com', isOwner: false } }));
    expect(res.status).toBe(403);
    expect(sendArtifactEmail).not.toHaveBeenCalled();
  });

  it('still sends for the owner/editor on a public artifact', async () => {
    const res = await send(ctxFor({ visibility: 'public', allowAnonEmail: 0, viewer: { email: 'o@example.com', isOwner: true } }));
    expect(res.status).toBe(200);
  });

  it('still sends for an authorized viewer of a private artifact', async () => {
    const res = await send(ctxFor({ visibility: 'private', allowAnonEmail: 0, viewer: { email: 'member@example.com', isOwner: false } }));
    expect(res.status).toBe(200);
  });

  it('still sends on a public artifact when the owner opted into open email', async () => {
    const res = await send(ctxFor({ visibility: 'public', allowAnonEmail: 1, viewer: { email: 'stranger@example.com', isOwner: false } }));
    expect(res.status).toBe(200);
  });
});
