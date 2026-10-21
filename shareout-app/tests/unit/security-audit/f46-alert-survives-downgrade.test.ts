// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ deliver: vi.fn(async () => ({ success: true })), crew: vi.fn(async () => ({ ok: true, resultText: 'x' })) }));
vi.mock('../../../src/delivery/registry', () => ({ getDestination: () => ({ kind: 'webhook', validate: async () => null, deliver: h.deliver }) }));
vi.mock('../../../src/crew/dispatch', () => ({ runCrewForArtifact: h.crew }));
vi.mock('../../../src/metric-alerts/definitions', () => ({ getDefinition: async () => ({ id: 'md', metric_id: 'rev', label: 'Rev', source: {} }) }));
vi.mock('../../../src/metric-alerts/sources', async (orig) => ({ ...(await orig<object>()), evaluateMetric: async () => ({ value: 1 }) }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { evaluateAndDeliver } from '../../../src/metric-alerts/rules';
import type { MetricAlertRule } from '../../../src/metric-alerts/types';

const rule = (over: Partial<MetricAlertRule> = {}): MetricAlertRule => ({
  id: 'alert_f46', artifact_id: 'art_f46', workspace_id: null, metric_id: 'rev', owner_id: 'usr_f46_ed', name: 'n',
  condition: { op: 'lt', value: 100 }, schedule: '0 * * * *', destination_kind: 'webhook',
  destination_config: { url: 'https://hooks.example.test/x' }, message: null, cooldown_seconds: 0, next_run_at: 0,
  last_evaluated_at: null, last_value: null, last_triggered_at: null, last_triggered_value: null, last_status: null,
  last_error: null, enabled: true, on_trigger: { crew: true }, created_at: 0, ...over,
}) as MetricAlertRule;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f46_ow', 'ow@example.test', 'o'), ('usr_f46_ed', 'ed@example.test', 'e')"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES ('art_f46', 'usr_f46_ow', 'P', 'f46', 'private')"),
    e.DB.prepare("INSERT INTO metric_alert_rules (id, artifact_id, metric_id, owner_id, name, condition_json, schedule, destination_kind, destination_config, next_run_at, enabled) VALUES ('alert_f46', 'art_f46', 'rev', 'usr_f46_ed', 'n', '{}', '0 * * * *', 'webhook', '{}', 0, 1)"),
  ]);
});

describe('f46 alert rule vs downgraded creator', () => {
  it('blocks: a creator downgraded to viewer no longer delivers to the stored destination or runs the crew', async () => {
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f46', 'art_f46', 'ed@example.test', 'editor')").run();
    const before = await evaluateAndDeliver(e, rule(), 'cron');
    expect(before.delivered).toBe(true);
    expect(h.crew).toHaveBeenCalledTimes(1);
    h.deliver.mockClear(); h.crew.mockClear();

    await e.DB.prepare("UPDATE collaborators SET role = 'viewer' WHERE id = 'col_f46'").run();
    const after = await evaluateAndDeliver(e, rule(), 'cron');
    expect(after.delivered).toBe(false);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.crew).not.toHaveBeenCalled();
  });
});
