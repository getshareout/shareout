// Artifact Tests — T2 data-contract assertions. Read-only checks of stored shapes
// in the per-artifact MiniDB. SELECT-only, so naturally snapshot-safe (no writes,
// no shadow namespace needed). store: "table:<name>" | "json:<key>".

import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';
import type { ContractAssertion, TestResult } from './types';

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

async function checkTable(
  db: ReturnType<typeof createMiniDb>,
  artifactId: string,
  name: string,
  expect: ContractAssertion['expect'],
): Promise<{ ok: boolean; msg: string }> {
  const tbl = await db.prepare(
    'SELECT id, row_count FROM artifact_tables WHERE artifact_id = ? AND name = ?',
  ).bind(artifactId, name).first<{ id: string; row_count: number }>();
  if (!tbl) return { ok: false, msg: `table "${name}" does not exist` };

  const problems: string[] = [];
  if (expect.minRows !== undefined && tbl.row_count < expect.minRows) {
    problems.push(`row_count ${tbl.row_count} < minRows ${expect.minRows}`);
  }
  if (expect.maxRows !== undefined && tbl.row_count > expect.maxRows) {
    problems.push(`row_count ${tbl.row_count} > maxRows ${expect.maxRows}`);
  }
  if (expect.columns?.length) {
    const sample = await db.prepare(
      'SELECT data FROM artifact_rows WHERE table_id = ? LIMIT 1',
    ).bind(tbl.id).first<{ data: string }>();
    if (!sample) {
      if (expect.minRows === undefined || expect.minRows > 0) problems.push('no rows to verify columns');
    } else {
      let cols: string[] = [];
      try { cols = Object.keys(JSON.parse(sample.data)); } catch { /* ignore */ }
      const missing = expect.columns.filter((c) => !cols.includes(c));
      if (missing.length) problems.push(`missing columns: ${missing.join(', ')}`);
    }
  }
  return problems.length ? { ok: false, msg: problems.join('; ') } : { ok: true, msg: `table "${name}" ok (${tbl.row_count} rows)` };
}

async function checkJson(
  db: ReturnType<typeof createMiniDb>,
  artifactId: string,
  key: string,
  expect: ContractAssertion['expect'],
): Promise<{ ok: boolean; msg: string }> {
  const row = await db.prepare(
    'SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?',
  ).bind(artifactId, key).first<{ value: string }>();
  if (!row) return { ok: false, msg: `json key "${key}" does not exist` };
  if (!expect.schema) return { ok: true, msg: `json key "${key}" present` };

  let val: Record<string, unknown>;
  try { val = JSON.parse(row.value) as Record<string, unknown>; } catch { return { ok: false, msg: `json key "${key}" is not valid JSON` }; }
  const problems: string[] = [];
  for (const [field, expectedType] of Object.entries(expect.schema)) {
    const actual = typeOf(val[field]);
    if (!(field in val)) problems.push(`missing field "${field}"`);
    else if (actual !== expectedType) problems.push(`field "${field}" is ${actual}, expected ${expectedType}`);
  }
  return problems.length ? { ok: false, msg: problems.join('; ') } : { ok: true, msg: `json key "${key}" matches schema` };
}

/** Run all contract assertions read-only against the artifact's MiniDB. */
export async function runContract(
  env: Env,
  artifactId: string,
  workspaceId: string,
  assertions: ContractAssertion[],
): Promise<TestResult[]> {
  const db = createMiniDb(env, artifactId, workspaceId);
  const out: TestResult[] = [];
  for (const a of assertions) {
    const t0 = Date.now();
    const [kind, ...rest] = a.store.split(':');
    const ref = rest.join(':');
    try {
      let res: { ok: boolean; msg: string };
      if (kind === 'table') res = await checkTable(db, artifactId, ref, a.expect);
      else if (kind === 'json') res = await checkJson(db, artifactId, ref, a.expect);
      else res = { ok: false, msg: `unknown store kind "${kind}" (use table: or json:)` };
      out.push({
        name: `contract ${a.store}`,
        tier: 'contract',
        status: res.ok ? 'passed' : 'failed',
        message: res.msg,
        duration_ms: Date.now() - t0,
      });
    } catch (e) {
      // MiniDB unreachable / DO failure — harness error, NOT a content failure.
      out.push({
        name: `contract ${a.store}`,
        tier: 'contract',
        status: 'errored',
        message: `could not read store: ${e instanceof Error ? e.message : String(e)}`,
        duration_ms: Date.now() - t0,
      });
    }
  }
  return out;
}
