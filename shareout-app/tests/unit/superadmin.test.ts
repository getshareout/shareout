import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('../../src/superadmin/metrics', () => ({
  getPlatformMetrics: vi.fn(),
}));

vi.mock('../../src/superadmin/users', () => ({
  listUsers: vi.fn(),
  getUserDetail: vi.fn(),
  setUserTier: vi.fn(),
  revokeUserAccess: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('../../src/superadmin/insights', () => ({
  getCostMetrics: vi.fn(),
  getFunnelMetrics: vi.fn(),
  getOpsMetrics: vi.fn(),
  getStorageMetrics: vi.fn(),
  getWorkspaceCosts: vi.fn(),
}));

vi.mock('../../src/superadmin/artifacts-admin', () => ({
  searchArtifacts: vi.fn(),
  setArtifactPaused: vi.fn(),
  setArtifactVisibility: vi.fn(),
  deleteArtifactAdmin: vi.fn(),
}));

import { getSessionUser } from '../../src/auth';
import { getPlatformMetrics } from '../../src/superadmin/metrics';
import { listUsers, deleteUser } from '../../src/superadmin/users';
import {
  getCostMetrics,
  getFunnelMetrics,
  getOpsMetrics,
  getStorageMetrics,
  getWorkspaceCosts,
} from '../../src/superadmin/insights';
import { searchArtifacts, deleteArtifactAdmin } from '../../src/superadmin/artifacts-admin';
import { handleSuperAdminPage } from '../../src/superadmin/page';
import { isSuperAdminEmail } from '../../src/superadmin/auth';
import { SUPERADMIN_EMAILS } from '../../src/superadmin/recipients';

const SA = SUPERADMIN_EMAILS[0]!;
const SA_ALT = SUPERADMIN_EMAILS[1] ?? SUPERADMIN_EMAILS[0]!;
import { routeAdminApi } from '../../src/router/api/admin';
import { createFetchContext } from '../../src/router/context';
import type { Env } from '../../src/types';

// The shipped roster is empty by design (a public repo must not grant super-admin to a
// baked-in address), so tests that need one mock the roster import.
const testRoster = vi.hoisted(() => ({
  default: {
    recipients: [{ email: 'admin@example.com', telegramChatId: 555000 }, { email: 'ops@example.com' }],
  },
}));
vi.mock('../../superadmin-recipients.json', () => testRoster);

const env = {} as Env;

const emptyMetrics = {
  periodDays: 30,
  totals: { artifacts: 7, users: 3, workspaces: 2, activeUsers30d: 1, views: 1234, uniqueVisitors: 100, tokens: 5000, costUsd: 1.23 },
  deltas: {
    artifacts: { value: 2, pct: 10 },
    users: { value: 1, pct: null },
    views: { value: 1234, pct: -5 },
    tokens: { value: 5000, pct: 0 },
  },
  artifacts: { byType: [], byVisibility: [], createdDaily: [], topByViews: [], recent: [] },
  traffic: { viewsDaily: [], visitorsDaily: [], topCountries: [], topReferrers: [] },
  tokens: { byModel: [], daily: [], topWorkspaces: [] },
  usersGrowthDaily: [],
};

const emptyCosts = {
  periodDays: 30, llmCostUsd: 8, storageBytes: 0, storageCostUsd: 0,
  infra: { available: false, reason: 'not configured', periodDays: 30, workersRequests: 0, d1RowsRead: 0, d1RowsWritten: 0, r2ClassA: 0, r2ClassB: 0, kvReads: 0, kvWrites: 0, lines: [], totalUsd: 0 },
  infraTotalUsd: 0, totalCostUsd: 8, overBudget: [],
};
const emptyFunnel = { periodDays: 30, steps: [], conversionPct: 0, submitDaily: [] };
const emptyOps = { totalJobs: 0, enabledJobs: 0, failingJobs: 0, recentFailures: [] };
const emptyStorage = { totalBytes: 0, totalGb: 0, byType: [], topArtifacts: [] };

const blankCostRow = {
  workspaceId: null, name: '', storageBytes: 0, servedRequests: 0, jobRuns: 0, jobCpuMs: 0, tokens: 0,
  storageUsd: 0, servingUsd: 0, automationUsd: 0, aiUsd: 0, totalUsd: 0,
  costDeltaUsd: 0,
};
const sampleCosts = {
  days: 30,
  egressTracked: false,
  rows: [
    // unprofitable: cost 4.41 > revenue 0 (free-tier burner), worsening
    { ...blankCostRow, workspaceId: 'wsp_free', name: 'FreeBurner', storageBytes: 12_884_901_888, servedRequests: 45000, tokens: 0, storageUsd: 0.18, servingUsd: 0.03, aiUsd: 4.2, totalUsd: 4.41, costDeltaUsd: 1.25 },
    // profitable: revenue 6.50 > cost 5.20, improving
    { ...blankCostRow, workspaceId: 'wsp_acme', name: 'Acme', storageBytes: 1_000_000, servedRequests: 1000, tokens: 1_200_000, storageUsd: 0.0, servingUsd: 0.0, aiUsd: 5.0, totalUsd: 5.2, costDeltaUsd: -0.8 },
  ],
  totals: { ...blankCostRow, name: 'All workspaces', storageBytes: 12_885_901_888, servedRequests: 46000, tokens: 1_200_000, storageUsd: 0.18, servingUsd: 0.03, aiUsd: 9.2, totalUsd: 9.61, costDeltaUsd: 0.45 },
};

function stubDashboard() {
  vi.mocked(getPlatformMetrics).mockResolvedValue(emptyMetrics as any);
  vi.mocked(getCostMetrics).mockResolvedValue(emptyCosts as any);
  vi.mocked(getFunnelMetrics).mockResolvedValue(emptyFunnel as any);
  vi.mocked(getOpsMetrics).mockResolvedValue(emptyOps as any);
  vi.mocked(getStorageMetrics).mockResolvedValue(emptyStorage as any);
  vi.mocked(getWorkspaceCosts).mockResolvedValue(sampleCosts as any);
  vi.mocked(listUsers).mockResolvedValue({ users: [], total: 3 });
  vi.mocked(searchArtifacts).mockResolvedValue({ artifacts: [], total: 9 });
}

afterEach(() => vi.clearAllMocks());

describe('isSuperAdminEmail', () => {
  it('accepts allowlisted emails case-insensitively', () => {
    expect(isSuperAdminEmail(SA)).toBe(true);
    expect(isSuperAdminEmail(SA.toUpperCase())).toBe(true);
    expect(isSuperAdminEmail(SA_ALT)).toBe(true);
  });
  it('rejects everyone else', () => {
    expect(isSuperAdminEmail('someone@else.com')).toBe(false);
    expect(isSuperAdminEmail(null)).toBe(false);
  });
});

describe('handleSuperAdminPage', () => {
  it('gates anonymous visitors with 403', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const res = await handleSuperAdminPage(new Request('https://shareout.site/admin'), env);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Admin access required');
  });

  it('gates non-owner sessions with 403', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: 'nope@x.com' });
    const res = await handleSuperAdminPage(new Request('https://shareout.site/admin'), env);
    expect(res.status).toBe(403);
  });

  it('renders the overview view with sidebar nav for a platform owner', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    stubDashboard();
    const res = await handleSuperAdminPage(new Request('https://shareout.site/admin'), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('1,234'); // total views formatted (overview stats)
    expect(html).toContain('class="sa-sidebar"'); // sidebar present
    expect(html).toContain('Instance cost'); // overview snapshot card
    // sidebar nav links to the other views
    expect(html).toContain('?view=costs');
    expect(html).toContain('?view=users');
    expect(html).toContain('?view=moderation');
    expect(html).toContain('Costs'); // nav label
  });

  it('renders the costs view with the infra note', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    stubDashboard();
    const res = await handleSuperAdminPage(new Request('https://shareout.site/admin?view=costs'), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('AI cost (providers)');
    expect(html).toContain('Cloudflare request'); // infra-not-configured note
    // costs view only fetches cost metrics, not the full metrics batch
    expect(vi.mocked(getPlatformMetrics)).not.toHaveBeenCalled();
  });

  it('renders the cost-by-workspace view with per-workspace cost and trend', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    stubDashboard();
    const res = await handleSuperAdminPage(new Request('https://shareout.site/admin?view=workspace-costs'), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Cost by workspace'); // nav label + title
    expect(html).toContain('Acme');
    expect(html).toContain('FreeBurner');
    expect(html).toContain('$4.41'); // the burner's total cost
    expect(html).toContain('Trend'); // trend column header
    expect(html).toContain('▲ $1.25'); // FreeBurner getting more expensive
    expect(html).toContain('▼ -$0.80'); // Acme getting cheaper
    expect(html).toContain("Cloudflare doesn't bill it"); // egress note reframed
    expect(vi.mocked(getWorkspaceCosts)).toHaveBeenCalled();
    expect(vi.mocked(getPlatformMetrics)).not.toHaveBeenCalled();
  });

  it('passes calendar range modifiers (MTD) through to the cost query', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    stubDashboard();
    await handleSuperAdminPage(new Request('https://shareout.site/admin?view=workspace-costs&range=mtd'), env);
    expect(vi.mocked(getWorkspaceCosts)).toHaveBeenCalledWith(env, 'start of month', 30);
  });

  it('renders the users view and fetches the user list', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    stubDashboard();
    const res = await handleSuperAdminPage(new Request('https://shareout.site/admin?view=users'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('sa-user-search');
    expect(vi.mocked(listUsers)).toHaveBeenCalled();
  });

  it('honors the range query param on overview', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    stubDashboard();
    await handleSuperAdminPage(new Request('https://shareout.site/admin?range=7'), env);
    expect(vi.mocked(getPlatformMetrics)).toHaveBeenCalledWith(env, 7);
    expect(vi.mocked(getCostMetrics)).toHaveBeenCalledWith(env, 7);
  });
});

