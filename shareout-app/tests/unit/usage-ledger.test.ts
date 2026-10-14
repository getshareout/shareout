import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import initSql from '../../migrations/0000_init.sql?raw';
import ledgerSql from '../../migrations/0010_workspace_usage_daily.sql?raw';
import {
  costMicroUsd,
  daysInMonth,
  gbMonths,
  getDailyUsage,
  getMonthlyUsage,
  monthBounds,
  previousMonth,
  r2KeyOwner,
  recordArtifactUsage,
  rollupWorkspaceUsage,
  usageCsv,
  utcDay,
} from '../../src/workspaces/usage-ledger';
import type { Env } from '../../src/types';

const GB = 1024 ** 3;
const E = env as unknown as Env;

describe('usage-ledger pure helpers', () => {
  it('attributes R2 keys by layout', () => {
    expect(r2KeyOwner('art_ab12/v3/index.html')).toEqual({ artifactId: 'art_ab12' });
    expect(r2KeyOwner('art_ab12/blobs/b1/photo.png')).toEqual({ artifactId: 'art_ab12' });
    expect(r2KeyOwner('inbox/art_ab12/msg/0-a.pdf')).toEqual({ artifactId: 'art_ab12' });
    expect(r2KeyOwner('uploads/art_ab12/ast_1.png')).toEqual({ artifactId: 'art_ab12' });
    expect(r2KeyOwner('thumbnails/art_ab12_card.webp')).toEqual({ artifactId: 'art_ab12' });
    expect(r2KeyOwner('thumbnails/art_ab12.png')).toEqual({ artifactId: 'art_ab12' });
    expect(r2KeyOwner('workspace-logos/ws_9.svg')).toEqual({ workspaceId: 'ws_9' });
    expect(r2KeyOwner('cache/conn_1/abc')).toEqual({ connectionId: 'conn_1' });
    expect(r2KeyOwner('vendor/react@18.3.1/index.js')).toBeNull();
    expect(r2KeyOwner('agent-media/usr_1/tok')).toBeNull();
  });

  it('prices metrics at list rates in micro-USD', () => {
    // 1 GB for one day of a 30-day month = $0.015 / 30
    expect(costMicroUsd('storage_bytes', GB, '2026-09-10')).toBe(500);
    expect(costMicroUsd('email_sent', 1000, '2026-09-10')).toBe(350_000);
    expect(costMicroUsd('browser_seconds', 3600, '2026-09-10')).toBe(90_000);
    expect(costMicroUsd('serving_requests', 1_000_000, '2026-09-10')).toBe(660_000);
    expect(costMicroUsd('ai_llm_tokens', 1_000_000, '2026-09-10')).toBe(0);
  });

  it('handles calendar edges', () => {
    expect(daysInMonth('2026-02-01')).toBe(28);
    expect(daysInMonth('2028-02-15')).toBe(29);
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(previousMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12');
    expect(gbMonths(GB * 30, '2026-09')).toBe(1);
  });

  it('escapes CSV cells and reports storage as GB-months', () => {
    const csv = usageCsv('2026-09', [
      { workspaceId: 'ws_1', name: 'Acme, "Inc"', metric: 'storage_bytes', quantity: GB * 30, costMicroUsd: 15_000 },
      { workspaceId: 'ws_1', name: 'Acme, "Inc"', metric: 'email_sent', quantity: 10, costMicroUsd: 3500 },
    ]);
    expect(csv.split('\n')).toEqual([
      'month,workspace_id,workspace,metric,quantity,cost_usd',
      '2026-09,ws_1,"Acme, ""Inc""",storage_gb_month,1.000000,0.015000',
      '2026-09,ws_1,"Acme, ""Inc""",email_sent,10,0.003500',
      '',
    ]);
  });
});

// The real schema in Miniflare's local D1, so the rollup SQL runs for real.
beforeAll(async () => {
  const sql = `${initSql}\n${ledgerSql}`.replace(/--[^\n]*/g, '');
  const stmts = sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50).map((x) => env.DB.prepare(x)));
  }
});

