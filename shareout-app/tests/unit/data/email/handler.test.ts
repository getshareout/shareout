// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEmail } from '../../../../src/data/email/handler';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';

const ARTIFACT_ID = 'art_email';
const ORIGIN = 'https://app.example.com';

vi.mock('../../../../src/scheduling/jobs', () => ({
  getArtifactEmail: vi.fn(),
}));

vi.mock('../../../../src/scheduling/email', () => ({
  sendArtifactEmail: vi.fn(),
  checkEmailRateLimit: vi.fn(),
  incrementEmailCount: vi.fn(),
}));

import { getArtifactEmail } from '../../../../src/scheduling/jobs';
import {
  sendArtifactEmail,
  checkEmailRateLimit,
  incrementEmailCount,
} from '../../../../src/scheduling/email';

const mockGetArtifactEmail = vi.mocked(getArtifactEmail);
const mockSendArtifactEmail = vi.mocked(sendArtifactEmail);
const mockCheckEmailRateLimit = vi.mocked(checkEmailRateLimit);
const mockIncrementEmailCount = vi.mocked(incrementEmailCount);

function createEmailDb(owner?: { ownerId: string; email: string | null } | null) {
  let ownerRow: { owner_id: string; email: string | null } | null;
  if (owner === null) {
    ownerRow = null;
  } else if (owner === undefined) {
    ownerRow = { owner_id: 'usr_owner', email: 'owner@example.com' };
  } else {
    ownerRow = { owner_id: owner.ownerId, email: owner.email };
  }

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('SELECT a.owner_id, u.email FROM artifacts')) {
            return ownerRow;
          }
          return null;
        }),
      })),
    })),
  };
}

function makeCtx(options: {
  emailBinding?: boolean;
  owner?: { ownerId: string; email: string | null } | null;
  allowAnonEmail?: number;
} = {}): DataContext {
  const env: Env = {
    SESSION_SECRET: 'session-secret',
    DB: createEmailDb(options.owner) as unknown as Env['DB'],
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
  } as Env;

  if (options.emailBinding !== false) {
    env.EMAIL = { send: vi.fn() } as Env['EMAIL'];
  }

  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Email Artifact',
      visibility: 'public',
      auth_method: null,
      // Contact-form scenario: owner opted into anonymous email (Workstream A).
      allow_anon_email: options.allowAnonEmail ?? 1,
    },
    env,
    origin: ORIGIN,
  } as DataContext;
}

function emailRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Anonymous email gate uses the unspoofable cf-connecting-ip (fail closed if
  // absent); production CF always sets it, so simulate it here.
  if (!headers.has('cf-connecting-ip')) {
    headers.set('cf-connecting-ip', '203.0.113.7');
  }
  return new Request(`https://example.com/v1/data/${ARTIFACT_ID}/email${path}`, {
    ...init,
    headers,
  });
}

beforeEach(() => {
  mockGetArtifactEmail.mockResolvedValue('report@artifacts.shareout.site');
  mockCheckEmailRateLimit.mockResolvedValue({ allowed: true, resetAt: 1_700_000_000 });
  mockSendArtifactEmail.mockResolvedValue({ success: true, messageId: 'msg_123' });
  mockIncrementEmailCount.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleEmail routing', () => {
  it('returns NOT_FOUND for unknown paths and wrong methods', async () => {
    const ctx = makeCtx();

    const unknown = await handleEmail(emailRequest('/unknown'), ctx, '/unknown');
    expect(unknown.status).toBe(404);

    const wrongMethod = await handleEmail(
      emailRequest('/status', { method: 'POST' }),
      ctx,
      '/status'
    );
    expect(wrongMethod.status).toBe(404);
  });
});

