// @vitest-environment node
//
// Metric alerts and watches read every row of an artifact's store, so on an artifact with a
// row-level access policy their values belong only to callers the policy does not scope: the
// owner and owner/editor collaborators. Access matrix across create / update / run / list.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ deliver: vi.fn(async () => ({ success: true })) }));
vi.mock('../../../src/delivery/registry', () => ({
  getDestination: () => ({ kind: 'webhook', validate: async () => null, deliver: h.deliver }),
}));
vi.mock('../../../src/metric-alerts/sources', async (orig) => ({ ...(await orig<object>()), evaluateMetric: async () => ({ value: 42 }) }));

import { applyMigrations, e } from '../helpers/migrated-db';
import {
  createRule, updateRule, runRuleManually, listRulesForArtifact, listRulesForOwner, getRule, getRuleEvents, getRuleById, runDueMetricAlerts,
} from '../../../src/metric-alerts/rules';
import { createWatch, listWatches } from '../../../src/metric-watch/watches';
import { ROW_SCOPED_ERROR, policyScopesViewer, rowScopedArtifacts } from '../../../src/metric-alerts/row-scope';
import {
  handleGetWorkspaceAlertEvents, handleListWorkspaceAlerts, handleRunWorkspaceAlert,
} from '../../../src/router/api/workspace-metric-alerts';
import { handleGetWorkspaceRun } from '../../../src/router/api/workspace-jobs';
import type { AuthUser } from '../../../src/api-auth';

const WS = 'wsp_rps';
const POL = 'art_rps_pol';
const OPEN = 'art_rps_open';
const POLICY = JSON.stringify({ version: 1, field: 'client', default: 'deny', rules: [{ match: { email: 'rps-a@x.test' }, values: ['A'] }] });
const u = {
  owner: { id: 'usr_rps_owner', email: 'rps-owner@x.test' },
  editor: { id: 'usr_rps_editor', email: 'rps-editor@x.test' },
  admin: { id: 'usr_rps_admin', email: 'rps-admin@x.test' }, // workspace admin, no collaborator row
  member: { id: 'usr_rps_a', email: 'rps-a@x.test' }, // the policy shows this member client A only
  denied: { id: 'usr_rps_b', email: 'rps-b@x.test' }, // no rule: default deny
  guest: { id: 'usr_rps_guest', email: 'rps-guest@x.test' }, // external member, no grant
};
const auth = (x: { id: string; email: string }): AuthUser => ({ id: x.id, email: x.email, username: null });

const req = (artifact_id: string, destination: { kind: 'webhook' | 'email'; config: Record<string, unknown> } = { kind: 'webhook', config: { url: 'https://hooks.example.test/x' } }) => ({
  artifact_id, metric_id: 'rows', name: 'Rows', condition: { op: 'gt' as const, value: 0 }, schedule: '0 * * * *', destination,
});
const selfEmail = (artifact_id: string, email: string) => req(artifact_id, { kind: 'email', config: { recipients: [email] } });

const PAST = '2026-01-01T00:00:00.000Z';
function seedRule(id: string, artifactId: string, ownerId: string, kind = 'webhook', config: unknown = { url: 'https://hooks.example.test/x' }) {
  return e.DB.prepare(
    `INSERT INTO metric_alert_rules (id, artifact_id, workspace_id, metric_id, owner_id, name, condition_json, schedule,
       destination_kind, destination_config, next_run_at, last_value, last_triggered_value, enabled)
     VALUES (?, ?, ?, 'rows', ?, 'Rows', '{"op":"gt","value":0}', '0 * * * *', ?, ?, ?, 7, 7, 1)`
  ).bind(id, artifactId, WS, ownerId, kind, JSON.stringify(config), '2999-01-01T00:00:00.000Z');
}
function seedRun(id: string, ruleId: string, artifactId: string) {
  return e.DB.prepare(
    `INSERT INTO metric_alert_runs (id, rule_id, artifact_id, metric_id, evaluated_at, value, matched, delivered, destination_kind, message)
     VALUES (?, ?, ?, 'rows', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 7, 1, 1, 'webhook', 'Rows is now 7 (alert threshold: above 0).')`
  ).bind(id, ruleId, artifactId);
}

