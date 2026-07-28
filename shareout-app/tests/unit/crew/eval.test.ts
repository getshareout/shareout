// Eval harness: drive a crew with a deterministic scripted provider and assert
// the observed tool-call sequence. Uses the real env.DB (migrations applied) +
// MINIDB binding from wrangler.toml — no live model.
import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { createMiniDb } from '../../../src/data/minidb-client';
import { mockProvider, runEval } from '../../../src/crew/eval';
import type { CrewRow, CrewRunRow } from '../../../src/crew/types';
import type { DataContext } from '../../../src/data/middleware';

// The workers test pool doesn't apply D1 schema migrations, so create the
// tables the run loop touches here (mirrors migrations 0035/0045). Minimal but
// column-complete for the executeCrewRun path.
beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, name TEXT, visibility TEXT)`,
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT,
       instructions TEXT, model TEXT, status TEXT, max_iterations INTEGER, max_tokens_per_call INTEGER,
       run_budget_micro_usd INTEGER, max_runtime_ms INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS crew_grants (crew_id TEXT, tool_name TEXT, mode TEXT, enabled INTEGER, approval_policy TEXT, limits_json TEXT, PRIMARY KEY (crew_id, tool_name))`,
    `CREATE TABLE IF NOT EXISTS crew_runs (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, trigger_kind TEXT, initiated_by TEXT,
       status TEXT, termination_reason TEXT, input_json TEXT, result_text TEXT, iterations INTEGER DEFAULT 0,
       token_input INTEGER DEFAULT 0, token_output INTEGER DEFAULT 0, cost_micro_usd INTEGER DEFAULT 0,
       started_at TEXT DEFAULT (datetime('now')), ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_run_events (id TEXT PRIMARY KEY, run_id TEXT, crew_id TEXT, seq INTEGER, event_type TEXT,
       tool_name TEXT, input_json TEXT, output_json TEXT, token_input INTEGER, token_output INTEGER, latency_ms INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_action_approvals (id TEXT PRIMARY KEY, crew_id TEXT, run_id TEXT, artifact_id TEXT, tool_name TEXT,
       input_json TEXT, status TEXT DEFAULT 'pending', result_json TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS agent_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, artifact_id TEXT, conversation_id TEXT,
       mode TEXT, provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, base_cost_micro_usd INTEGER,
       billed_cost_micro_usd INTEGER, byo INTEGER, crew_id TEXT, run_id TEXT, trigger_kind TEXT, tool_name TEXT, created_at TEXT)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
});

let n = 0;

async function seedCrew(grants: Array<{ name: string; mode: 'read' | 'write'; approval?: string }>): Promise<{
  crew: CrewRow;
  run: CrewRunRow;
  ownerCtx: DataContext;
}> {
  n++;
  const crewId = `crew_eval_${n}`;
  const artifactId = `art_eval_${n}`;
  const runId = `crun_eval_${n}`;

  await env.DB.prepare(
    `INSERT INTO crews (id, artifact_id, workspace_id, owner_id, name, instructions, model, status,
       max_iterations, max_tokens_per_call, run_budget_micro_usd, max_runtime_ms)
     VALUES (?, ?, NULL, 'usr_eval', 'Eval crew', 'Do the task.', 'mock-model', 'active', 8, 4096, 250000, 25000)`
  ).bind(crewId, artifactId).run();

  for (const g of grants) {
    await env.DB.prepare(
      `INSERT INTO crew_grants (crew_id, tool_name, mode, enabled, approval_policy, limits_json)
       VALUES (?, ?, ?, 1, ?, NULL)`
    ).bind(crewId, g.name, g.mode, g.approval ?? 'never').run();
  }

  await env.DB.prepare(
    `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status) VALUES (?, ?, ?, 'manual', 'running')`
  ).bind(runId, crewId, artifactId).run();

  const crew = await env.DB.prepare('SELECT * FROM crews WHERE id = ?').bind(crewId).first<CrewRow>();
  const run = await env.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind(runId).first<CrewRunRow>();

  const ownerCtx: DataContext = {
    artifactId,
    workspaceId: '',
    artifact: { id: artifactId, name: 'Eval', visibility: 'private', auth_method: null, workspace_id: null },
    db: createMiniDb(env as never, artifactId, ''),
    env: env as never,
    origin: null,
    viewerScope: null,
  };

  return { crew: crew!, run: run!, ownerCtx };
}

describe('crew eval harness', () => {
  it('passes when the crew calls the expected tool and avoids the forbidden one', async () => {
    const { crew, run, ownerCtx } = await seedCrew([{ name: 'table_query', mode: 'read' }]);

    const result = await runEval(env as never, {
      crew,
      run,
      ownerCtx,
      input: 'Read the data.',
      provider: mockProvider([
        { toolCalls: [{ name: 'table_query', input: { table: 'anything' } }] },
        { toolCalls: [{ name: 'finish', input: { summary: 'done' } }] },
      ]),
      expectTools: ['table_query'],
      forbidTools: ['email_send'],
    });

    expect(result.passed).toBe(true);
    expect(result.calledTools).toContain('table_query');
    expect(result.terminationReason).toBe('goal_met');
  });

  it('fails when the crew calls a forbidden tool', async () => {
    const { crew, run, ownerCtx } = await seedCrew([{ name: 'table_query', mode: 'read' }]);

    const result = await runEval(env as never, {
      crew,
      run,
      ownerCtx,
      input: 'Read the data.',
      provider: mockProvider([
        { toolCalls: [{ name: 'email_send', input: { subject: 'x', text: 'y' } }] },
        { toolCalls: [{ name: 'finish', input: { summary: 'done' } }] },
      ]),
      expectTools: ['table_query'],
      forbidTools: ['email_send'],
    });

    expect(result.passed).toBe(false);
    expect(result.forbiddenHit).toContain('email_send');
    expect(result.missing).toContain('table_query');
  });
});