describe('handleEmail status', () => {
  it('reports email configuration and owner email presence', async () => {
    const ctx = makeCtx();
    const response = await handleEmail(emailRequest('/status'), ctx, '/status');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        enabled: true,
        from: 'report@artifacts.shareout.site',
        ownerEmailConfigured: true,
      },
    });
    expect(mockGetArtifactEmail).toHaveBeenCalledWith(ctx.env, ARTIFACT_ID);
  });

  it('omits from when artifact has no email address', async () => {
    mockGetArtifactEmail.mockResolvedValue(null);
    const ctx = makeCtx({ owner: { ownerId: 'usr_owner', email: null } });
    const response = await handleEmail(emailRequest('/status'), ctx, '/status');
    const body = await response.json() as { data: { from?: string; ownerEmailConfigured: boolean } };

    expect(body.data.from).toBeUndefined();
    expect(body.data.ownerEmailConfigured).toBe(false);
  });

  it('reports enabled false when EMAIL binding is missing', async () => {
    const ctx = makeCtx({ emailBinding: false });
    const response = await handleEmail(emailRequest('/status'), ctx, '/status');
    await expect(response.json()).resolves.toMatchObject({
      data: { enabled: false },
    });
  });
});

describe('handleEmail notify-owner', () => {
  it('returns config error when EMAIL binding is missing', async () => {
    const ctx = makeCtx({ emailBinding: false });
    const response = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('returns artifact not found when owner lookup fails', async () => {
    const ctx = makeCtx({ owner: null });
    const response = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(response.status).toBe(404);
  });

  it('returns error when owner has no email on file', async () => {
    const ctx = makeCtx({ owner: { ownerId: 'usr_owner', email: null } });
    const response = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('no email on file');
  });

  it('validates JSON, subject, body, replyTo, and size limits', async () => {
    const ctx = makeCtx();

    const badJson = await handleEmail(
      emailRequest('/notify-owner', { method: 'POST', body: '{' }),
      ctx,
      '/notify-owner'
    );
    expect(badJson.status).toBe(400);

    const noBody = await handleEmail(
      emailRequest('/notify-owner', { method: 'POST', body: JSON.stringify({ subject: 'Hi' }) }),
      ctx,
      '/notify-owner'
    );
    expect(noBody.status).toBe(400);

    const longSubject = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ subject: 'x'.repeat(201), text: 'ok' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(longSubject.status).toBe(400);

    const longBody = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'x'.repeat(50_001) }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(longBody.status).toBe(400);

    const badReplyTo = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'ok', replyTo: 'not-an-email' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(badReplyTo.status).toBe(400);
  });

  it('applies rate limits and send failures', async () => {
    const ctx = makeCtx();

    mockCheckEmailRateLimit.mockResolvedValueOnce({
      allowed: false,
      resetAt: 1_700_000_100,
    });
    const limited = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'Rate limited' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(limited.status).toBe(429);

    mockSendArtifactEmail.mockResolvedValueOnce({ success: false, error: 'SMTP down' });
    const failed = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({ text: 'Will fail' }),
      }),
      ctx,
      '/notify-owner'
    );
    expect(failed.status).toBe(500);
  });

  it('sends notify-owner email with defaults and increments count', async () => {
    const ctx = makeCtx();
    const response = await handleEmail(
      emailRequest('/notify-owner', {
        method: 'POST',
        body: JSON.stringify({
          html: '<p>Hi owner</p>',
          replyTo: 'visitor@example.com',
          includeArtifactLink: false,
        }),
      }),
      ctx,
      '/notify-owner'
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { sent: true, messageId: 'msg_123', to: 'owner@example.com' },
    });
    expect(mockSendArtifactEmail).toHaveBeenCalledWith(
      ctx.env,
      ARTIFACT_ID,
      expect.objectContaining({
        recipients: ['owner@example.com'],
        subject: `Message from ${ctx.artifact.name}`,
        html: '<p>Hi owner</p>',
        replyTo: 'visitor@example.com',
        includeArtifactLink: false,
      })
    );
    expect(mockIncrementEmailCount).toHaveBeenCalledWith(
      ctx.env,
      'usr_owner',
      ARTIFACT_ID
    );
  });
});

