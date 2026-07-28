import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

// Owner gate is exercised separately; here we force it so the readout path is testable.
vi.mock('../../../src/data/middleware', async (orig) => {
  const actual = await orig<typeof import('../../../src/data/middleware')>();
  return { ...actual, verifyOwner: vi.fn() };
});

import { verifyOwner } from '../../../src/data/middleware';
import { handleAnalyticsRoutes } from '../../../src/data/slides/analytics';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;
const mockVerifyOwner = verifyOwner as unknown as ReturnType<typeof vi.fn>;

const ARTIFACT_ID = 'art_an';
const PRES_ID = 'pres_' + 'a'.repeat(24);

beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS view_sessions (
      id TEXT PRIMARY KEY, presentation_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      viewer_id TEXT, viewer_email TEXT, link_id TEXT, ip_hash TEXT, user_agent TEXT, country TEXT,
      started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0, slides_seen INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS slide_views (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, presentation_id TEXT NOT NULL,
      slide_id TEXT, slide_index INTEGER NOT NULL, entered_at TEXT NOT NULL, dwell_ms INTEGER NOT NULL DEFAULT 0,
      UNIQUE(session_id, slide_index))`,
  ];
  for (const s of stmts) await e.DB.prepare(s).run();
});

beforeEach(async () => {
  mockVerifyOwner.mockReset();
  await e.DB.prepare(`DELETE FROM view_sessions`).run();
  await e.DB.prepare(`DELETE FROM slide_views`).run();
});

function makeCtx(): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: 'wsp_x',
    artifact: { id: ARTIFACT_ID, name: 'deck', visibility: 'public', auth_method: null, owner_id: 'usr_owner' },
    db: {} as never,
    env: e,
    origin: null,
  } as unknown as DataContext;
}

function beatReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://x/v1/data/${ARTIFACT_ID}/slides/${PRES_ID}/analytics/beat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}

async function beat(body: unknown, headers?: Record<string, string>): Promise<{ sessionId: string }> {
  const res = await handleAnalyticsRoutes(beatReq(body, headers), makeCtx(), PRES_ID, ['beat']);
  const json = (await res.json()) as { success: boolean; data: { sessionId: string } };
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  return json.data;
}

describe('slides analytics — beat capture', () => {
  it('mints a session on first beat and reuses it after', async () => {
    const { sessionId } = await beat({ slideIndex: 0, slideDwellMs: 1000, sessionDurationMs: 1000, totalSlides: 3 });
    expect(sessionId).toMatch(/^ses_/);

    const second = await beat({ sessionId, slideIndex: 1, slideId: 'slide_x', slideDwellMs: 2000, sessionDurationMs: 3000, totalSlides: 3 });
    expect(second.sessionId).toBe(sessionId);

    const sessions = await e.DB.prepare(`SELECT * FROM view_sessions WHERE presentation_id = ?`).bind(PRES_ID).all();
    expect(sessions.results).toHaveLength(1);
    const row = sessions.results[0] as Record<string, unknown>;
    expect(row.slides_seen).toBe(2);
    expect(row.duration_ms).toBe(3000);
  });

  it('rejects a forged sessionId from another presentation by minting a fresh one', async () => {
    const { sessionId } = await beat({ sessionId: 'ses_' + 'f'.repeat(24), slideIndex: 0, totalSlides: 2 });
    expect(sessionId).toMatch(/^ses_/);
    expect(sessionId).not.toBe('ses_' + 'f'.repeat(24));
  });

  it('accumulates dwell with MAX (idempotent re-beats)', async () => {
    const { sessionId } = await beat({ slideIndex: 0, slideDwellMs: 500, totalSlides: 2 });
    await beat({ sessionId, slideIndex: 0, slideDwellMs: 1500, totalSlides: 2 });
    await beat({ sessionId, slideIndex: 0, slideDwellMs: 800, totalSlides: 2 }); // lower → ignored

    const sv = await e.DB.prepare(`SELECT dwell_ms FROM slide_views WHERE session_id = ? AND slide_index = 0`).bind(sessionId).first<{ dwell_ms: number }>();
    expect(sv?.dwell_ms).toBe(1500);
  });

  it('marks completed when last slide reached', async () => {
    const { sessionId } = await beat({ slideIndex: 2, totalSlides: 3, completed: true });
    const row = await e.DB.prepare(`SELECT completed FROM view_sessions WHERE id = ?`).bind(sessionId).first<{ completed: number }>();
    expect(row?.completed).toBe(1);
  });

  it('honors DNT — no ip_hash, ua, or country stored', async () => {
    const { sessionId } = await beat({ slideIndex: 0, totalSlides: 1 }, { DNT: '1', 'User-Agent': 'Mozilla/5.0' });
    const row = await e.DB.prepare(`SELECT ip_hash, user_agent, country FROM view_sessions WHERE id = ?`).bind(sessionId).first<{ ip_hash: string | null; user_agent: string | null; country: string | null }>();
    expect(row?.ip_hash).toBeNull();
    expect(row?.user_agent).toBeNull();
    expect(row?.country).toBeNull();
  });

  it('stores a hashed ip, never the raw value', async () => {
    const { sessionId } = await beat({ slideIndex: 0, totalSlides: 1 });
    const row = await e.DB.prepare(`SELECT ip_hash FROM view_sessions WHERE id = ?`).bind(sessionId).first<{ ip_hash: string }>();
    expect(row?.ip_hash).toBeTruthy();
    expect(row?.ip_hash).not.toContain('1.2.3.4');
    expect(row?.ip_hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('rejects negative slideIndex', async () => {
    const res = await handleAnalyticsRoutes(beatReq({ slideIndex: -1 }), makeCtx(), PRES_ID, ['beat']);
    expect(res.status).toBe(400);
  });
});

describe('slides analytics — owner readout', () => {
  it('403s for non-owners', async () => {
    mockVerifyOwner.mockResolvedValue(false);
    const res = await handleAnalyticsRoutes(new Request('https://x', { method: 'GET' }), makeCtx(), PRES_ID, []);
    expect(res.status).toBe(403);
  });

  it('aggregates summary, per-slide drop-off, and sessions for the owner', async () => {
    mockVerifyOwner.mockResolvedValue(true);

    // Session A: views all 3 slides, completes.
    const a = await beat({ slideIndex: 0, slideDwellMs: 1000, sessionDurationMs: 1000, totalSlides: 3 });
    await beat({ sessionId: a.sessionId, slideIndex: 1, slideDwellMs: 2000, sessionDurationMs: 3000, totalSlides: 3 });
    await beat({ sessionId: a.sessionId, slideIndex: 2, slideDwellMs: 500, sessionDurationMs: 3500, totalSlides: 3, completed: true });
    // Session B: drops after slide 0.
    await beat({ slideIndex: 0, slideDwellMs: 400, sessionDurationMs: 400, totalSlides: 3 }, { 'CF-Connecting-IP': '9.9.9.9' });

    const res = await handleAnalyticsRoutes(new Request('https://x', { method: 'GET' }), makeCtx(), PRES_ID, []);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: any };

    expect(data.summary.totalViews).toBe(2);
    expect(data.summary.uniqueViewers).toBe(2);
    expect(data.summary.completionRate).toBeCloseTo(0.5, 5);

    const slide0 = data.perSlide.find((p: { slideIndex: number }) => p.slideIndex === 0);
    const slide2 = data.perSlide.find((p: { slideIndex: number }) => p.slideIndex === 2);
    expect(slide0.views).toBe(2);
    expect(slide0.dropOffRate).toBe(0);
    expect(slide2.views).toBe(1);
    expect(slide2.dropOffRate).toBeCloseTo(0.5, 5); // 1 of 2 dropped before slide 2

    expect(data.sessions).toHaveLength(2);
    expect(data.sessions[0]).toHaveProperty('device');
  });
});
