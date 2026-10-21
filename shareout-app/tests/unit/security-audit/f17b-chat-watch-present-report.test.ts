// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';

const h = vi.hoisted(() => ({ present: 0, tickets: 0 }));
vi.mock('../../../src/present/present-artifact', () => ({
  presentArtifact: async () => { h.present++; return { ok: true, artifact_id: 'art_new', url: 'https://x.test/a/new' }; },
}));
vi.mock('../../../src/support/intake', () => ({
  openTicket: async () => { h.tickets++; return { id: `tk_${h.tickets}` }; },
}));

import { watchMetricTool } from '../../../src/chat-agent/tools/watch-metric';
import { presentArtifactTool } from '../../../src/chat-agent/tools/present-artifact';
import { reportProblemTool } from '../../../src/chat-agent/tools/report-problem';
import { executeAction, describeAction, describeActionRich, type PendingAction } from '../../../src/chat-agent/actions';

const store = new Map<string, string>();
const kv = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v), delete: async (k: string) => void store.delete(k) };
const e = { ...baseEnv, RATE_LIMIT_KV: kv } as unknown as Env;
const ART = 'art_f17b';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_f17b', 'f17b@x.test')"),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'Dash', 'f17b', 'usr_f17b', 'private')").bind(ART),
  ]);
});

describe('f17b watch_metric / present_artifact / report_problem', () => {
  it('blocks: present_artifact only proposes; nothing is generated until confirmed', async () => {
    h.present = 0;
    const out = await presentArtifactTool.execute({ env: e, userId: 'usr_f17b' }, { artifact_id: ART });
    expect(out).toMatchObject({ __propose: { kind: 'present_artifact', artifactId: ART } });
    expect(h.present).toBe(0);
    const action = (out as { __propose: PendingAction }).__propose;
    expect(describeAction(action)).toContain('Dash');
    expect(describeActionRich(action).title).toBeTruthy();
    expect(await executeAction(e, 'usr_f17b', action)).toContain('https://x.test/a/new');
    expect(h.present).toBe(1);
  });

  it('blocks: watch_metric only proposes; no watch row exists until confirmed', async () => {
    const out = await watchMetricTool.execute({ env: e, userId: 'usr_f17b' }, { artifact_id: ART, table: 'T', kind: 'count' });
    expect(out).toMatchObject({ __propose: { kind: 'watch_metric', artifactId: ART } });
    const n = await e.DB.prepare('SELECT COUNT(*) AS n FROM metric_watches WHERE artifact_id = ?').bind(ART).first<{ n: number }>();
    expect(n!.n).toBe(0);
    const action = (out as { __propose: PendingAction }).__propose;
    expect(describeAction(action)).toContain('T');
    expect(describeActionRich(action).title).toBeTruthy();
  });

  it('blocks: report_problem is rate-limited per user', async () => {
    h.tickets = 0;
    const results: unknown[] = [];
    for (let i = 0; i < 12; i++) results.push(await reportProblemTool.execute({ env: e, userId: 'usr_f17b' }, { summary: 's', details: 'd' }));
    expect(h.tickets).toBeLessThan(12);
    expect(results.some((r) => (r as { error?: string }).error)).toBe(true);
    const other = await reportProblemTool.execute({ env: e, userId: 'usr_other' }, { summary: 's', details: 'd' });
    expect(other).toMatchObject({ ok: true });
  });
});
