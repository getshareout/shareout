// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAgent } from '../../../../src/data/agent/handler';
import {
  ARTIFACT_ID,
  BASE_URL,
  USER_ID,
  jsonRequest,
  makeCtx,
  makeEnv,
  sessionCookie,
} from './helpers';

const mockGetAgentConfig = vi.fn();

vi.mock('../../../../src/data/agent/visitor-chat', () => ({
  handleVisitorChat: vi.fn(async () => new Response('visitor-chat')),
  handleConversations: vi.fn(async () => new Response('conversations')),
  handleVisitorConfig: vi.fn(async () => new Response('config')),
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
}));

vi.mock('../../../../src/data/agent/admin-chat', () => ({
  handleAdminContext: vi.fn(async () => new Response('admin-context')),
  handleAdminChat: vi.fn(async () => new Response('admin-chat')),
  handleApplyEdits: vi.fn(async () => new Response('apply-edits')),
  handlePublish: vi.fn(async () => new Response('publish')),
}));

vi.mock('../../../../src/data/agent/usage', () => ({
  getUsage: vi.fn(async () => ({
    visitor: { input_tokens: 100, output_tokens: 50, request_count: 5, error_count: 0 },
    admin: null,
    pilot: null,
  })),
}));

import {
  handleVisitorChat,
  handleConversations,
  handleVisitorConfig,
} from '../../../../src/data/agent/visitor-chat';
import {
  handleAdminContext,
  handleAdminChat,
  handleApplyEdits,
  handlePublish,
} from '../../../../src/data/agent/admin-chat';
import { getUsage } from '../../../../src/data/agent/usage';

afterEach(() => {
  vi.restoreAllMocks();
});

function ownerDb(userId = USER_ID) {
  return {
    first: (sql: string, args: unknown[]) => {
      if (sql.includes('owner_id FROM artifacts')) {
        return { owner_id: userId };
      }
      if (sql.includes('FROM collaborators')) {
        return args.includes(userId) ? { role: 'editor' } : null;
      }
      if (sql.includes('FROM tokens')) {
        return { user_id: userId };
      }
      return null;
    },
  };
}

describe('handleAgent routing', () => {
  const ctx = makeCtx(makeEnv());

  it('routes chat to handleVisitorChat', async () => {
    const req = new Request(`${BASE_URL}/chat`, { method: 'POST' });
    const res = await handleAgent(req, ctx, 'chat');
    expect(handleVisitorChat).toHaveBeenCalledWith(req, ctx);
    expect(await res.text()).toBe('visitor-chat');
  });

  it('routes conversations with id', async () => {
    const req = new Request(`${BASE_URL}/conversations/conv_1`, { method: 'GET' });
    await handleAgent(req, ctx, 'conversations/conv_1');
    expect(handleConversations).toHaveBeenCalledWith(req, ctx, 'conv_1', undefined);
  });

  it('routes config', async () => {
    const req = new Request(`${BASE_URL}/config`, { method: 'GET' });
    await handleAgent(req, ctx, 'config');
    expect(handleVisitorConfig).toHaveBeenCalledWith(req, ctx);
  });

  it('returns usage for GET /usage', async () => {
    const req = new Request(`${BASE_URL}/usage?period=2026-05`, { method: 'GET' });
    const res = await handleAgent(req, ctx, 'usage');
    const body = await res.json() as { success: boolean; data: { period: string; usage: unknown } };

    expect(getUsage).toHaveBeenCalledWith(ctx.env, ARTIFACT_ID, '2026-05');
    expect(body.success).toBe(true);
    expect(body.data.period).toBe('2026-05');
  });

  it('rejects non-GET on usage endpoint', async () => {
    const req = new Request(`${BASE_URL}/usage`, { method: 'POST' });
    const res = await handleAgent(req, ctx, 'usage');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown action', async () => {
    const res = await handleAgent(new Request(`${BASE_URL}/unknown`), ctx, 'unknown');
    expect(res.status).toBe(404);
  });
});

