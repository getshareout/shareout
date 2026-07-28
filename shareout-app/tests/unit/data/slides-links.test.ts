import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/data/middleware', async (orig) => {
  const actual = await orig<typeof import('../../../src/data/middleware')>();
  return { ...actual, verifyOwner: vi.fn() };
});

vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

import { verifyOwner } from '../../../src/data/middleware';
import { dispatchLifecycleEmail } from '../../../src/email/gateway';
import { handleLinksRoutes } from '../../../src/data/slides/links';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;
const mockVerifyOwner = verifyOwner as unknown as ReturnType<typeof vi.fn>;
const mockDispatch = dispatchLifecycleEmail as unknown as ReturnType<typeof vi.fn>;

const ARTIFACT_ID = 'art_lnk';
const PRES_ID = 'pres_' + 'a'.repeat(24);

beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS view_sessions (
      id TEXT PRIMARY KEY, presentation_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      viewer_id TEXT, viewer_email TEXT, link_id TEXT, ip_hash TEXT, user_agent TEXT, country TEXT,
      started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0, slides_seen INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY, presentation_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      recipient_label TEXT, gate TEXT NOT NULL DEFAULT 'none', gate_value TEXT,
      expires_at TEXT, max_views INTEGER, created_by TEXT, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY, title TEXT)`,
  ];
  for (const s of stmts) await e.DB.prepare(s).run();
  await e.DB.prepare(`INSERT OR IGNORE INTO presentations (id, title) VALUES (?, 'Q3 Proposal')`).bind(PRES_ID).run();
});

beforeEach(async () => {
  mockVerifyOwner.mockReset();
  mockDispatch.mockClear();
  await e.DB.prepare(`DELETE FROM share_links`).run();
  await e.DB.prepare(`DELETE FROM view_sessions`).run();
});

function makeCtx(): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: 'wsp_x',
    artifact: { id: ARTIFACT_ID, name: 'deck', visibility: 'public', auth_method: null, owner_id: 'usr_owner' },
    db: {} as never,
    env: { ...e, SHAREOUT_BASE_URL: 'https://shareout.site' } as Env,
    origin: null,
  } as unknown as DataContext;
}

function req(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://x', {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(method: string, parts: string[], body?: unknown, headers?: Record<string, string>) {
  const res = await handleLinksRoutes(req(method, body, headers), makeCtx(), PRES_ID, parts);
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json };
}

async function createLink(body: unknown): Promise<string> {
  mockVerifyOwner.mockResolvedValue(true);
  const { status, json } = await call('POST', [], body);
  expect(status).toBe(201);
  return json.data.id as string;
}

describe('slides tracked links — owner CRUD', () => {
  it('requires owner to create', async () => {
    mockVerifyOwner.mockResolvedValue(false);
    const { status } = await call('POST', [], { recipientLabel: 'Acme' });
    expect(status).toBe(403);
  });

  it('creates a link with a recipient and returns a tracked url', async () => {
    const id = await createLink({ recipientLabel: 'Acme Corp' });
    expect(id).toMatch(/^lnk_/);
    mockVerifyOwner.mockResolvedValue(true);
    const { json } = await call('GET', []);
    expect(json.data.links).toHaveLength(1);
    expect(json.data.links[0].url).toContain(`?l=${id}`);
    expect(json.data.links[0].recipientLabel).toBe('Acme Corp');
    expect(json.data.links[0].views).toBe(0);
  });

  it('rejects password gate without a password', async () => {
    mockVerifyOwner.mockResolvedValue(true);
    const { status, json } = await call('POST', [], { gate: 'password' });
    expect(status).toBe(400);
    expect(json.code).toBe('PASSWORD_REQUIRED');
  });

  it('revokes a link', async () => {
    const id = await createLink({ recipientLabel: 'X' });
    mockVerifyOwner.mockResolvedValue(true);
    const { status } = await call('DELETE', [id]);
    expect(status).toBe(200);
    const { json } = await call('GET', []);
    expect(json.data.links[0].revoked).toBe(true);
  });
});

describe('slides tracked links — public access', () => {
  it('open gate mints an attributed session', async () => {
    const id = await createLink({ recipientLabel: 'Acme', gate: 'none' });
    const { status, json } = await call('POST', [id, 'access'], {});
    expect(status).toBe(200);
    expect(json.data.sessionId).toMatch(/^ses_/);
    const row = await e.DB.prepare(`SELECT link_id, viewer_email FROM view_sessions WHERE id = ?`).bind(json.data.sessionId).first<{ link_id: string; viewer_email: string | null }>();
    expect(row?.link_id).toBe(id);
  });

  it('email gate requires a valid email and captures it', async () => {
    const id = await createLink({ gate: 'email' });
    const bad = await call('POST', [id, 'access'], { email: 'nope' });
    expect(bad.status).toBe(401);
    const ok = await call('POST', [id, 'access'], { email: 'jane@globex.com' });
    expect(ok.status).toBe(200);
    const row = await e.DB.prepare(`SELECT viewer_email FROM view_sessions WHERE id = ?`).bind(ok.json.data.sessionId).first<{ viewer_email: string }>();
    expect(row?.viewer_email).toBe('jane@globex.com');
  });

  it('domain gate enforces the allowlist', async () => {
    const id = await createLink({ gate: 'domain', domains: ['acme.com'] });
    const denied = await call('POST', [id, 'access'], { email: 'jane@globex.com' });
    expect(denied.status).toBe(403);
    const ok = await call('POST', [id, 'access'], { email: 'bob@acme.com' });
    expect(ok.status).toBe(200);
  });

  it('password gate validates the password', async () => {
    const id = await createLink({ gate: 'password', password: 's3cret' });
    const wrong = await call('POST', [id, 'access'], { password: 'nope' });
    expect(wrong.status).toBe(401);
    const ok = await call('POST', [id, 'access'], { password: 's3cret' });
    expect(ok.status).toBe(200);
  });

  it('does not leak the password hash via the gate metadata endpoint', async () => {
    const id = await createLink({ gate: 'password', password: 's3cret', recipientLabel: 'Acme' });
    const { status, json } = await call('GET', [id]);
    expect(status).toBe(200);
    expect(json.data.gate).toBe('password');
    expect(JSON.stringify(json.data)).not.toContain('gate_value');
    expect(JSON.stringify(json.data)).not.toContain('s3cret');
  });

  it('rejects a revoked link', async () => {
    const id = await createLink({ gate: 'none' });
    mockVerifyOwner.mockResolvedValue(true);
    await call('DELETE', [id]);
    const { status, json } = await call('POST', [id, 'access'], {});
    expect(status).toBe(410);
    expect(json.code).toBe('LINK_REVOKED');
  });

  it('rejects an expired link', async () => {
    const id = await createLink({ gate: 'none', expiresAt: '2000-01-01T00:00:00.000Z' });
    const { status, json } = await call('POST', [id, 'access'], {});
    expect(status).toBe(410);
    expect(json.code).toBe('LINK_EXPIRED');
  });

  it('enforces the view cap', async () => {
    const id = await createLink({ gate: 'none', maxViews: 1 });
    const first = await call('POST', [id, 'access'], {});
    expect(first.status).toBe(200);
    const second = await call('POST', [id, 'access'], {});
    expect(second.status).toBe(403);
    expect(second.json.code).toBe('VIEW_LIMIT_REACHED');
  });
});

describe('slides tracked links — owner notification (P2)', () => {
  it('emails the owner on first open with deck title + recipient', async () => {
    const id = await createLink({ gate: 'none', recipientLabel: 'Acme Corp' });
    await call('POST', [id, 'access'], {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const arg = mockDispatch.mock.calls[0][1];
    expect(arg.type).toBe('slides_deck_opened');
    expect(arg.toUserId).toBe('usr_owner');
    expect(arg.data.deckName).toBe('Q3 Proposal');
    expect(arg.data.recipientLabel).toBe('Acme Corp');
  });

  it('suppresses repeat emails for the same link within the cooldown', async () => {
    const id = await createLink({ gate: 'none', recipientLabel: 'Acme' });
    await call('POST', [id, 'access'], {});
    await call('POST', [id, 'access'], {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});
