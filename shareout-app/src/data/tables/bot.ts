import type { DataContext } from '../middleware';
import {
  insertRows,
  updateRowById,
  updateRows,
} from './crud';
import { resolveTable } from './meta';
import type { Filter } from './types';

async function unwrap<T>(res: Response): Promise<{ data?: T; error?: string }> {
  const body = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!res.ok || !body.success) return { error: body.error || 'Write failed.' };
  return { data: body.data };
}

/** Telegram bot insert — table must already exist. */
export async function botInsertRows(
  ctx: DataContext,
  tableName: string,
  rows: Record<string, unknown>[],
): Promise<{ inserted?: Record<string, unknown>[]; count?: number; error?: string; tables?: string[] }> {
  const t = await resolveTable(ctx, tableName);
  if ('error' in t) return { error: t.error, tables: t.tables };
  const out = await unwrap<{ inserted: Record<string, unknown>[]; count: number }>(
    await insertRows(ctx, t.id, { rows }),
  );
  if (out.error || !out.data) return { error: out.error || 'Insert failed.' };
  return { inserted: out.data.inserted, count: out.data.count };
}

export async function botUpdateRowById(
  ctx: DataContext,
  tableName: string,
  rowId: string,
  changes: Record<string, unknown>,
): Promise<{ updated?: number; error?: string; tables?: string[] }> {
  const t = await resolveTable(ctx, tableName);
  if ('error' in t) return { error: t.error, tables: t.tables };
  const out = await unwrap(await updateRowById(ctx, tableName, rowId, changes));
  if (out.error) return { error: out.error };
  return { updated: 1 };
}

export async function botUpdateRowsByFilter(
  ctx: DataContext,
  tableName: string,
  filter: Filter,
  changes: Record<string, unknown>,
): Promise<{ updated?: number; error?: string; tables?: string[] }> {
  const t = await resolveTable(ctx, tableName);
  if ('error' in t) return { error: t.error, tables: t.tables };
  const out = await unwrap<{ updated: number }>(
    await updateRows(ctx, tableName, { filter, changes }),
  );
  if (out.error || !out.data) return { error: out.error || 'Update failed.' };
  return { updated: out.data.updated };
}
