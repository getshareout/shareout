import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces';
import { encryptCredentials } from '../../data/connections/credentials';
import { getWorkspaceLlmConfig } from '../../data/agent/ai-config';
import { jsonWithApiErrors } from '../../http/api-error';

const BYO_PROVIDERS = ['openai', 'vercel-gateway'] as const;

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

function microToUsd(micro: number): number {
  return Math.round((micro / 1_000_000) * 10000) / 10000;
}

async function requireMember(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  return (await getInternalWorkspaceRole(env, workspaceId, userId)) !== null;
}

async function requireAdmin(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  const role = await getInternalWorkspaceRole(env, workspaceId, userId);
  return role === 'owner' || role === 'admin';
}

// GET /v1/workspaces/{id}/llm — provider config summary (no secrets)
export async function handleGetWorkspaceLlm(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const cfg = await getWorkspaceLlmConfig(env, workspaceId);
  const period = new Date().toISOString().slice(0, 7);
  const spend = await env.DB.prepare(`
    SELECT COALESCE(SUM(base_cost_micro_usd), 0) AS micro
    FROM agent_usage_events
    WHERE workspace_id = ? AND strftime('%Y-%m', created_at) = ?
  `).bind(workspaceId, period).first<{ micro: number }>();

  return json({
    hasByoKey: !!(cfg?.byo_provider),
    byoProvider: cfg?.byo_provider ?? null,
    monthlyBudgetUsd: cfg?.monthly_budget_micro_usd != null ? microToUsd(cfg.monthly_budget_micro_usd) : null,
    currentMonthSpendUsd: microToUsd(spend?.micro ?? 0),
    period,
  });
}

// PUT /v1/workspaces/{id}/llm — set the workspace's own provider key (admin+)
export async function handleSetWorkspaceByoKey(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (!env.CREDENTIALS_KEY) {
    return json({ error: 'CREDENTIALS_KEY not configured', code: 'CONFIG_ERROR' }, 500);
  }

  let body: { provider?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }

  if (!body.provider || !BYO_PROVIDERS.includes(body.provider as (typeof BYO_PROVIDERS)[number])) {
    return json({ error: `provider must be one of: ${BYO_PROVIDERS.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
  }
  if (!body.apiKey || typeof body.apiKey !== 'string' || body.apiKey.length < 8) {
    return json({ error: 'apiKey is required', code: 'VALIDATION_ERROR' }, 400);
  }

  const { encrypted, iv } = await encryptCredentials({ api_key: body.apiKey }, env.CREDENTIALS_KEY);

  await env.DB.prepare(`
    INSERT INTO workspace_llm_config (workspace_id, byo_provider, byo_encrypted_credentials, byo_iv, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(workspace_id) DO UPDATE SET
      byo_provider = excluded.byo_provider,
      byo_encrypted_credentials = excluded.byo_encrypted_credentials,
      byo_iv = excluded.byo_iv,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(workspaceId, body.provider, encrypted, iv).run();

  return json({ ok: true, byoProvider: body.provider });
}

// DELETE /v1/workspaces/{id}/llm — remove the BYO key, falling back to platform key (admin+)
export async function handleDeleteWorkspaceByoKey(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  await env.DB.prepare(`
    UPDATE workspace_llm_config
    SET byo_provider = NULL, byo_encrypted_credentials = NULL, byo_iv = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE workspace_id = ?
  `).bind(workspaceId).run();

  return json({ ok: true });
}

// GET /v1/workspaces/{id}/usage — per-request usage ledger + aggregates
export async function handleGetWorkspaceUsage(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  const rows = await env.DB.prepare(`
    SELECT e.id, e.artifact_id, a.name AS artifact_name, e.mode, e.provider, e.model,
           e.input_tokens, e.output_tokens, e.base_cost_micro_usd, e.byo, e.created_at
    FROM agent_usage_events e
    LEFT JOIN artifacts a ON a.id = e.artifact_id
    WHERE e.workspace_id = ?
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(workspaceId, limit, offset).all<{
    id: string;
    artifact_id: string;
    artifact_name: string | null;
    mode: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    base_cost_micro_usd: number;
    byo: number;
    created_at: string;
  }>();

  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(base_cost_micro_usd), 0) AS cost
    FROM agent_usage_events
    WHERE workspace_id = ?
  `).bind(workspaceId).first<{ requests: number; input_tokens: number; output_tokens: number; cost: number }>();

  return json({
    events: rows.results.map((r) => ({
      id: r.id,
      artifactId: r.artifact_id,
      artifactName: r.artifact_name,
      mode: r.mode,
      provider: r.provider,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: microToUsd(r.base_cost_micro_usd),
      byo: !!r.byo,
      createdAt: r.created_at,
    })),
    totals: {
      requests: totals?.requests ?? 0,
      inputTokens: totals?.input_tokens ?? 0,
      outputTokens: totals?.output_tokens ?? 0,
      costUsd: microToUsd(totals?.cost ?? 0),
    },
    limit,
    offset,
  });
}
