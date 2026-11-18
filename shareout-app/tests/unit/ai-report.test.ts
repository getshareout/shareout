// Admin → Billing → AI report: one month of ai_usage_events at the workspace's price, broken down by use, model,
// automation, page, person, kind and day. Cost only for the operator; the route refuses members and agent tokens.
import { describe, expect, it, vi } from 'vitest';

const roleMock = vi.hoisted(() => vi.fn());
const operatorMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/workspaces/roles', async (importOriginal) => ({ ...(await importOriginal<object>()), requireWorkspaceRole: roleMock }));
vi.mock('../../src/superadmin/auth', async (importOriginal) => ({ ...(await importOriginal<object>()), isPlatformAdmin: operatorMock }));
vi.mock('../../src/data/agent/model-costs', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  priceCall: vi.fn(async (_e: unknown, _m: string, tin: number, tout: number) => ({ microUsd: tin + tout * 5, priced: true })),
}));

import { aiReport, aiReportCsv, categoryOf } from '../../src/workspaces/ai-report';
import { handleGetWorkspaceAiReport } from '../../src/router/api/workspace-ai-report';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

type Row = { day: string; kind: string; model: string; user_id: string | null; source: string | null; cost_source: string | null; calls: number; tin: number; tout: number; tokens: number; cost: number };
const r = (o: Partial<Row>): Row => ({ day: '2026-10-03', kind: 'assistant_chat', model: 'anthropic/claude-sonnet-5.5', user_id: 'usr_a', source: null, cost_source: 'actual', calls: 1, tin: 0, tout: 0, tokens: 0, cost: 0, ...o });
const meter: Row[] = [
  r({ kind: 'assistant_chat', calls: 2, tin: 1000, tout: 100, tokens: 1100, cost: 2_000_000 }),
  r({ kind: 'artifact_visitor_chat', user_id: null, source: 'art_1', calls: 3, tin: 900, tout: 90, tokens: 990, cost: 1_000_000 }),
  r({ kind: 'crew_run', model: 'anthropic/claude-haiku-4.5', source: 'crun_1', calls: 4, tin: 4000, tout: 400, tokens: 4400, cost: 3_000_000 }),
  r({ kind: 'crew_run', model: 'anthropic/claude-haiku-4.5', source: 'crun_2', day: '2026-10-04', calls: 1, tin: 100, tout: 10, tokens: 110, cost: 500_000 }),
  r({ kind: 'knowledge_extraction', model: 'openai/gpt-5-mini', user_id: null, source: 'art_gone', calls: 10, tokens: 50_000, cost: 400_000 }),
  // Not priced yet by the hourly reconcile: list price (tin + 5 × tout = 1_500 micro-USD).
  r({ kind: 'page_build', cost_source: 'pending', day: '2026-10-04', calls: 1, tin: 1000, tout: 100, tokens: 1100, cost: 0 }),
];

function env(rows: Row[] = meter, bps: number | null = 15_000) {
  const sqls: string[] = [];
  const DB = {
    prepare: vi.fn((sql: string) => {
      sqls.push(sql);
      return {
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => (sql.includes('instance_bps') ? { instance_bps: null, workspace_bps: bps } : null)),
          all: vi.fn(async () => {
            if (sql.includes('FROM ai_usage_events')) return { results: args[0] === 'wsp_1' ? rows : [] };
            if (sql.includes('FROM crew_runs')) return { results: [{ run_id: 'crun_1', crew_id: 'crew_x', name: 'Morning digest' }, { run_id: 'crun_2', crew_id: 'crew_x', name: 'Morning digest' }] };
            if (sql.includes('FROM artifacts')) return { results: [{ id: 'art_1', name: 'Safety dashboard' }] };
            if (sql.includes('FROM users')) return { results: [{ id: 'usr_a', name: 'ana@acme.test' }] };
            return { results: [] };
          }),
        })),
      };
    }),
  };
  return { env: { DB } as unknown as Env, sqls };
}

