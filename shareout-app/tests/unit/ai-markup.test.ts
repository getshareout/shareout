// AI resale markup on real D1: the workspace sees and pays cost × markup everywhere it sees AI money
// (budget, Usage, invoices); only platform admins see cost, margin and the markup itself.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import initSql from '../../migrations/0000_init.sql?raw';
import gatewaySql from '../../migrations/0003_ai_gateway_model.sql?raw';
import ledgerSql from '../../migrations/0010_workspace_usage_daily.sql?raw';
import tokensSql from '../../migrations/0024_ai_usage_tokens.sql?raw';
import invoicesSql from '../../migrations/0034_workspace_invoices.sql?raw';
import markupSql from '../../migrations/0035_ai_markup.sql?raw';
import { AT_COST_BPS, bpsFromMultiplier, priceRuns, resell, workspaceMarkup } from '../../src/data/ai-markup';
import { budgetState, resetBudgetCache } from '../../src/data/ai-budget';
import { handleGetWorkspaceAiLimits } from '../../src/router/api/workspace-ai-limits';
import { handleGetWorkspaceSpend } from '../../src/router/api/workspace-spend';
import { handleCreateInvoice, handleGetMarkup, handleListInvoices, handleSetMarkup } from '../../src/router/api/workspace-invoices';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const e = { ...(env as unknown as Env), INSTANCE_ADMIN_EMAILS: 'op@example.com' } as Env;
const WS = 'wsp_mk_acme';
const as = (id: string, email: string): AuthUser => ({ id, email, username: null });
const OP = as('usr_mk_op', 'op@example.com');
const ADMIN = as('usr_mk_admin', 'admin@acme.test');
const MEMBER = as('usr_mk_member', 'member@acme.test');

