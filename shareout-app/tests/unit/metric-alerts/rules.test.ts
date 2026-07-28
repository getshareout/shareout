import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

// Mock the data/permission collaborators so we can unit-test the rule engine
// (threshold, cooldown, access, delivery) without a real artifact store.
const resolveAlertRole = vi.hoisted(() => vi.fn());
const getArtifactRef = vi.hoisted(() => vi.fn());
const getDefinition = vi.hoisted(() => vi.fn());
const evaluateMetric = vi.hoisted(() => vi.fn());
const getDestination = vi.hoisted(() => vi.fn());
const runCrewForArtifact = vi.hoisted(() => vi.fn());

vi.mock('../../../src/metric-alerts/access', () => ({ resolveAlertRole, getArtifactRef }));
vi.mock('../../../src/metric-alerts/definitions', () => ({ getDefinition }));
vi.mock('../../../src/metric-alerts/sources', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/metric-alerts/sources')>();
  return { ...actual, evaluateMetric }; // keep the real evaluateCondition
});
vi.mock('../../../src/delivery/registry', () => ({ getDestination }));
vi.mock('../../../src/crew/dispatch', () => ({ runCrewForArtifact }));
vi.mock('../../../src/crypto-utils', () => ({ generateId: (p: string) => `${p}_test` }));

import { evaluateAndDeliver, createRule, runDueMetricAlerts } from '../../../src/metric-alerts/rules';
import type { MetricAlertRule } from '../../../src/metric-alerts/types';

// env.DB double routed by SQL substring → { first, all, run } with spies.
function routedDb(handlers: { match: string; first?: unknown; all?: unknown[] }[]) {
  const runSpy = vi.fn(async () => ({ meta: { changes: 1 } }));
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => handlers.find((h) => sql.includes(h.match) && 'first' in h)?.first ?? null),
        all: vi.fn(async () => ({ results: handlers.find((h) => sql.includes(h.match) && 'all' in h)?.all ?? [] })),
        run: runSpy,
      })),
    })),
  };
  return { db, runSpy };
}

function makeRule(overrides: Partial<MetricAlertRule> = {}): MetricAlertRule {
  return {
    id: 'alert_1',
    artifact_id: 'art_1',
    workspace_id: 'ws_1',
    metric_id: 'revenue',
    owner_id: 'user_1',
    name: 'Revenue dropped',
    condition: { op: 'lt', value: 100000 },
    schedule: '0 * * * *',
    destination_kind: 'slack',
    destination_config: { connection: 'team', targetType: 'dm', slackUserId: 'U1', mode: 'message' },
    message: null,
    cooldown_seconds: 86400,
    next_run_at: 0,
    last_evaluated_at: null,
    last_value: null,
    last_triggered_at: null,
    last_triggered_value: null,
    last_status: null,
    last_error: null,
    enabled: true,
    on_trigger: null,
    created_at: 0,
    ...overrides,
  };
}

const definition = {
  id: 'met_1', artifact_id: 'art_1', workspace_id: 'ws_1', metric_id: 'revenue',
  label: 'Revenue', format: 'currency:USD', source: { type: 'json_path' as const, key: 'metrics', path: '$.revenue' },
  created_by: 'user_1', created_at: 0, updated_at: 0,
};

beforeEach(() => {
  resolveAlertRole.mockReset();
  getArtifactRef.mockReset();
  getDefinition.mockReset();
  evaluateMetric.mockReset();
  getDestination.mockReset();
  runCrewForArtifact.mockReset();
  resolveAlertRole.mockResolvedValue('manager');
  getDefinition.mockResolvedValue(definition);
  runCrewForArtifact.mockResolvedValue({ ok: true, runId: 'crun_1', resultText: 'done' });
});

afterEach(() => vi.restoreAllMocks());