describe('rollupWorkspaceUsage', () => {
  const day = '2026-09-10';

  const objects = [
    { key: 'art_a1/v1/index.html', size: 1000 },
    { key: 'thumbnails/art_a1_card.webp', size: 200 },
    { key: 'art_b1/blobs/b/x.png', size: 3000 },
    { key: 'cache/conn_1/q', size: 40 },
    { key: 'workspace-logos/ws_b.svg', size: 5 },
    { key: 'art_p1/v1/index.html', size: 7 },
    { key: 'art_gone/v1/index.html', size: 11 },
    { key: 'vendor/x@1/y.js', size: 13 },
  ];

  async function seed() {
    const rows = `
      INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('ws_a', 'Acme', 'acme', 'usr_1'), ('ws_b', 'Beta', 'beta', 'usr_1');
      INSERT INTO artifacts (id, name, slug, owner_id, workspace_id) VALUES
        ('art_a1', 'A1', 'a1', 'usr_1', 'ws_a'),
        ('art_b1', 'B1', 'b1', 'usr_1', 'ws_b'),
        ('art_p1', 'P1', 'p1', 'usr_1', NULL);
      INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, deleted_at) VALUES ('art_gone', 'G', 'g', 'usr_1', 'ws_a', '2026-09-01T00:00:00.000Z');
      INSERT INTO connections (id, scope_type, scope_id, name, provider) VALUES ('conn_1', 'workspace', 'ws_b', 'pg', 'postgres');
      INSERT INTO analytics_events (artifact_id, event_type, visitor_hash, created_at) VALUES
        ('art_a1', 'view', 'v1', '${day}T01:00:00.000Z'),
        ('art_a1', 'view', 'v2', '${day}T23:59:59.999Z'),
        ('art_a1', 'view', 'v3', '2026-09-11T00:00:00.000Z'),
        ('art_p1', 'view', 'v4', '${day}T05:00:00.000Z');
      INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at) VALUES ('job_1', 'art_b1', 'usr_1', 'email', '0 * * * *', '{}', '0');
      INSERT INTO job_runs (id, job_id, created_at, status, duration_ms) VALUES
        ('run_1', 'job_1', '${Date.parse(`${day}T10:00:00Z`) / 1000}', 'success', 1500),
        ('run_2', 'job_1', '${Date.parse('2026-09-09T10:00:00Z') / 1000}', 'success', 9999);
      INSERT INTO agent_usage_events (id, workspace_id, artifact_id, mode, provider, model, input_tokens, output_tokens, base_cost_micro_usd, billed_cost_micro_usd, byo, created_at) VALUES
        ('aue_1', 'ws_a', 'art_a1', 'admin', 'x', 'm', 100, 50, 1200, 1200, 0, '${day}T12:00:00.000Z'),
        ('aue_2', 'ws_a', 'art_a1', 'admin', 'x', 'm', 999, 999, 5000, 0, 1, '${day}T12:00:00.000Z');
      INSERT INTO ai_usage_events (id, workspace_id, kind, model, units, unit_kind, base_cost_micro_usd, created_at) VALUES
        ('aiu_1', 'ws_b', 'whisper_transcribe', 'w', 60, 'audio_seconds', 450, '${day}T08:00:00.000Z')`;
    const reset = ['workspace_usage_daily', 'analytics_events', 'job_runs', 'scheduled_jobs', 'agent_usage_events', 'ai_usage_events',
      'connections', 'artifacts', 'workspaces', 'users'].map((t) => `DELETE FROM ${t}`);
    await env.DB.batch([...reset, `INSERT INTO users (id, email) VALUES ('usr_1', 'o@x.test')`, ...rows.split(';').map((x) => x.trim()).filter(Boolean)]
      .map((x) => env.DB.prepare(x)));
    for (const o of objects) await env.ARTIFACTS.put(o.key, 'x'.repeat(o.size));
  }


  const metrics = async () =>
    Object.fromEntries((await getDailyUsage(E, '2026-09')).map((r) => [`${r.workspaceId}:${r.metric}`, [r.quantity, r.costMicroUsd]]));

  it('rolls one day up per workspace, measuring every R2 key', async () => {
    await seed();
    const res = await rollupWorkspaceUsage(E, day, { measureStorage: true });
    expect(res.unattributedBytes).toBe(7 + 11 + 13);
    expect(res.truncated).toBe(false);
    const m = await metrics();
    expect(m['ws_a:storage_bytes'][0]).toBe(1200);
    expect(m['ws_b:storage_bytes'][0]).toBe(3045);
    expect(m['ws_a:serving_requests'][0]).toBe(2);
    expect(m['ws_b:job_runs'][0]).toBe(1);
    expect(m['ws_b:job_duration_ms'][0]).toBe(1500);
    expect(m['ws_a:ai_llm_tokens']).toEqual([150, 1200]);
    expect(m['ws_b:ai_other_events']).toEqual([1, 450]);
    expect(Object.keys(m).some((k) => k.startsWith('ws_b:serving'))).toBe(false);
  });

  it('is idempotent and leaves live counters alone', async () => {
    await seed();
    await env.DB.prepare(`INSERT INTO workspace_usage_daily (day, workspace_id, metric, quantity, cost_micro_usd) VALUES ('${day}', 'ws_a', 'email_sent', 4, 1400)`).run();
    await rollupWorkspaceUsage(E, day, { measureStorage: true });
    const first = await metrics();
    await rollupWorkspaceUsage(E, day, { measureStorage: false });
    expect(await metrics()).toEqual(first);
    expect(first['ws_a:email_sent']).toEqual([4, 1400]);
  });

  it('records live usage against the artifact workspace, skipping personal artifacts', async () => {
    await seed();
    await recordArtifactUsage(E, 'art_a1', 'email_sent', 3);
    await recordArtifactUsage(E, 'art_a1', 'email_sent', 2);
    await recordArtifactUsage(E, 'art_p1', 'email_sent', 9);
    await recordArtifactUsage(E, 'art_a1', 'browser_seconds', 0);
    const rows = await getMonthlyUsage(E, utcDay().slice(0, 7));
    expect(rows).toEqual([{ workspaceId: 'ws_a', name: 'Acme', metric: 'email_sent', quantity: 5, costMicroUsd: 1750 }]);
  });
});
