// The workspace monthly AI budget is the real ceiling: it sums every metered call (ai_usage_events), and the
// provider layer, crews and Knowledge ingest all stop once it is reached, without failing anything for good.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import { budgetState, resetBudgetCache, workspaceBudgetBlock, WorkspaceBudgetError } from '../../src/data/ai-budget';
import { chat, chatComplete, streamChat } from '../../src/data/agent/anthropic';
import { handleSetWorkspaceBudget } from '../../src/router/api/workspace-llm';
import { handleGetWorkspaceAiLimits } from '../../src/router/api/workspace-ai-limits';
import { crewProviderFor } from '../../src/crew/provider';
import { runEval } from '../../src/crew/eval';
import { createMiniDb } from '../../src/data/minidb-client';
import { corpusFor } from '../../src/knowledge/corpus/client';
import { extractStep, graphStep, GRAPH_DEFERRED, ingestInline } from '../../src/knowledge/corpus/ingest';
import { runCorpusRefresh } from '../../src/knowledge/corpus/reindex';
import { setKnowledgeEnabled } from '../../src/knowledge';
import type { CrewRow, CrewRunRow } from '../../src/crew/types';
import type { DataContext } from '../../src/data/middleware';

const e = env as unknown as Env;
const WS = 'wsp_bud';
const OTHER = 'wsp_bud_other';
const user = (id: string) => ({ id, email: `${id}@x.com`, username: null });
const nowIso = () => new Date().toISOString();
const lastMonthIso = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)).toISOString(); };

