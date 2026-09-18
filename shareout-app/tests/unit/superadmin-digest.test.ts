import { describe, expect, it, vi } from 'vitest';
import { getDailyPlatformDigest, defaultReportDate } from '../../src/superadmin/digest';
import { investigatePlatformMetrics } from '../../src/superadmin/digest-investigate';
import { platformMetricsDigestTool } from '../../src/crew/tools/platform-metrics-digest';
import { platformMetricsInvestigateTool } from '../../src/crew/tools/platform-metrics-investigate';
import { SUPERADMIN_EMAILS } from '../../src/superadmin/recipients';

// The shipped roster is empty by design (a public repo must not grant super-admin to a
// baked-in address), so tests that need one mock the roster import.
const testRoster = vi.hoisted(() => ({
  default: {
    recipients: [{ email: 'admin@example.com' }, { email: 'ops@example.com' }],
  },
}));
vi.mock('../../superadmin-recipients.json', () => testRoster);

const SA = SUPERADMIN_EMAILS[0]!;

function crewCtx(env: { DB: D1Database }) {
  return {
    data: {
      env,
      artifactId: 'art1',
      workspaceId: '',
      artifact: {} as never,
      db: {} as never,
      origin: null,
      viewerScope: null,
    },
    principal: { ownerId: 'u1', crewId: 'c1', runId: 'r1', artifactId: 'art1', workspaceId: '' },
    limits: {},
  };
}

function mockDb(email: string) {
  const empty = { results: [] as unknown[] };
  return {
    prepare(sql: string) {
      const chain = {
        bind: (..._args: unknown[]) => chain,
        first: async () => {
          if (sql.includes('FROM users WHERE')) return { email };
          if (sql.includes('health_metrics_hourly')) return { requests: 50, s5: 0, exc: 0, s4: 5, dsum: 2500 };
          if (sql.includes('agent_usage_events') && sql.includes('SUM')) {
            return { tokens: 100, cost: 5000, revenue: 8000, events: 2 };
          }
          if (sql.includes('workspace_llm_config')) return { bal: 1_000_000 };
          if (sql.includes('funnel_events') && sql.includes('DISTINCT sid')) return { sessions: 12 };
          if (sql.includes('analytics_daily') && sql.includes('SUM')) return { views: 0, visitors: 0 };
          if (sql.includes('analytics_events')) return { views: 10, visitors: 4 };
          if (sql.includes('COUNT(*) AS n FROM')) return { n: 5 };
          return { n: 0, views: 0, visitors: 0, v: 0 };
        },
        all: async () => {
          if (sql.includes('funnel_events') && sql.includes('GROUP BY event')) {
            return { results: [{ event: 'view', count: 20 }, { event: 'submit', count: 1 }] };
          }
          if (sql.includes('agent_usage_events') && sql.includes('GROUP BY e.workspace_id')) {
            return { results: [{ name: 'Acme', tokens: 100, costMicro: 5000 }] };
          }
          return empty;
        },
        run: async () => ({ meta: { changes: 0 } }),
      };
      return chain;
    },
  } as unknown as D1Database;
}

describe('defaultReportDate', () => {
  it('returns yesterday UTC', () => {
    expect(defaultReportDate(new Date('2026-06-18T11:00:00.000Z'))).toBe('2026-06-17');
  });
});

describe('getDailyPlatformDigest', () => {
  it('returns executive sections', async () => {
    const env = { DB: mockDb('x@y.com') } as never;
    const digest = await getDailyPlatformDigest(env, '2026-06-17');
    expect(digest.reportDate).toBe('2026-06-17');
    expect(digest.marketing.personal.views).toBe(20);
    expect(digest.productUsage.artifactViews).toBe(10);
    expect(digest.economics.aiRevenueUsd).toBeCloseTo(0.008);
    expect(digest.economics.aiCostUsd).toBeCloseTo(0.005);
    expect(digest.economics.cloudflareAvailable).toBe(false);
    expect(digest.economics.cloudflareUsd).toBe(0);
    expect(digest.economics.totalSpendUsd).toBeCloseTo(0.005);
    expect(digest.economics.mtd.aiCostUsd).toBeCloseTo(0.005);
    expect(digest.economics.mtd.cloudflareAvailable).toBe(false);
    expect(digest.economics.tokenByWorkspace[0]).toEqual({ name: 'Acme', tokens: 100, costUsd: 0.005 });
    expect(Array.isArray(digest.signals)).toBe(true);
  });
});

describe('investigatePlatformMetrics', () => {
  it('returns marketing funnel topic', async () => {
    const env = { DB: mockDb('a@b.co') } as never;
    const result = await investigatePlatformMetrics(env, { topic: 'marketing_funnel', date: '2026-06-17' });
    expect(result.topic).toBe('marketing_funnel');
  });
});

describe('crew tools', () => {
  it('digest rejects non-superadmin', async () => {
    const env = { DB: mockDb('user@example.com') };
    const result = await platformMetricsDigestTool.execute(crewCtx(env), {});
    expect(result).toMatchObject({ error: expect.stringContaining('super-admin') });
  });

  it('investigate works for superadmin', async () => {
    const env = { DB: mockDb(SA) };
    const result = await platformMetricsInvestigateTool.execute(crewCtx(env), {
      topic: 'errors',
    });
    expect(result).toMatchObject({ topic: 'errors' });
  });
});