beforeAll(async () => {
  await applyMigrations();
  const all = Object.values(u);
  await e.DB.batch([
    ...all.map((x) => e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(x.id, x.email)),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'rps-w', ?)").bind(WS, u.owner.id),
    ...([
      [u.owner, 'owner', 'internal'], [u.editor, 'member', 'internal'], [u.admin, 'admin', 'internal'],
      [u.member, 'member', 'internal'], [u.denied, 'member', 'internal'], [u.guest, 'member', 'external'],
    ] as const).map(([x, role, cls], i) => e.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES (?, ?, ?, ?, ?)'
    ).bind(`wm_rps_${i}`, WS, x.id, role, cls)),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, access_policy) VALUES (?, 'Clients', 'rps-pol', ?, ?, 'workspace', ?)").bind(POL, u.owner.id, WS, POLICY),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Open', 'rps-open', ?, ?, 'workspace')").bind(OPEN, u.owner.id, WS),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_rps_ed', ?, ?, 'editor')").bind(POL, u.editor.email),
    ...[POL, OPEN].map((a) => e.DB.prepare(
      `INSERT INTO artifact_metric_definitions (id, artifact_id, workspace_id, metric_id, label, source_json, created_by)
       VALUES (?, ?, ?, 'rows', 'Rows', '{"type":"table_count","table":"T"}', ?)`
    ).bind(`met_rps_${a}`, a, WS, u.owner.id)),
    // Rules that existed before the policy limited their creators.
    seedRule('alert_rps_owner', POL, u.owner.id),
    seedRule('alert_rps_member', POL, u.member.id, 'email', { recipients: [u.member.email] }),
    seedRule('alert_rps_member_pause', POL, u.member.id, 'email', { recipients: [u.member.email] }),
    seedRule('alert_rps_open', OPEN, u.member.id, 'email', { recipients: [u.member.email] }),
    seedRun('mev_rps_1', 'alert_rps_owner', POL),
    seedRun('mev_rps_2', 'alert_rps_member', POL),
    seedRun('mev_rps_3', 'alert_rps_open', OPEN),
    e.DB.prepare(
      `INSERT INTO metric_watches (id, artifact_id, workspace_id, created_by, table_name, metric_kind, column_name, threshold_pct, last_value, enabled)
       VALUES ('mw_rps_1', ?, ?, ?, 'T', 'count', '', 20, 7, 1)`
    ).bind(POL, WS, u.owner.id),
  ]);
});

beforeEach(() => h.deliver.mockClear());

describe('who is scoped', () => {
  it('owner and editor collaborators read every row; members, admins without a grant and outsiders are scoped', async () => {
    const scopedFor = async (x: { id: string }) => [...(await rowScopedArtifacts(e, x.id, [POL, OPEN]))];
    expect(await scopedFor(u.owner)).toEqual([]);
    expect(await scopedFor(u.editor)).toEqual([]);
    for (const x of [u.admin, u.member, u.denied, u.guest]) expect(await scopedFor(x)).toEqual([POL]);
  });
});

describe('create', () => {
  it('owner and editor can follow a metric on a row-policy artifact', async () => {
    expect((await createRule(e, u.owner.id, req(POL))).error).toBeUndefined();
    expect((await createRule(e, u.editor.id, req(POL))).error).toBeUndefined();
  });

  it('scoped members and a scoped workspace admin cannot; an outsider has no access at all', async () => {
    expect(await createRule(e, u.member.id, selfEmail(POL, u.member.email))).toEqual({ error: ROW_SCOPED_ERROR });
    expect(await createRule(e, u.denied.id, selfEmail(POL, u.denied.email))).toEqual({ error: ROW_SCOPED_ERROR });
    expect(await createRule(e, u.admin.id, req(POL))).toEqual({ error: ROW_SCOPED_ERROR });
    expect((await createRule(e, u.guest.id, selfEmail(POL, u.guest.email))).error).toMatch(/no access/);
  });

  it('a member is unrestricted where there is no policy', async () => {
    const made = await createRule(e, u.member.id, selfEmail(OPEN, u.member.email));
    expect(made.error).toBeUndefined();
    expect(made.rule?.owner_id).toBe(u.member.id);
  });

  it('metric watches follow the same rule', async () => {
    expect((await createWatch(e, u.member.id, POL, { table: 'T', kind: 'sum', column: 'n' })).error).toMatch(/denied/i);
    expect((await createWatch(e, u.admin.id, POL, { table: 'T', kind: 'sum', column: 'n' })).error).toMatch(/denied/i);
    expect((await createWatch(e, u.editor.id, POL, { table: 'T', kind: 'sum', column: 'n' })).error).toBeUndefined();
  });
});