async function usage(ws: string | null, kind: string, micro: number, at = nowIso(), source = 'actual') {
  await e.DB.prepare(
    `INSERT INTO ai_usage_events (id, workspace_id, kind, model, units, unit_kind, base_cost_micro_usd, cost_source, created_at)
     VALUES (?, ?, ?, 'm', 1, 'tokens', ?, ?, ?)`,
  ).bind(`aiu_${Math.random().toString(36).slice(2)}`, ws, kind, micro, source, at).run();
}
const setBudget = (ws: string, micro: number | null) =>
  e.DB.prepare('INSERT OR REPLACE INTO workspace_llm_config (workspace_id, monthly_budget_micro_usd) VALUES (?, ?)').bind(ws, micro).run();

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_source TEXT, provider_ref TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS workspace_llm_config (workspace_id TEXT PRIMARY KEY, byo_provider TEXT, byo_encrypted_credentials TEXT, byo_iv TEXT, balance_micro_usd INTEGER DEFAULT 0, markup_multiplier REAL DEFAULT 1, monthly_budget_micro_usd INTEGER, gateway_model TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, username TEXT, tier TEXT, disabled INTEGER)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, member_class TEXT NOT NULL DEFAULT 'internal', PRIMARY KEY (workspace_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`,
    `CREATE TABLE IF NOT EXISTS agent_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, artifact_id TEXT, conversation_id TEXT, mode TEXT, provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, base_cost_micro_usd INTEGER, billed_cost_micro_usd INTEGER, byo INTEGER, crew_id TEXT, run_id TEXT, trigger_kind TEXT, tool_name TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS plan_crew_limits (plan TEXT PRIMARY KEY, max_crews_per_artifact INTEGER, max_concurrent_runs INTEGER, default_run_budget_micro_usd INTEGER, max_iterations_cap INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, type_metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, instructions TEXT, model TEXT, status TEXT, max_iterations INTEGER, max_tokens_per_call INTEGER, run_budget_micro_usd INTEGER, max_runtime_ms INTEGER, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS crew_grants (crew_id TEXT, tool_name TEXT, mode TEXT, enabled INTEGER, approval_policy TEXT, limits_json TEXT, PRIMARY KEY (crew_id, tool_name))`,
    `CREATE TABLE IF NOT EXISTS crew_runs (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, trigger_kind TEXT, initiated_by TEXT, status TEXT, termination_reason TEXT, input_json TEXT, result_text TEXT, iterations INTEGER DEFAULT 0, token_input INTEGER DEFAULT 0, token_output INTEGER DEFAULT 0, cost_micro_usd INTEGER DEFAULT 0, started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_run_events (id TEXT PRIMARY KEY, run_id TEXT, crew_id TEXT, seq INTEGER, event_type TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, token_input INTEGER, token_output INTEGER, latency_ms INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_action_approvals (id TEXT PRIMARY KEY, crew_id TEXT, run_id TEXT, artifact_id TEXT, tool_name TEXT, input_json TEXT, status TEXT DEFAULT 'pending', result_json TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS crew_triggers (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, kind TEXT, cron TEXT, event_type TEXT, condition_json TEXT, enabled INTEGER DEFAULT 1, next_run_at INTEGER, last_run_at INTEGER, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT NOT NULL, version_id TEXT, channel TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`,
    `CREATE TABLE IF NOT EXISTS assets (version_id TEXT, path TEXT, r2_key TEXT, mime TEXT, size_bytes INTEGER)`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  resetBudgetCache();
  for (const t of ['ai_usage_events', 'workspace_llm_config', 'users', 'workspace_members', 'rate_limits']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_admin','usr_admin@x.com'), ('usr_m','usr_m@x.com'), ('usr_out','usr_out@x.com')`);
  await e.DB.exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${WS}','usr_admin','admin'), ('${WS}','usr_m','member')`);
});

describe('monthly spend', () => {
  it('sums every ai_usage_events kind this month for the workspace only, by kind', async () => {
    await usage(WS, 'assistant_chat', 4_000_000);
    await usage(WS, 'crew_run', 3_000_000);
    await usage(WS, 'crew_run', 1_000_000);
    await usage(WS, 'knowledge_extraction', 500_000);
    await usage(WS, 'crew_run', 9_000_000, lastMonthIso());
    await usage(OTHER, 'crew_run', 7_000_000);
    await usage(null, 'crew_run', 7_000_000);
    await setBudget(WS, 100_000_000);
    const s = await budgetState(e, WS);
    expect(s.spentMicro).toBe(8_500_000);
    expect(s.byKind).toEqual({ assistant_chat: 4_000_000, crew_run: 4_000_000, knowledge_extraction: 500_000 });
    expect(s).toMatchObject({ budgetMicro: 100_000_000, pct: 8, state: 'ok' });
    const d = new Date();
    expect(s.resetsAt).toBe(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString());
  });

  it('walks ok -> near (80%) -> reached (100%) and reports no state without a budget', async () => {
    expect((await budgetState(e, WS)).state).toBe('none');
    await setBudget(WS, 10_000_000);
    await usage(WS, 'crew_run', 7_900_000);
    expect((await budgetState(e, WS, { fresh: true })).state).toBe('ok');
    await usage(WS, 'crew_run', 100_000);
    expect((await budgetState(e, WS, { fresh: true })).state).toBe('near');
    await usage(WS, 'crew_run', 2_000_000);
    expect((await budgetState(e, WS, { fresh: true })).state).toBe('reached');
  });

  it('caches for a short while so a call is not a full scan', async () => {
    await setBudget(WS, 10_000_000);
    expect((await budgetState(e, WS)).spentMicro).toBe(0);
    await usage(WS, 'crew_run', 5_000_000);
    expect((await budgetState(e, WS)).spentMicro).toBe(0);
    expect((await budgetState(e, WS, { fresh: true })).spentMicro).toBe(5_000_000);
  });
});

describe('warnings', () => {
  it('log once per month per workspace at 80% and at 100%, not on every call', async () => {
    const puts: string[] = [];
    const store = new Map<string, string>();
    const kv = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { puts.push(k); store.set(k, v); } };
    const ev = { ...e, RATE_LIMIT_KV: kv } as unknown as Env;
    await setBudget(WS, 10_000_000);
    await usage(WS, 'crew_run', 8_500_000);
    await budgetState(ev, WS, { fresh: true });
    await budgetState(ev, WS, { fresh: true });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatch(/:near$/);
    await usage(WS, 'crew_run', 2_000_000);
    resetBudgetCache();
    await budgetState(ev, WS, { fresh: true });
    await budgetState(ev, WS, { fresh: true });
    expect(puts.map((k) => k.split(':').pop()).sort()).toEqual(['near', 'reached']);
  });
});

describe('provider layer refuses when over budget', () => {
  beforeEach(async () => {
    await setBudget(WS, 1_000_000);
    await usage(WS, 'crew_run', 1_000_000);
  });

  it('streamChat yields a workspace_budget error with resets_at, and chatComplete / chat throw it', async () => {
    const meter = { workspaceId: WS, userId: 'usr_m', kind: 'assistant_chat' };
    const chunks = [];
    for await (const c of streamChat(e, meter, [{ role: 'user', content: 'hi' }], 'sys', '', 100)) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error', code: 'workspace_budget' });
    expect(new Date(chunks[0].resets_at!).getUTCDate()).toBe(1);
    const err = await chatComplete(e, meter, [{ role: 'user', content: 'hi' }], 'sys', 100).catch((x) => x);
    expect(err).toBeInstanceOf(WorkspaceBudgetError);
    expect(err.code).toBe('workspace_budget');
    expect(await chat(e, meter, [{ role: 'user', content: 'hi' }], 'sys', '', 100).catch((x) => x)).toBeInstanceOf(WorkspaceBudgetError);
  });

  it('never blocks personal calls (no workspace) or another workspace', async () => {
    expect(await workspaceBudgetBlock(e, null)).toBeNull();
    expect(await workspaceBudgetBlock(e, OTHER)).toBeNull();
    const chunks = [];
    for await (const c of streamChat(e, { workspaceId: null, userId: 'usr_m', kind: 'assistant_chat' }, [{ role: 'user', content: 'hi' }], 'sys', '', 100)) chunks.push(c);
    expect(chunks.some((c) => c.code === 'workspace_budget')).toBe(false);
  });

  it('ends a crew run cleanly with the workspace_budget termination reason', async () => {
    await e.DB.prepare(`INSERT OR REPLACE INTO artifacts (id, workspace_id, owner_id, name) VALUES ('art_b', ?, 'usr_m', 'B')`).bind(WS).run();
    await e.DB.prepare(`INSERT OR REPLACE INTO crews (id, artifact_id, workspace_id, owner_id, name, instructions, model, status, max_iterations, max_tokens_per_call, run_budget_micro_usd, max_runtime_ms)
      VALUES ('crew_b', 'art_b', ?, 'usr_m', 'C', 'Do it.', 'm', 'active', 4, 1024, 250000, 25000)`).bind(WS).run();
    await e.DB.prepare(`INSERT OR REPLACE INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status) VALUES ('crun_b', 'crew_b', 'art_b', 'cron', 'running')`).run();
    const crew = (await e.DB.prepare('SELECT * FROM crews WHERE id = ?').bind('crew_b').first<CrewRow>())!;
    const run = (await e.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind('crun_b').first<CrewRunRow>())!;
    const ownerCtx: DataContext = {
      artifactId: 'art_b', workspaceId: WS,
      artifact: { id: 'art_b', name: 'B', visibility: 'private', auth_method: null, workspace_id: WS },
      db: createMiniDb(env as never, 'art_b', WS), env: env as never, origin: null, viewerScope: null,
    };
    const provider = crewProviderFor(e, { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://example.invalid/v1', model: 'gpt-x' });
    const res = await runEval(e, { crew, run, ownerCtx, input: 'Go.', provider });
    expect(res.terminationReason).toBe('workspace_budget');
    const row = await e.DB.prepare('SELECT status, termination_reason, result_text FROM crew_runs WHERE id = ?').bind('crun_b').first<Record<string, string>>();
    expect(row).toMatchObject({ status: 'error', termination_reason: 'workspace_budget' });
    expect(row!.result_text).toContain('monthly AI budget');
  });
});

describe('Knowledge ingest under a spent budget', () => {
  const ws = 'wsp_bud_kn';
  const put = async (id: string) => {
    const ver = `ver_${id}`;
    await e.ARTIFACTS.put(`test/${id}/index.html`, '<html><body><h1 id="a">Policy</h1><p>Every invoice needs approval before payment goes out.</p></body></html>');
    await e.DB.batch([
      e.DB.prepare('INSERT OR REPLACE INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)').bind(id, id, id, 'u1', 'workspace', ws),
      e.DB.prepare("INSERT INTO deployments (artifact_id, version_id, channel) VALUES (?, ?, 'production')").bind(id, ver),
      e.DB.prepare('INSERT OR REPLACE INTO versions (id, entrypoint) VALUES (?, ?)').bind(ver, 'index.html'),
      e.DB.prepare("INSERT INTO assets (version_id, path, r2_key, mime) VALUES (?, 'index.html', ?, 'text/html')").bind(ver, `test/${id}/index.html`),
    ]);
  };

  it('defers extraction (queued, never failed) and graph batches, and the nightly refresh retries after', async () => {
    await setKnowledgeEnabled(e, ws, true);
    await put('art_kn_a');
    await put('art_kn_b');
    const store = corpusFor(e, ws)!;

    // Not over budget yet: a source is learned and ready.
    await ingestInline({ ...e, AI: undefined } as Env, { workspaceId: ws, kind: 'page', refId: 'art_kn_a' });
    expect((await store.getSource('art_kn_a'))?.status).toBe('ready');

    await setBudget(ws, 1_000_000);
    await usage(ws, 'knowledge_extraction', 1_000_000);
    resetBudgetCache();

    const r = await extractStep(e, { workspaceId: ws, kind: 'page', refId: 'art_kn_b' });
    expect(r.status).toBe('deferred');
    const b = await store.getSource('art_kn_b');
    expect(b?.status).toBe('processing');
    expect(b?.error).toMatch(/budget/i);

    // A graph batch stops without calling the model.
    expect(await graphStep({ ...e, AI: {} } as unknown as Env, { workspaceId: ws, kind: 'page', refId: 'art_kn_a' }, 0)).toBe(GRAPH_DEFERRED);

    // Refresh leaves an over-budget workspace alone, then picks the queued source up once raised.
    await e.DB.prepare("UPDATE knowledge_settings SET enabled = 1 WHERE workspace_id = ?").bind(ws).run();
    expect((await runCorpusRefresh(e)).queued).toBe(0);
    await setBudget(ws, 100_000_000);
    resetBudgetCache();
    expect(await workspaceBudgetBlock(e, ws)).toBeNull();
    const status = (await store.getSource('art_kn_b'))?.status;
    expect(status).not.toBe('failed');
  });
});

describe('PUT /v1/workspaces/{id}/llm/budget', () => {
  const put = (id: string, body: unknown) =>
    handleSetWorkspaceBudget(new Request('https://x/', { method: 'PUT', body: JSON.stringify(body) }), e, user(id), WS);
  const stored = async () => (await e.DB.prepare('SELECT monthly_budget_micro_usd AS b FROM workspace_llm_config WHERE workspace_id = ?').bind(WS).first<{ b: number | null }>())?.b;

  it('lets an admin set and clear it; refuses members and strangers', async () => {
    expect((await put('usr_m', { monthlyBudgetUsd: 50 })).status).toBe(403);
    expect((await put('usr_out', { monthlyBudgetUsd: 50 })).status).toBe(403);
    expect(await stored()).toBeUndefined();
    expect((await put('usr_admin', { monthlyBudgetUsd: 100 })).status).toBe(200);
    expect(await stored()).toBe(100_000_000);
    expect((await put('usr_admin', { monthlyBudgetUsd: null })).status).toBe(200);
    expect(await stored()).toBeNull();
  });

  it('validates 0 < x <= 100000 or null', async () => {
    for (const bad of [0, -5, 100001, 'ten', undefined, '50']) {
      expect((await put('usr_admin', { monthlyBudgetUsd: bad })).status).toBe(400);
    }
    expect((await put('usr_admin', { monthlyBudgetUsd: 100000 })).status).toBe(200);
    expect((await handleSetWorkspaceBudget(new Request('https://x/', { method: 'PUT', body: 'nope' }), e, user('usr_admin'), WS)).status).toBe(400);
  });

  it('takes effect immediately for enforcement', async () => {
    await usage(WS, 'crew_run', 5_000_000);
    expect(await workspaceBudgetBlock(e, WS)).toBeNull();
    await put('usr_admin', { monthlyBudgetUsd: 5 });
    expect(await workspaceBudgetBlock(e, WS)).toBeInstanceOf(WorkspaceBudgetError);
  });
});

describe('GET /v1/workspaces/{id}/ai-limits budget fields', () => {
  it('gives an admin spend, budget, pct, state, reset and spend by kind', async () => {
    await setBudget(WS, 20_000_000);
    await usage(WS, 'crew_run', 12_500_000);
    await usage(WS, 'artifact_summary', 3_500_000);
    const b = await (await handleGetWorkspaceAiLimits(e, user('usr_admin'), WS)).json() as Record<string, any>;
    expect(b).toMatchObject({ month_spend_usd: 16, budget_usd: 20, pct: 80, budget_state: 'near' });
    expect(b.spend_by_kind).toEqual([{ kind: 'crew_run', usd: 12.5 }, { kind: 'artifact_summary', usd: 3.5 }]);
    expect(new Date(b.budget_resets_at).getUTCDate()).toBe(1);
    expect(b.members).toBeDefined();
  });

  it('a member sees the budget state but only their own row and no per-kind breakdown', async () => {
    await setBudget(WS, 20_000_000);
    await usage(WS, 'crew_run', 1_000_000);
    const b = await (await handleGetWorkspaceAiLimits(e, user('usr_m'), WS)).json() as Record<string, any>;
    expect(b).toMatchObject({ month_spend_usd: 1, budget_usd: 20, budget_state: 'ok' });
    expect(b.members).toBeUndefined();
    expect(b.spend_by_kind).toBeUndefined();
    expect(b.me).toBeDefined();
  });

  it('reports a null budget when none is set', async () => {
    const b = await (await handleGetWorkspaceAiLimits(e, user('usr_admin'), WS)).json() as Record<string, any>;
    expect(b).toMatchObject({ budget_usd: null, pct: null, budget_state: 'none' });
  });
});
