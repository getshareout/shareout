import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

// Auth collaborators behind requireTokenOrSession.
const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth', () => ({ getSessionUser }));

// Rules/definitions services — we only assert routing/auth here.
const listRulesForOwner = vi.hoisted(() => vi.fn());
const listRulesForArtifact = vi.hoisted(() => vi.fn());
const createRule = vi.hoisted(() => vi.fn());
const updateRule = vi.hoisted(() => vi.fn());
vi.mock('../../../src/metric-alerts/rules', () => ({
  listRulesForOwner,
  listRulesForArtifact,
  createRule,
  getRule: vi.fn(),
  updateRule,
  deleteRule: vi.fn(),
  runRuleManually: vi.fn(),
  getRuleEvents: vi.fn(),
}));
vi.mock('../../../src/metric-alerts/definitions', () => ({
  upsertDefinition: vi.fn(),
  listDefinitions: vi.fn(),
  deleteDefinition: vi.fn(),
}));

import { routeMetricAlertsApi } from '../../../src/router/api/metric-alerts';
import { createFetchContext } from '../../../src/router/context';

const env = {} as Env;

function get(path: string, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.site' + path, { headers });
  return routeMetricAlertsApi(createFetchContext(req, env));
}

function post(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.site' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return routeMetricAlertsApi(createFetchContext(req, env));
}

function patch(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.site' + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return routeMetricAlertsApi(createFetchContext(req, env));
}

function put(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.site' + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return routeMetricAlertsApi(createFetchContext(req, env));
}

beforeEach(() => {
  validateToken.mockReset();
  getSessionUser.mockReset();
  listRulesForOwner.mockReset();
  listRulesForArtifact.mockReset();
  createRule.mockReset();
  updateRule.mockReset();
  validateToken.mockResolvedValue(null); // no Bearer token
});

afterEach(() => vi.restoreAllMocks());

describe('metric-alerts route auth', () => {
  it('accepts a browser session cookie (no Bearer token)', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    listRulesForOwner.mockResolvedValue([{ id: 'alert_1' }]);

    const res = await get('/v1/metric-alerts', { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ alerts: [{ id: 'alert_1' }] });
    expect(listRulesForOwner).toHaveBeenCalledWith(env, 'user_1');
  });

  it('401s when neither token nor session is present', async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await get('/v1/metric-alerts');
    expect(res?.status).toBe(401);
  });

  it('lists artifact-scoped rules when artifact_id is given', async () => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
    listRulesForArtifact.mockResolvedValue({ rules: [{ id: 'alert_2' }] });

    const res = await get('/v1/metric-alerts?artifact_id=art_1', { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(200);
    expect(listRulesForArtifact).toHaveBeenCalledWith(env, 'user_1', 'art_1');
    expect(listRulesForOwner).not.toHaveBeenCalled();
  });
});

describe('metric-alerts invalid JSON', () => {
  beforeEach(() => {
    getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
  });

  it('returns INVALID_JSON for malformed POST /v1/metric-alerts body', async () => {
    const res = await post('/v1/metric-alerts', '{not json', { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ success: false, error: 'Invalid JSON', code: 'INVALID_JSON' });
    expect(createRule).not.toHaveBeenCalled();
  });

  it('returns INVALID_JSON for malformed PUT /v1/metric-alerts/definitions body', async () => {
    const res = await put('/v1/metric-alerts/definitions', '{bad', { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ success: false, error: 'Invalid JSON', code: 'INVALID_JSON' });
  });

  it('returns INVALID_JSON for malformed PATCH /v1/metric-alerts/:id body', async () => {
    const res = await patch('/v1/metric-alerts/alert_1', '{bad', { Cookie: 'shareout_session=x' });
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ success: false, error: 'Invalid JSON', code: 'INVALID_JSON' });
    expect(updateRule).not.toHaveBeenCalled();
  });
});
