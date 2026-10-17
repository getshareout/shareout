// POST /crew/define takes any Vercel AI Gateway model, a Claude id, or nothing — and says
// no (400) to anything else instead of silently running a different model.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

vi.mock('../../../src/data/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/data/middleware')>()),
  verifyOwner: async () => true,
}));
const catalog = vi.hoisted(() => ({ fail: false }));
vi.mock('../../../src/data/agent/gateway-catalog', () => ({
  fetchGatewayModels: async () => {
    if (catalog.fail) throw new Error('catalog down');
    return [{ id: 'openai/gpt-5' }, { id: 'anthropic/claude-sonnet-5.5' }, { id: 'deepseek/deepseek-v4.1-flash' }];
  },
}));

import { handleCrew } from '../../../src/crew/handler';
import { resolveCrewModel } from '../../../src/crew/store';

const ART = 'art_cdm';
const ctx = { env: e, artifactId: ART, workspaceId: 'wsp_cdm', artifact: { id: ART, owner_id: 'usr_cdm' }, origin: null } as never;

async function define(model?: unknown) {
  const body = model === undefined ? { name: 'C' } : { name: 'C', model };
  const res = await handleCrew(new Request('https://x/crew/define', { method: 'POST', body: JSON.stringify(body) }), ctx, '/define');
  return { status: res.status, body: (await res.json()) as { data?: { crew: { model: string } }; error?: unknown } };
}

async function storedModel(): Promise<string> {
  const res = await handleCrew(new Request('https://x/crew'), ctx, '');
  return ((await res.json()) as { data: { crew: { model: string } } }).data.crew.model;
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare(`INSERT INTO users (id, email) VALUES ('usr_cdm', 'cdm@example.com')`).run();
  await e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_cdm', 'W', 'w-cdm', 'usr_cdm')`).run();
  await e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id) VALUES (?, 'A', 'a-cdm', 'usr_cdm', 'wsp_cdm')`).bind(ART).run();
});

describe('POST /crew/define model', () => {
  it('omitted → the default model (follows the workspace gateway model)', async () => {
    expect((await define()).status).toBe(200);
    expect(await storedModel()).toBe('claude-sonnet-5-5');
    expect((await define('claude-sonnet-5')).status).toBe(200);
    expect(await storedModel()).toBe('claude-sonnet-5-5');
  });

  it('a Claude id is stored as that Claude model', async () => {
    expect((await define('claude-haiku-4-5')).status).toBe(200);
    expect(await storedModel()).toBe('claude-haiku-4-5-20251001');
  });

  it('a gateway slug from the catalog is stored as-is and returned by GET /crew', async () => {
    expect((await define('openai/gpt-5')).status).toBe(200);
    expect(await storedModel()).toBe('openai/gpt-5');
  });

  it('an unknown model is a 400 and leaves the crew unchanged', async () => {
    for (const bad of ['gpt five', 'claude-sonnet-4-20250514', 'acme/not-a-model', 42]) {
      const r = await define(bad);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/model/i);
    }
    expect(await storedModel()).toBe('openai/gpt-5');
  });
});

describe('resolveCrewModel', () => {
  it('accepts a well-formed slug when the catalog is unreachable', async () => {
    catalog.fail = true;
    try {
      expect(await resolveCrewModel('mistral/some-new-model')).toEqual({ model: 'mistral/some-new-model' });
      expect(await resolveCrewModel('not a slug')).toHaveProperty('error');
    } finally {
      catalog.fail = false;
    }
  });

  it('Claude gateway slugs skip the catalog', async () => {
    expect(await resolveCrewModel('anthropic/claude-haiku-4.5', async () => [])).toEqual({ model: 'anthropic/claude-haiku-4.5' });
  });
});
