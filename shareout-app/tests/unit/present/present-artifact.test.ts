// "Present this" — server flow. Real Miniflare D1 + R2 for the source-page load;
// the LLM call, the publish path, and the access check are mocked so we exercise the
// JSON contract, auth gating, publish params (private + right workspace/owner), and
// the LLM-failure "no artifact" guarantee without network or the full publish stack.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

const chatComplete = vi.fn(async () =>
  JSON.stringify({
    title: 'Q3 Revenue',
    slides: [
      { heading: 'Headline', bullets: ['Revenue up 20%', 'Churn down'], note: 'Lead with the win.' },
      { heading: 'Detail', bullets: ['By region'] },
    ],
  }),
);
vi.mock('../../../src/data/agent/anthropic', () => ({
  chatComplete: (...a: unknown[]) => chatComplete(...a),
  getAIProvider: () => ({ provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4o' }),
}));

const publishArtifact = vi.fn(async () => ({
  artifact: { id: 'art_deck', type: 'html' },
  version: { id: 'ver_deck', version_no: 1 },
  deployment: { slug: 'q3-revenue-deck', url: '/a/route/', subdomain_url: 'https://ws.shareout.site/q3-revenue-deck/' },
}));
vi.mock('../../../src/publish/publish-artifact', () => ({
  publishArtifact: (...a: unknown[]) => publishArtifact(...a),
}));

const getArtifactRef = vi.fn(async () => ({ id: 'src1', workspace_id: 'wsp_x' }));
const resolveAlertRole = vi.fn(async () => 'manager');
vi.mock('../../../src/metric-alerts/access', () => ({
  getArtifactRef: (...a: unknown[]) => getArtifactRef(...a),
  resolveAlertRole: (...a: unknown[]) => resolveAlertRole(...a),
}));

const { presentArtifact, parseDeck } = await import('../../../src/present/present-artifact');

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, description TEXT, workspace_id TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, artifact_id TEXT, version_id TEXT, channel TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifact_id TEXT, entrypoint TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, username TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, created_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`);
});

async function seedSource() {
  await e.DB.prepare(`INSERT INTO artifacts (id, name, description, workspace_id) VALUES ('src1','Q3 Revenue',NULL,'wsp_x')`).run();
  await e.DB.prepare(`INSERT INTO deployments (id, artifact_id, version_id, channel) VALUES ('dep1','src1','ver1','production')`).run();
  await e.DB.prepare(`INSERT INTO versions (id, artifact_id, entrypoint) VALUES ('ver1','src1','index.html')`).run();
  await e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime) VALUES ('ast1','ver1','index.html','k/src1','text/html')`).run();
  await e.DB.prepare(`INSERT INTO users (id, email, username) VALUES ('usr1','u@x.com','u')`).run();
  await e.ARTIFACTS.put('k/src1', new TextEncoder().encode('<html><body>Revenue dashboard, up 20% in Q3</body></html>'));
}

beforeEach(async () => {
  vi.clearAllMocks();
  getArtifactRef.mockResolvedValue({ id: 'src1', workspace_id: 'wsp_x' });
  resolveAlertRole.mockResolvedValue('manager');
  chatComplete.mockResolvedValue(JSON.stringify({
    title: 'Q3 Revenue',
    slides: [
      { heading: 'Headline', bullets: ['Revenue up 20%'], note: 'Lead with the win.' },
      { heading: 'Detail', bullets: ['By region'] },
    ],
  }));
  for (const t of ['artifacts', 'deployments', 'versions', 'assets', 'users', 'ai_usage_events', 'rate_limits']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
});

describe('parseDeck (JSON contract)', () => {
  it('parses a well-formed outline', () => {
    const d = parseDeck('noise {"title":"T","slides":[{"heading":"H","bullets":["a","b"],"note":"n"}]} trailing');
    expect(d).toEqual({ title: 'T', slides: [{ heading: 'H', bullets: ['a', 'b'], note: 'n' }] });
  });
  it('rejects non-JSON and empty slides', () => {
    expect(parseDeck('sorry, no json here')).toBeNull();
    expect(parseDeck('{"title":"T","slides":[]}')).toBeNull();
    expect(parseDeck('{"title":"","slides":[{"heading":"H","bullets":[]}]}')).toBeNull();
  });
  it('caps at 9 slides', () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({ heading: `H${i}`, bullets: ['x'] }));
    const d = parseDeck(JSON.stringify({ title: 'T', slides }));
    expect(d!.slides.length).toBe(9);
  });
});

describe('presentArtifact', () => {
  it('publishes a private deck in the source workspace, owned by the requester', async () => {
    await seedSource();
    const res = await presentArtifact(e, 'usr1', 'src1');
    expect(res.ok).toBe(true);
    expect(res.artifact_id).toBe('art_deck');
    expect(res.url).toBe('https://ws.shareout.site/q3-revenue-deck/');

    expect(publishArtifact).toHaveBeenCalledTimes(1);
    const [, user, params] = publishArtifact.mock.calls[0] as [unknown, { id: string }, Record<string, unknown>];
    expect(user.id).toBe('usr1');
    expect(params.visibility).toBe('private');
    expect(params.workspaceId).toBe('wsp_x');
    expect(params.name).toBe('Q3 Revenue — deck');
    expect(params.artifactType).toBe('html');
    const files = params.files as Array<{ content: string }>;
    expect(files[0].content).toContain('reveal.js@5');
    expect(files[0].content).toContain('Headline');

    const usage = await e.DB.prepare(`SELECT COUNT(*) AS n FROM ai_usage_events WHERE kind='present_this'`).first<{ n: number }>();
    expect(usage!.n).toBe(1);
  });

  it('404 when the artifact does not exist — no publish', async () => {
    getArtifactRef.mockResolvedValue(null);
    const res = await presentArtifact(e, 'usr1', 'missing');
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('403 when the requester has no access — no publish', async () => {
    resolveAlertRole.mockResolvedValue(null);
    const res = await presentArtifact(e, 'usr1', 'src1');
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('502 with NO artifact created when the LLM call fails', async () => {
    await seedSource();
    chatComplete.mockRejectedValue(new Error('boom'));
    const res = await presentArtifact(e, 'usr1', 'src1');
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('502 with NO artifact created when the LLM output is unusable', async () => {
    await seedSource();
    chatComplete.mockResolvedValue('I cannot help with that.');
    const res = await presentArtifact(e, 'usr1', 'src1');
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  describe('hourly rate limit (10/user/UTC hour)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('429s the 11th call in the same hour — no LLM call, no publish — then resets next hour', async () => {
      await seedSource();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-10T14:00:00Z'));

      for (let i = 0; i < 10; i++) {
        const res = await presentArtifact(e, 'usr1', 'src1');
        expect(res.ok).toBe(true);
      }
      expect(publishArtifact).toHaveBeenCalledTimes(10);
      chatComplete.mockClear();
      publishArtifact.mockClear();

      const blocked = await presentArtifact(e, 'usr1', 'src1');
      expect(blocked).toMatchObject({ ok: false, status: 429 });
      expect(chatComplete).not.toHaveBeenCalled();
      expect(publishArtifact).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2026-07-10T15:00:01Z'));
      const afterReset = await presentArtifact(e, 'usr1', 'src1');
      expect(afterReset.ok).toBe(true);
    });
  });
});
