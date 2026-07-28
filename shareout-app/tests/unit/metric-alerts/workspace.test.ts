import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const getWorkspaceRole = vi.hoisted(() => vi.fn());
const getRuleById = vi.hoisted(() => vi.fn());
const evaluateAndDeliver = vi.hoisted(() => vi.fn());
vi.mock('../../../src/workspaces', () => ({ getWorkspaceRole, getInternalWorkspaceRole: getWorkspaceRole }));
vi.mock('../../../src/metric-alerts/rules', () => ({ getRuleById, evaluateAndDeliver, fetchHistories: vi.fn(async () => ({})) }));

import {
  handleListWorkspaceAlerts,
  handleToggleWorkspaceAlert,
  handleDeleteWorkspaceAlert,
  handleRunWorkspaceAlert,
} from '../../../src/router/api/workspace-metric-alerts';

const user: AuthUser = { id: 'user_1', email: 'admin@team.com', username: null };

// env.DB double routed by SQL substring.
function db(handlers: { match: string; first?: unknown; all?: unknown[] }[]) {
  const runSpy = vi.fn(async () => ({ meta: { changes: 1 } }));
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => handlers.find((h) => sql.includes(h.match) && 'first' in h)?.first ?? null),
        all: vi.fn(async () => ({ results: handlers.find((h) => sql.includes(h.match) && 'all' in h)?.all ?? [] })),
        run: runSpy,
      })),
    })),
  };
  return { env: { DB } as unknown as Env, runSpy };
}

beforeEach(() => {
  getWorkspaceRole.mockReset();
  getRuleById.mockReset();
  evaluateAndDeliver.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('workspace metric-alerts handlers', () => {
  it('forbids non-admins', async () => {
    getWorkspaceRole.mockResolvedValue('member');
    const { env } = db([]);
    const res = await handleListWorkspaceAlerts(env, user, 'ws_1');
    expect(res.status).toBe(403);
  });

  it('lists workspace alerts with parsed condition + boolean enabled', async () => {
    getWorkspaceRole.mockResolvedValue('admin');
    const { env } = db([
      { match: 'FROM metric_alert_rules', all: [
        { id: 'a1', name: 'Rev', condition_json: '{"op":"lt","value":100}', enabled: 1, artifact_name: 'Dash' },
      ] },
    ]);
    const res = await handleListWorkspaceAlerts(env, user, 'ws_1');
    expect(res.status).toBe(200);
    const body = await res.json() as { alerts: Array<{ condition: unknown; enabled: boolean }> };
    expect(body.alerts[0].condition).toEqual({ op: 'lt', value: 100 });
    expect(body.alerts[0].enabled).toBe(true);
  });

  it('404s a rule that is not in the workspace', async () => {
    getWorkspaceRole.mockResolvedValue('owner');
    const { env } = db([{ match: 'JOIN artifacts a ON a.id = mar.artifact_id', first: null }]);
    const res = await handleDeleteWorkspaceAlert(env, user, 'ws_1', 'a1');
    expect(res.status).toBe(404);
  });

  it('toggles enabled for an in-workspace rule', async () => {
    getWorkspaceRole.mockResolvedValue('admin');
    const { env, runSpy } = db([{ match: 'JOIN artifacts a ON a.id = mar.artifact_id', first: { id: 'a1' } }]);
    const req = new Request('https://x', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    const res = await handleToggleWorkspaceAlert(req, env, user, 'ws_1', 'a1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, enabled: false });
    expect(runSpy).toHaveBeenCalled();
  });

  it('runs an in-workspace rule via evaluateAndDeliver', async () => {
    getWorkspaceRole.mockResolvedValue('admin');
    getRuleById.mockResolvedValue({ id: 'a1' });
    evaluateAndDeliver.mockResolvedValue({ matched: true, delivered: true, value: 5 });
    const { env } = db([{ match: 'JOIN artifacts a ON a.id = mar.artifact_id', first: { id: 'a1' } }]);
    const res = await handleRunWorkspaceAlert(env, user, 'ws_1', 'a1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: { matched: true, delivered: true, value: 5 } });
    expect(evaluateAndDeliver).toHaveBeenCalledWith(env, { id: 'a1' }, 'manual');
  });
});