describe('handleEmail send-report', () => {
  it('returns config error when EMAIL binding is missing', async () => {
    const ctx = makeCtx({ emailBinding: false });
    const response = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'a@b.com', text: 'Report' }),
      }),
      ctx,
      '/send-report'
    );
    expect(response.status).toBe(500);
  });

  it('returns artifact not found when owner lookup fails', async () => {
    const ctx = makeCtx({ owner: null });
    const response = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'user@example.com', text: 'Report' }),
      }),
      ctx,
      '/send-report'
    );
    expect(response.status).toBe(404);
  });

  it('validates recipient, subject, body, and rate limits', async () => {
    const ctx = makeCtx();

    const badJson = await handleEmail(
      emailRequest('/send-report', { method: 'POST', body: '{' }),
      ctx,
      '/send-report'
    );
    expect(badJson.status).toBe(400);

    const badTo = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'invalid', text: 'x' }),
      }),
      ctx,
      '/send-report'
    );
    expect(badTo.status).toBe(400);

    const noBody = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'user@example.com' }),
      }),
      ctx,
      '/send-report'
    );
    expect(noBody.status).toBe(400);

    const longSubject = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'user@example.com', subject: 'x'.repeat(201), text: 'ok' }),
      }),
      ctx,
      '/send-report'
    );
    expect(longSubject.status).toBe(400);

    mockCheckEmailRateLimit.mockResolvedValueOnce({
      allowed: false,
      resetAt: 1_700_000_200,
    });
    const limited = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'user@example.com', text: 'limited' }),
      }),
      ctx,
      '/send-report'
    );
    expect(limited.status).toBe(429);
  });

  it('sends report email and handles send failure', async () => {
    const ctx = makeCtx();

    const ok = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({
          to: 'Recipient@Example.COM',
          text: 'Plain report',
        }),
      }),
      ctx,
      '/send-report'
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({
      data: { sent: true, to: 'recipient@example.com' },
    });
    expect(mockSendArtifactEmail).toHaveBeenCalledWith(
      ctx.env,
      ARTIFACT_ID,
      expect.objectContaining({
        recipients: ['recipient@example.com'],
        subject: `${ctx.artifact.name} — reporte`,
        body: 'Plain report',
      })
    );

    mockSendArtifactEmail.mockResolvedValueOnce({ success: false });
    const failed = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({ to: 'user@example.com', html: '<p>x</p>' }),
      }),
      ctx,
      '/send-report'
    );
    expect(failed.status).toBe(500);
  });

  it('rejects oversized html bodies', async () => {
    const ctx = makeCtx();
    const response = await handleEmail(
      emailRequest('/send-report', {
        method: 'POST',
        body: JSON.stringify({
          to: 'user@example.com',
          html: 'x'.repeat(50_001),
        }),
      }),
      ctx,
      '/send-report'
    );
    expect(response.status).toBe(400);
  });
});

describe('handleEmail read-only-default gate (Workstream A)', () => {
  it('blocks anonymous email on a public artifact when not opted in', async () => {
    const ctx = makeCtx({ allowAnonEmail: 0 });
    for (const path of ['/notify-owner', '/send-report']) {
      const res = await handleEmail(
        emailRequest(path, { method: 'POST', body: JSON.stringify({ to: 'x@y.com', text: 'hi' }) }),
        ctx,
        path
      );
      expect(res.status).toBe(403);
    }
  });

  it('blocks anon email when the client IP cannot be verified (fail closed)', async () => {
    const ctx = makeCtx({ allowAnonEmail: 1 });
    const req = new Request(`https://example.com/v1/data/${ARTIFACT_ID}/email/notify-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no cf-connecting-ip
      body: JSON.stringify({ text: 'hi' }),
    });
    const res = await handleEmail(req, ctx, '/notify-owner');
    expect(res.status).toBe(403);
  });
});