describe('handleAgent admin endpoints', () => {
  it('requires owner auth for admin routes', async () => {
    const ctx = makeCtx(makeEnv({ first: () => null }));
    const req = jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'hi' });

    const res = await handleAgent(req, ctx, 'admin/chat');
    expect(res.status).toBe(403);
  });

  it('routes admin/context with session auth', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(handleAdminContext).toHaveBeenCalled();
    expect(await res.text()).toBe('admin-context');
  });

  it('routes admin/chat', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'hi' }, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    await handleAgent(req, ctx, 'admin/chat');
    expect(handleAdminChat).toHaveBeenCalled();
  });

  it('routes admin/apply', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/apply`, 'POST', { edits: [] }, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    await handleAgent(req, ctx, 'admin/apply');
    expect(handleApplyEdits).toHaveBeenCalled();
  });

  it('routes admin/publish', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/publish`, 'POST', { conversationId: 'conv_1' }, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    await handleAgent(req, ctx, 'admin/publish');
    expect(handlePublish).toHaveBeenCalled();
  });

  it('returns 404 for unknown admin action', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/unknown`, 'GET', undefined, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    const res = await handleAgent(req, ctx, 'admin/unknown');
    expect(res.status).toBe(404);
  });

  it('authenticates via Bearer token', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Authorization: 'Bearer my-api-token',
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(res.status).toBe(200);
  });

  it('grants access when user is artifact owner via session', async () => {
    const ctx = makeCtx(makeEnv({
      first: (sql) => {
        if (sql.includes('owner_id FROM artifacts')) return { owner_id: USER_ID };
        return null;
      },
    }));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(res.status).toBe(200);
  });

  it('rejects invalid session cookie payload', async () => {
    const ctx = makeCtx(makeEnv({ first: () => null }));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Cookie: 'shareout_session=not-valid-base64!!!.sig',
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(res.status).toBe(403);
  });

  it('rejects session without userId', async () => {
    const payload = btoa(JSON.stringify({ email: 'x@y.com' }));
    const ctx = makeCtx(makeEnv({ first: () => null }));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Cookie: `shareout_session=${payload}.sig`,
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(res.status).toBe(403);
  });

  it('grants editor collaborator access via session', async () => {
    const ctx = makeCtx(makeEnv({
      first: (sql, args) => {
        if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
        if (sql.includes('FROM collaborators') && args.includes(USER_ID)) return { role: 'editor' };
        return null;
      },
    }));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(res.status).toBe(200);
  });

  it('denies bearer token when user is not owner or collaborator', async () => {
    const ctx = makeCtx(makeEnv({
      first: (sql) => {
        if (sql.includes('FROM tokens')) return { user_id: 'usr_other' };
        if (sql.includes('owner_id FROM artifacts')) return { owner_id: USER_ID };
        if (sql.includes('FROM collaborators')) return null;
        return null;
      },
    }));
    const req = jsonRequest(`${BASE_URL}/admin/context`, 'GET', undefined, {
      Authorization: 'Bearer token',
    });

    const res = await handleAgent(req, ctx, 'admin/context');
    expect(res.status).toBe(403);
  });
});

describe('handleAgent admin config (pilot_enabled)', () => {
  afterEach(() => vi.clearAllMocks());

  it('persists pilot_enabled and round-trips via getAgentConfig', async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const ctx = makeCtx(makeEnv({
      ...ownerDb(),
      run: (sql, args) => { writes.push({ sql, args }); return { success: true }; },
    }));
    mockGetAgentConfig.mockResolvedValue({ artifact_id: ARTIFACT_ID, pilot_enabled: true });
    const req = jsonRequest(`${BASE_URL}/admin/config`, 'POST', { pilot_enabled: true }, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });

    const res = await handleAgent(req, ctx, 'admin/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { pilot_enabled: boolean; config: { pilot_enabled: boolean } } };
    expect(body.data.pilot_enabled).toBe(true);
    expect(body.data.config.pilot_enabled).toBe(true);
    const upsert = writes.find((w) => w.sql.includes('artifact_agent_config'));
    expect(upsert?.args).toEqual([ARTIFACT_ID, 1]);
  });

  it('rejects a non-boolean pilot_enabled with 400', async () => {
    const ctx = makeCtx(makeEnv(ownerDb()));
    const req = jsonRequest(`${BASE_URL}/admin/config`, 'POST', { pilot_enabled: 'yes' }, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });
    const res = await handleAgent(req, ctx, 'admin/config');
    expect(res.status).toBe(400);
  });

  it('denies config write to a non-owner', async () => {
    const ctx = makeCtx(makeEnv({ first: () => null }));
    const req = jsonRequest(`${BASE_URL}/admin/config`, 'POST', { pilot_enabled: true }, {
      Cookie: `shareout_session=${sessionCookie(USER_ID)}`,
    });
    const res = await handleAgent(req, ctx, 'admin/config');
    expect(res.status).toBe(403);
  });
});

// Ensure usage default period when not specified
describe('handleAgent usage defaults', () => {
  it('uses current month when period param omitted', async () => {
    const ctx = makeCtx(makeEnv());
    const req = new Request(`${BASE_URL}/usage`, { method: 'GET' });
    const res = await handleAgent(req, ctx, 'usage');
    const body = await res.json() as { data: { period: string } };
    expect(body.data.period).toMatch(/^\d{4}-\d{2}$/);
  });
});