describe('aiReport', () => {
  it('maps kinds to the uses a bill is read by', () => {
    expect(categoryOf('assistant_chat')).toBe('questions');
    expect(categoryOf('artifact_visitor_chat')).toBe('questions');
    expect(categoryOf('page_build')).toBe('pages');
    expect(categoryOf('crew_run')).toBe('automations');
    expect(categoryOf('knowledge_whatever_new')).toBe('knowledge');
    expect(categoryOf('home_brief')).toBe('summaries');
    expect(categoryOf('whisper_transcribe')).toBe('other');
  });

  it('totals the month at price, pending calls included, and breaks it down every way', async () => {
    const rep = await aiReport(env().env, 'wsp_1', '2026-10', 15_000);
    const cost = 2_000_000 + 1_000_000 + 3_000_000 + 500_000 + 400_000 + 1_500;
    expect(rep.totals).toMatchObject({ calls: 21, input_tokens: 7000, output_tokens: 700, tokens: 57_700, price_micro_usd: Math.round(cost * 1.5) });
    expect(rep.totals.cost_micro_usd).toBeUndefined();
    expect(rep.markup_bps).toBeUndefined();

    const by = (list: { key: string }[]) => Object.fromEntries(list.map((x) => [x.key, x]));
    expect(by(rep.by_category).questions).toMatchObject({ calls: 5, price_micro_usd: 4_500_000 });
    expect(by(rep.by_category).automations).toMatchObject({ calls: 5, price_micro_usd: 5_250_000 });
    expect(by(rep.by_category).pages).toMatchObject({ calls: 1, price_micro_usd: 2_250 });
    expect(by(rep.by_model)['anthropic/claude-haiku-4.5']).toMatchObject({ calls: 5, input_tokens: 4100, output_tokens: 410 });
    // Runs roll up to their automation.
    expect(rep.by_automation).toEqual([expect.objectContaining({ key: 'crew_x', label: 'Morning digest', runs: 2, calls: 5, price_micro_usd: 5_250_000 })]);
    expect(by(rep.by_page).art_1).toMatchObject({ label: 'Safety dashboard', calls: 3 });
    expect(by(rep.by_page).art_gone).toMatchObject({ label: null, calls: 10 });
    expect(by(rep.by_member).usr_a).toMatchObject({ label: 'ana@acme.test', calls: 8 });
    expect(by(rep.by_member)['']).toMatchObject({ label: null, calls: 13 });
    expect(rep.by_day.map((d) => d.key)).toEqual(['2026-10-03', '2026-10-04']);
    expect(rep.by_category[0]!.price_micro_usd).toBeGreaterThanOrEqual(rep.by_category[1]!.price_micro_usd);
  });

  it('adds cost and markup only when asked (the operator)', async () => {
    const rep = await aiReport(env().env, 'wsp_1', '2026-10', 15_000, true);
    expect(rep.markup_bps).toBe(15_000);
    expect(rep.totals.cost_micro_usd).toBe(6_901_500);
    expect(rep.by_model.every((x) => typeof x.cost_micro_usd === 'number')).toBe(true);
    expect(aiReportCsv(rep).split('\n')[0]).toContain('cost_usd');
  });

  it('writes a CSV with a row per breakdown line and no cost for the workspace', async () => {
    const csv = aiReportCsv(await aiReport(env().env, 'wsp_1', '2026-10', 15_000));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('month,breakdown,key,name,calls,runs,input_tokens,output_tokens,tokens,price_usd');
    expect(lines[1]).toBe(`2026-10,total,total,,21,,7000,700,57700,${(Math.round(6_901_500 * 1.5) / 1e6).toFixed(6)}`);
    expect(lines.some((l) => l.startsWith('2026-10,automation,crew_x,Morning digest,5,2,'))).toBe(true);
  });
});

describe('GET /v1/workspaces/{id}/ai-report', () => {
  const user = { id: 'usr_a', email: 'ana@acme.test' } as AuthUser;
  const get = (qs = '?month=2026-10') => new Request(`https://x/v1/workspaces/wsp_1/ai-report${qs}`);

  it('refuses agent tokens, members and a bad month', async () => {
    operatorMock.mockResolvedValue(false);
    expect((await handleGetWorkspaceAiReport(get(), env().env, { ...user, service: true } as AuthUser, 'wsp_1')).status).toBe(403);
    roleMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    expect((await handleGetWorkspaceAiReport(get(), env().env, user, 'wsp_1')).status).toBe(403);
    roleMock.mockResolvedValueOnce(null);
    expect((await handleGetWorkspaceAiReport(get('?month=2026-13'), env().env, user, 'wsp_1')).status).toBe(400);
  });

  it('gives a workspace admin prices only, never cost or markup', async () => {
    operatorMock.mockResolvedValue(false);
    roleMock.mockResolvedValue(null);
    const res = await handleGetWorkspaceAiReport(get(), env().env, user, 'wsp_1');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/cost_micro_usd|markup/);
    expect(JSON.parse(text)).toMatchObject({ month: '2026-10', operator: false, totals: { price_micro_usd: 10_352_250 } });
    const csv = await (await handleGetWorkspaceAiReport(get('?month=2026-10&format=csv'), env().env, user, 'wsp_1')).text();
    expect(csv).not.toContain('cost');
  });

  it('gives the operator cost and markup too, without a workspace role', async () => {
    operatorMock.mockResolvedValue(true);
    roleMock.mockClear();
    const body = await (await handleGetWorkspaceAiReport(get(), env().env, user, 'wsp_1')).json() as { operator: boolean; markup_bps: number; totals: { cost_micro_usd: number } };
    expect(roleMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ operator: true, markup_bps: 15_000, totals: { cost_micro_usd: 6_901_500 } });
  });
});