describe('routeAdminApi', () => {
  it('returns null for non-admin paths', async () => {
    const ctx = createFetchContext(new Request('https://shareout.site/v1/artifacts'), env);
    expect(await routeAdminApi(ctx)).toBeNull();
  });

  it('blocks non-owners with 403 JSON', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const ctx = createFetchContext(new Request('https://shareout.site/v1/admin/users'), env);
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(403);
  });

  it('lists users for an owner', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    vi.mocked(listUsers).mockResolvedValue({ users: [], total: 0 });
    const ctx = createFetchContext(new Request('https://shareout.site/v1/admin/users?search=foo'), env);
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(200);
    const body = await res!.json<{ rows: string; total: number }>();
    expect(body).toHaveProperty('rows');
    expect(vi.mocked(listUsers)).toHaveBeenCalledWith(env, 'foo', 50, 0);
  });

  it('deletes a user for an owner', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    vi.mocked(deleteUser).mockResolvedValue({ ok: true });
    const ctx = createFetchContext(
      new Request('https://shareout.site/v1/admin/users/usr_2', { method: 'DELETE' }),
      env
    );
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(200);
    expect(vi.mocked(deleteUser)).toHaveBeenCalledWith(env, 'usr_2');
  });

  it('returns a view fragment for client-side navigation', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    vi.mocked(getCostMetrics).mockResolvedValue(emptyCosts as any);
    const ctx = createFetchContext(new Request('https://shareout.site/v1/admin/view?view=costs&range=7'), env);
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(200);
    const body = await res!.json<{ view: string; title: string; rangeBar: string; html: string }>();
    expect(body.view).toBe('costs');
    expect(body.title).toBe('Costs');
    expect(body.html).toContain('AI cost (providers)');
    expect(body.rangeBar).toContain('range=7');
    expect(vi.mocked(getCostMetrics)).toHaveBeenCalledWith(env, 7);
  });

  it('blocks the view fragment for non-owners', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const ctx = createFetchContext(new Request('https://shareout.site/v1/admin/view?view=users'), env);
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(403);
  });

  it('lists artifacts for an owner', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    vi.mocked(searchArtifacts).mockResolvedValue({ artifacts: [], total: 0 });
    const ctx = createFetchContext(new Request('https://shareout.site/v1/admin/artifacts?search=x'), env);
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(200);
    expect(vi.mocked(searchArtifacts)).toHaveBeenCalledWith(env, 'x', 50, 0);
  });

  it('deletes an artifact for an owner', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', email: SA });
    vi.mocked(deleteArtifactAdmin).mockResolvedValue({ ok: true });
    const ctx = createFetchContext(
      new Request('https://shareout.site/v1/admin/artifacts/art_9', { method: 'DELETE' }),
      env
    );
    const res = await routeAdminApi(ctx);
    expect(res?.status).toBe(200);
    expect(vi.mocked(deleteArtifactAdmin)).toHaveBeenCalledWith(env, 'art_9');
  });
});