const now = new Date();
const LAST = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const THIS = now.toISOString().slice(0, 7);
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
const req = (method: string, path: string, body?: unknown) => new Request(`https://shareout.test/v1/workspaces/${WS}${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const setInstance = (bps: number | null) => e.DB.prepare('UPDATE instance_ai_settings SET default_markup_bps = ? WHERE id = 1').bind(bps).run();
const setWorkspace = (bps: number | null) => e.DB.prepare(
  `INSERT INTO workspace_llm_config (workspace_id, ai_markup_bps) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET ai_markup_bps = excluded.ai_markup_bps`,
).bind(WS, bps).run();

async function usage(at: string, cost: number, kind = 'assistant_chat') {
  await e.DB.prepare(
    `INSERT INTO ai_usage_events (id, workspace_id, user_id, kind, model, units, unit_kind, base_cost_micro_usd, input_tokens, output_tokens, cost_source, created_at)
     VALUES (?, ?, ?, ?, 'anthropic/claude-sonnet-5.5', 0, 'tokens', ?, 1000, 100, 'reconciled', ?)`,
  ).bind(crypto.randomUUID(), WS, ADMIN.id, kind, cost, at).run();
}

beforeAll(async () => {
  for (const sql of [initSql, gatewaySql, ledgerSql, tokensSql, invoicesSql, markupSql]) {
    const stmts = sql.replace(/--[^\n]*/g, '').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50).map((x) => e.DB.prepare(x)));
  }
  for (const u of [OP, ADMIN, MEMBER]) await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email).run();
  await e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-mk', ?)").bind(WS, ADMIN.id).run();
  await e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_mk1', ?, ?, 'owner'), ('wm_mk2', ?, ?, 'member')")
    .bind(WS, ADMIN.id, WS, MEMBER.id).run();
  await usage(`${THIS}-01T01:00:00.000Z`, 10_000_000);                 // $10 this month
  await usage(`${LAST}-10T10:00:00.000Z`, 4_000_000);                  // $4 last month
  await usage(`${LAST}-11T10:00:00.000Z`, 2_000_000, 'crew_run');      // $2 last month
  await e.DB.prepare(`INSERT INTO workspace_usage_daily (day, workspace_id, metric, quantity, cost_micro_usd) VALUES
    (?, ?, 'ai_llm_tokens', 1000, 6000000), (?, ?, 'email_sent', 10, 1000)`).bind(`${LAST}-10`, WS, `${LAST}-10`, WS).run();
});

beforeEach(async () => {
  resetBudgetCache();
  await setInstance(null);
  await setWorkspace(null);
});

describe('markup resolution', () => {
  it('is at cost by default, then the instance default, then the workspace override', async () => {
    expect((await workspaceMarkup(e, WS)).bps).toBe(AT_COST_BPS);
    await setInstance(15_000);
    expect(await workspaceMarkup(e, WS)).toEqual({ bps: 15_000, workspaceBps: null, instanceBps: 15_000 });
    await setWorkspace(20_000);
    expect((await workspaceMarkup(e, WS)).bps).toBe(20_000);
    await setWorkspace(5_000); // below cost is never applied
    expect((await workspaceMarkup(e, WS)).bps).toBe(15_000);
  });

  it('converts and rounds', () => {
    expect(resell(1_000_001, 15_000)).toBe(1_500_002);
    expect(bpsFromMultiplier(1.5)).toBe(15_000);
    expect(bpsFromMultiplier(0.9)).toBeNull();
    expect(bpsFromMultiplier(11)).toBeNull();
    expect(priceRuns([{ id: 'r', cost_micro_usd: 100 }, { id: 's' }], 15_000)).toEqual([{ id: 'r', cost_micro_usd: 150 }, { id: 's' }]);
  });
});

describe('what the workspace sees', () => {
  it('measures the AI budget at its price, and gives cost and margin to platform admins only', async () => {
    await setInstance(15_000);
    await e.DB.prepare('UPDATE workspace_llm_config SET monthly_budget_micro_usd = 15000000 WHERE workspace_id = ?').bind(WS).run();
    const s = await budgetState(e, WS, { fresh: true });
    expect(s).toMatchObject({ spentMicro: 15_000_000, costMicro: 10_000_000, markupBps: 15_000, state: 'reached' });

    const admin = await read(await handleGetWorkspaceAiLimits(e, ADMIN, WS));
    expect(admin.body.month_spend_usd).toBe(15);
    expect(admin.body.spend_by_kind).toEqual([{ kind: 'assistant_chat', usd: 15 }]);
    expect(admin.body.operator).toBeUndefined();
    expect(JSON.stringify(admin.body)).not.toMatch(/"cost|markup/);

    await e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_mk3', ?, ?, 'admin')").bind(WS, OP.id).run();
    const op = await read(await handleGetWorkspaceAiLimits(e, OP, WS));
    expect(op.body.operator).toEqual({ cost_usd: 10, margin_usd: 5, markup: 1.5 });
    await e.DB.prepare("DELETE FROM workspace_members WHERE id = 'wm_mk3'").run();
  });

  it('resells AI metrics in the Usage ledger and leaves infra at list price', async () => {
    await setWorkspace(20_000);
    const { body } = await read(await handleGetWorkspaceSpend(new Request(`https://x/v1/workspaces/${WS}/spend?month=${LAST}`), e, ADMIN, WS));
    expect(body.byMetric.ai_llm_tokens.costMicroUsd).toBe(12_000_000);
    expect(body.byMetric.email_sent.costMicroUsd).toBe(1_000);
    expect(body.totalMicroUsd).toBe(12_001_000);
  });

  it('invoices usage at price; the workspace never sees cost or markup, the operator sees both', async () => {
    await setWorkspace(15_000);
    const created = await read(await handleCreateInvoice(req('POST', '/invoices', { usage_month: LAST, status: 'open', lines: [{ description: 'Platform fee', unit_cents: 5_000 }] }), e, OP, WS));
    expect(created.status).toBe(201);
    const usageLine = created.body.invoice.lines[1];
    expect(usageLine.amount_cents).toBe(900); // ($4 + $2) × 1.5
    expect(created.body.invoice.total_cents).toBe(5_900);
    expect(usageLine.usage).toMatchObject({ price_micro_usd: 9_000_000, cost_micro_usd: 6_000_000, markup_bps: 15_000 });
    expect(usageLine.usage.by_kind).toEqual([
      expect.objectContaining({ key: 'assistant_chat', price_micro_usd: 6_000_000, cost_micro_usd: 4_000_000 }),
      expect.objectContaining({ key: 'crew_run', price_micro_usd: 3_000_000, cost_micro_usd: 2_000_000 }),
    ]);

    const customer = await read(await handleListInvoices(e, ADMIN, WS));
    const seen = JSON.stringify(customer.body);
    expect(customer.body.invoices[0].lines[1].usage.price_micro_usd).toBe(9_000_000);
    expect(seen).not.toContain('cost_micro_usd');
    expect(seen).not.toContain('markup');
    expect(customer.body.markup).toBeUndefined();

    const operator = await read(await handleListInvoices(e, OP, WS));
    expect(operator.body.invoices[0].lines[1].usage.cost_micro_usd).toBe(6_000_000);
    expect(operator.body.markup).toEqual({ markup: 1.5, workspace_markup: 1.5, instance_default: 1 });

    // The snapshot is frozen: a later markup change does not move an issued invoice.
    await setWorkspace(30_000);
    expect((await read(await handleListInvoices(e, ADMIN, WS))).body.invoices[0].total_cents).toBe(5_900);
  });
});

describe('setting the markup', () => {
  it('is for platform admins only, validates, and clears back to the instance default', async () => {
    expect((await handleSetMarkup(req('PUT', '/ai-markup', { markup: 2 }), e, ADMIN, WS)).status).toBe(403);
    expect((await handleGetMarkup(e, MEMBER, WS)).status).toBe(403);
    expect((await handleSetMarkup(req('PUT', '/ai-markup', { markup: 0.5 }), e, OP, WS)).status).toBe(400);
    expect((await handleSetMarkup(req('PUT', '/ai-markup', {}), e, OP, WS)).status).toBe(400);
    await setInstance(15_000);
    expect((await read(await handleSetMarkup(req('PUT', '/ai-markup', { markup: 2 }), e, OP, WS))).body).toEqual({ markup: 2, workspace_markup: 2, instance_default: 1.5 });
    expect((await read(await handleSetMarkup(req('PUT', '/ai-markup', { markup: null }), e, OP, WS))).body).toEqual({ markup: 1.5, workspace_markup: null, instance_default: 1.5 });
    const audit = await e.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id = ? AND action LIKE '%markup%'").bind(WS).first<{ n: number }>();
    expect(audit?.n).toBe(0); // the workspace can read its audit log
  });
});