describe('evaluateAndDeliver', () => {
  it('delivers when the condition matches and cooldown allows', async () => {
    const deliver = vi.fn(async () => ({ success: true }));
    getDestination.mockReturnValue({ deliver });
    evaluateMetric.mockResolvedValue({ value: 92420 }); // < 100000 → matched

    const { db, runSpy } = routedDb([]);
    const outcome = await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule(), 'cron');

    expect(outcome).toMatchObject({ matched: true, delivered: true, value: 92420 });
    expect(deliver).toHaveBeenCalledOnce();
    // finalize wrote an UPDATE + an event INSERT.
    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it('runs the crew after delivery when on_trigger.crew is set', async () => {
    getDestination.mockReturnValue({ deliver: vi.fn(async () => ({ success: true })) });
    evaluateMetric.mockResolvedValue({ value: 50 });
    const { db } = routedDb([]);
    await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule({ on_trigger: { crew: true } }), 'cron');
    expect(runCrewForArtifact).toHaveBeenCalledWith(expect.anything(), 'art_1', expect.stringContaining('Revenue'), 'user_1', 'metric_alert');
  });

  it('delivers the crew summary back to the alert channel', async () => {
    const deliver = vi.fn(async () => ({ success: true }));
    getDestination.mockReturnValue({ deliver });
    evaluateMetric.mockResolvedValue({ value: 50 });
    runCrewForArtifact.mockResolvedValue({ ok: true, runId: 'crun_1', resultText: 'Signups fell after the pricing change.' });
    const { db } = routedDb([]);
    await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule({ on_trigger: { crew: true } }), 'cron');
    // First deliver = the alert; second = the crew summary.
    expect(deliver).toHaveBeenCalledTimes(2);
    const followup = deliver.mock.calls[1][2] as { customMessage?: string; mode?: string };
    expect(followup.customMessage).toContain('Crew investigation');
    expect(followup.customMessage).toContain('Signups fell');
    expect(followup.mode).toBe('message');
  });

  it('does not run the crew when on_trigger is unset', async () => {
    getDestination.mockReturnValue({ deliver: vi.fn(async () => ({ success: true })) });
    evaluateMetric.mockResolvedValue({ value: 50 });
    const { db } = routedDb([]);
    await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule(), 'cron');
    expect(runCrewForArtifact).not.toHaveBeenCalled();
  });

  it('does not run the crew when matched but suppressed by cooldown (no delivery)', async () => {
    getDestination.mockReturnValue({ deliver: vi.fn() });
    evaluateMetric.mockResolvedValue({ value: 50 });
    const nowMs = Date.now();
    const { db } = routedDb([]);
    await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule({ on_trigger: { crew: true }, last_triggered_at: new Date(nowMs - 10_000).toISOString(), cooldown_seconds: 86400 }), 'cron');
    expect(runCrewForArtifact).not.toHaveBeenCalled();
  });

  it('injects the alert message into the slack config', async () => {
    const deliver = vi.fn(async () => ({ success: true }));
    getDestination.mockReturnValue({ deliver });
    evaluateMetric.mockResolvedValue({ value: 50 });

    const { db } = routedDb([]);
    await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule(), 'cron');

    const config = deliver.mock.calls[0][2] as { customMessage?: string };
    expect(config.customMessage).toContain('Revenue');
  });

  it('does not deliver when the condition is not met', async () => {
    const deliver = vi.fn();
    getDestination.mockReturnValue({ deliver });
    evaluateMetric.mockResolvedValue({ value: 150000 }); // not < 100000

    const { db } = routedDb([]);
    const outcome = await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule(), 'cron');

    expect(outcome).toMatchObject({ matched: false, delivered: false });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('suppresses delivery while inside the cooldown window', async () => {
    const deliver = vi.fn();
    getDestination.mockReturnValue({ deliver });
    evaluateMetric.mockResolvedValue({ value: 50 });
    const nowMs = Date.now();

    const { db } = routedDb([]);
    const rule = makeRule({ last_triggered_at: new Date(nowMs - 100_000).toISOString(), cooldown_seconds: 86400 });
    const outcome = await evaluateAndDeliver({ DB: db } as unknown as Env, rule, 'cron');

    expect(outcome).toMatchObject({ matched: true, delivered: false });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('fails closed and disables when the creator lost access', async () => {
    resolveAlertRole.mockResolvedValue(null); // access revoked
    const deliver = vi.fn();
    getDestination.mockReturnValue({ deliver });

    const { db } = routedDb([]);
    const outcome = await evaluateAndDeliver({ DB: db } as unknown as Env, makeRule(), 'cron');

    expect(outcome.disable).toBe(true);
    expect(evaluateMetric).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('createRule viewer self-delivery', () => {
  beforeEach(() => {
    getArtifactRef.mockResolvedValue({ id: 'art_1', workspace_id: 'ws_1' });
    getDestination.mockReturnValue({ validate: async () => null, deliver: async () => ({ success: true }) });
    resolveAlertRole.mockResolvedValue('viewer');
  });

  const baseReq = {
    artifact_id: 'art_1',
    metric_id: 'revenue',
    name: 'My alert',
    condition: { op: 'lt' as const, value: 100000 },
    schedule: '0 * * * *',
    message: undefined,
  };

  it('rejects a viewer trying to deliver to a Slack channel', async () => {
    const { db } = routedDb([
      { match: 'COUNT(*) AS n FROM metric_alert_rules WHERE artifact_id', first: { n: 0 } },
    ]);
    const result = await createRule({ DB: db } as unknown as Env, 'user_1', {
      ...baseReq,
      destination: { kind: 'slack', config: { targetType: 'channel', channelId: 'C123' } },
    });
    expect(result.error).toMatch(/DM to themselves/i);
  });

  it('allows a viewer to deliver an email to their own address', async () => {
    const { db } = routedDb([
      { match: 'SELECT email FROM users', first: { email: 'me@example.com' } },
      { match: 'COUNT(*) AS n FROM metric_alert_rules WHERE artifact_id', first: { n: 0 } },
      { match: 'COUNT(*) AS n FROM metric_alert_rules WHERE owner_id', first: { n: 0 } },
      { match: 'SELECT * FROM metric_alert_rules WHERE id', first: { ...makeRule(), condition_json: JSON.stringify({ op: 'lt', value: 100000 }), destination_config: '{}' } },
    ]);
    const result = await createRule({ DB: db } as unknown as Env, 'user_1', {
      ...baseReq,
      destination: { kind: 'email', config: { recipients: ['me@example.com'] } },
    });
    expect(result.error).toBeUndefined();
    expect(result.rule).toBeDefined();
  });

  it('rejects a viewer trying to enable crew-following', async () => {
    const { db } = routedDb([
      { match: 'SELECT email FROM users', first: { email: 'me@example.com' } },
      { match: 'COUNT(*) AS n FROM metric_alert_rules WHERE artifact_id', first: { n: 0 } },
      { match: 'COUNT(*) AS n FROM metric_alert_rules WHERE owner_id', first: { n: 0 } },
    ]);
    const result = await createRule({ DB: db } as unknown as Env, 'user_1', {
      ...baseReq,
      destination: { kind: 'email', config: { recipients: ['me@example.com'] } },
      on_trigger: { crew: true },
    });
    expect(result.error).toMatch(/owners\/editors/i);
  });
});

describe('fetchHistories', () => {
  it('groups recent values per rule, oldest→newest', async () => {
    const { db } = routedDb([
      { match: 'FROM metric_alert_runs', all: [
        { rule_id: 'a', value: 1 }, { rule_id: 'b', value: 9 }, { rule_id: 'a', value: 2 },
      ] },
    ]);
    const { fetchHistories } = await import('../../../src/metric-alerts/rules');
    const h = await fetchHistories({ DB: db } as unknown as Env, ['a', 'b']);
    expect(h.a).toEqual([1, 2]);
    expect(h.b).toEqual([9]);
  });

  it('returns {} when given no rule ids (no query)', async () => {
    const { fetchHistories } = await import('../../../src/metric-alerts/rules');
    expect(await fetchHistories({} as Env, [])).toEqual({});
  });
});

describe('listRulesForOwner', () => {
  it("returns the user's rules across artifacts", async () => {
    const { db } = routedDb([
      { match: 'WHERE owner_id = ?', all: [
        { ...makeRule(), condition_json: JSON.stringify({ op: 'lt', value: 1 }), destination_config: '{}' },
      ] },
    ]);
    const { listRulesForOwner } = await import('../../../src/metric-alerts/rules');
    const rules = await listRulesForOwner({ DB: db } as unknown as Env, 'user_1');
    expect(rules).toHaveLength(1);
    expect(rules[0].owner_id).toBe('user_1');
  });
});

describe('runDueMetricAlerts', () => {
  it('evaluates due rules and advances next_run_at', async () => {
    const deliver = vi.fn(async () => ({ success: true }));
    getDestination.mockReturnValue({ deliver });
    evaluateMetric.mockResolvedValue({ value: 50 });

    const dueRow = { ...makeRule(), condition_json: JSON.stringify({ op: 'lt', value: 100000 }), destination_config: JSON.stringify(makeRule().destination_config), enabled: 1 };
    const { db, runSpy } = routedDb([
      { match: 'WHERE enabled = 1 AND next_run_at', all: [dueRow] },
    ]);

    const result = await runDueMetricAlerts({ DB: db } as unknown as Env);
    expect(result.evaluated).toBe(1);
    expect(result.triggered).toBe(1);
    // advanced next_run_at via an UPDATE (plus finalize's UPDATE + event INSERT).
    expect(runSpy).toHaveBeenCalled();
  });
});