describe('run', () => {
  it('owner gets the value; scoped callers are refused before anything is evaluated or delivered', async () => {
    expect((await runRuleManually(e, u.owner.id, 'alert_rps_owner')).outcome?.value).toBe(42);
    h.deliver.mockClear();
    expect(await runRuleManually(e, u.member.id, 'alert_rps_member')).toEqual({ error: ROW_SCOPED_ERROR });
    expect(await runRuleManually(e, u.admin.id, 'alert_rps_owner')).toEqual({ error: ROW_SCOPED_ERROR });
    expect(await runRuleManually(e, u.guest.id, 'alert_rps_owner')).toEqual({ error: 'Permission denied' });
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('an unrestricted member runs their own alert', async () => {
    expect((await runRuleManually(e, u.member.id, 'alert_rps_open')).outcome?.value).toBe(42);
  });

  it('workspace admin run route refuses a scoped admin', async () => {
    const res = await handleRunWorkspaceAlert(e, auth(u.admin), WS, 'alert_rps_owner');
    expect(res.status).toBe(403);
    expect(h.deliver).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  it('a scoped caller may pause but not change or resume an alert', async () => {
    expect(await updateRule(e, u.member.id, 'alert_rps_member', { condition: { op: 'gt', value: 1 } })).toEqual({ error: ROW_SCOPED_ERROR });
    expect(await updateRule(e, u.member.id, 'alert_rps_member', { enabled: true })).toEqual({ error: ROW_SCOPED_ERROR });
    expect(await updateRule(e, u.admin.id, 'alert_rps_owner', { schedule: '5 * * * *' })).toEqual({ error: ROW_SCOPED_ERROR });
    const paused = await updateRule(e, u.member.id, 'alert_rps_member_pause', { enabled: false });
    expect(paused.rule?.enabled).toBe(false);
    expect(paused.rule?.last_value).toBeNull();
    expect(paused.rule?.last_triggered_value).toBeNull();
  });

  it('an editor can change the owner’s alert; an outsider cannot', async () => {
    expect((await updateRule(e, u.editor.id, 'alert_rps_owner', { message: 'check the board' })).rule?.message).toBe('check the board');
    expect(await updateRule(e, u.guest.id, 'alert_rps_owner', { message: 'x' })).toEqual({ error: 'Permission denied' });
  });
});

describe('list and read', () => {
  it('values and history are shown to the owner and hidden from scoped callers', async () => {
    const ownerView = (await listRulesForArtifact(e, u.owner.id, POL)).rules!.find((r) => r.id === 'alert_rps_owner')!;
    expect(ownerView.last_value).not.toBeNull();
    expect(ownerView.history!.length).toBeGreaterThan(0);

    const adminView = (await listRulesForArtifact(e, u.admin.id, POL)).rules!;
    expect(adminView.length).toBeGreaterThan(1); // a manager sees every alert on the artifact…
    for (const r of adminView) expect([r.last_value, r.last_triggered_value, r.history]).toEqual([null, null, []]); // …without values

    const memberView = (await listRulesForArtifact(e, u.member.id, POL)).rules!;
    expect(memberView.map((r) => r.owner_id)).toEqual(memberView.map(() => u.member.id));
    for (const r of memberView) expect([r.last_value, r.history]).toEqual([null, []]);

    expect((await listRulesForArtifact(e, u.guest.id, POL)).error).toBe('Permission denied');
  });

  it("“my alerts” keeps values on unrestricted artifacts only", async () => {
    const mine = await listRulesForOwner(e, u.member.id, WS);
    expect(mine.find((r) => r.id === 'alert_rps_member')?.last_value).toBeNull();
    expect(mine.find((r) => r.id === 'alert_rps_open')?.last_value).not.toBeNull();
  });

  it('single alert and its run log', async () => {
    expect((await getRule(e, u.member.id, 'alert_rps_member')).rule?.last_value).toBeNull();
    expect((await getRule(e, u.owner.id, 'alert_rps_owner')).rule?.last_value).not.toBeNull();
    const scopedEvents = (await getRuleEvents(e, u.member.id, 'alert_rps_member')).events!;
    expect(scopedEvents.length).toBeGreaterThan(0);
    for (const ev of scopedEvents) expect([ev.value, ev.message]).toEqual([null, null]);
    expect((await getRuleEvents(e, u.owner.id, 'alert_rps_owner')).events!.some((ev) => ev.value === 7)).toBe(true);
    expect((await getRuleEvents(e, u.guest.id, 'alert_rps_owner')).error).toBe('Permission denied');
  });

  it('workspace admin list and run log hide values on artifacts that scope the admin', async () => {
    const list = await (await handleListWorkspaceAlerts(e, auth(u.admin), WS)).json() as { alerts: Array<{ id: string; last_value: number | null; history: number[] }> };
    const byId = Object.fromEntries(list.alerts.map((a) => [a.id, a]));
    expect([byId.alert_rps_owner.last_value, byId.alert_rps_owner.history]).toEqual([null, []]);
    expect(byId.alert_rps_open.last_value).not.toBeNull();
    const events = await (await handleGetWorkspaceAlertEvents(e, auth(u.admin), WS, 'alert_rps_owner')).json() as { events: Array<{ value: unknown; message: unknown }> };
    for (const ev of events.events) expect([ev.value, ev.message]).toEqual([null, null]);
  });

  it('Run Inspector shows an alert run’s value to the owner, not to a scoped admin', async () => {
    type Run = { run: { result?: string; steps: Array<{ type: string; output?: { value?: unknown } }> } };
    const view = async (who: { id: string; email: string }) => ((await (await handleGetWorkspaceRun(e, auth(who), WS, 'alert', 'mev_rps_1')).json()) as Run).run;
    const own = await view(u.owner);
    expect(own.steps.find((s) => s.type === 'evaluate')?.output?.value).toBe(7);
    expect(own.result).toContain('7');
    const scoped = await view(u.admin);
    expect(scoped.steps.find((s) => s.type === 'evaluate')?.output?.value).toBeNull();
    expect(scoped.result).toBeUndefined();
  });

  it('metric watch values are hidden from scoped callers', async () => {
    const seeded = (who: { id: string }) => listWatches(e, who.id, POL).then((r) => r.watches!.find((w) => w.id === 'mw_rps_1')!);
    expect((await seeded(u.owner)).last_value).toBe(7);
    expect((await seeded(u.editor)).last_value).toBe(7);
    expect((await seeded(u.member)).last_value).toBeNull();
    expect((await seeded(u.admin)).last_value).toBeNull();
  });
});

describe('evaluation', () => {
  it('fails closed and disables an alert whose creator the policy now scopes; others keep running', async () => {
    await e.DB.prepare("UPDATE metric_alert_rules SET next_run_at = ?, last_triggered_at = NULL WHERE id IN ('alert_rps_owner', 'alert_rps_member')").bind(PAST).run();
    await runDueMetricAlerts(e);
    const member = await getRuleById(e, 'alert_rps_member');
    expect(member?.enabled).toBe(false);
    expect(member?.last_error).toBe('Row access limited');
    expect(member?.last_value).toBeNull();
    const owner = await getRuleById(e, 'alert_rps_owner');
    expect(owner?.enabled).toBe(true);
    expect(owner?.last_value).toBe(42);
    expect(h.deliver).toHaveBeenCalledTimes(1); // the owner's alert only
  });
});

describe('viewer toolbar "Follow"', () => {
  it('is offered unless the policy scopes the viewer', () => {
    expect(policyScopesViewer(POLICY, u.member.email, false)).toBe(true);
    expect(policyScopesViewer(POLICY, 'someone@else.test', false)).toBe(true);
    expect(policyScopesViewer(POLICY, null, false)).toBe(true);
    expect(policyScopesViewer(POLICY, u.editor.email, true)).toBe(false);
    expect(policyScopesViewer(null, u.member.email, false)).toBe(false);
    expect(policyScopesViewer(JSON.stringify({ version: 1, field: 'client', default: 'allow', rules: [] }), u.member.email, false)).toBe(false);
  });
});
