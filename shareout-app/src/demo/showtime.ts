// Showtime — live pitch-choreography engine (work/044 §6).
//
// A Durable Object with alarms that runs a JSON timeline `[{delayMs, action, params}]`,
// firing demo events into a demo workspace on a second-level schedule — no laptop
// dependency. One DO instance per run (idFromName = `${workspaceId}:${scenario}`).
//
// Actions call existing domain functions directly (no persona tokens: ShareOut has no
// scoped tokens). Kept to what the Terra flagship needs; more actions land per company.

import type { Env } from '../types';
import { writeDatasetRows } from '../data/datasets/handler';
import { fireAlert } from '../observability/alerts';
import { notifySuperadmins } from '../superadmin/recipients';
import { generateArtifactSummary } from '../publish/auto-summary';

export interface TimelineStep {
  delayMs: number;
  action: string;
  params: Record<string, unknown>;
}
export interface StartParams {
  workspaceId: string;
  scenario: string;
  startedBy: string;
  timeline: TimelineStep[];
}

interface Meta {
  workspaceId: string;
  scenario: string;
  startedBy: string;
  startedAt: number;
  total: number;
}

export class Showtime implements DurableObject {
  private sql: SqlStorage;
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState, private env: Env) {
    this.sql = state.storage.sql;
    this.storage = state.storage;
    state.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS steps (
        idx INTEGER PRIMARY KEY, fire_at INTEGER, action TEXT, params TEXT, done INTEGER DEFAULT 0
      )`);
      // Per-dataset accumulator so tick_dataset appends without reading back from R2.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS accum (k TEXT PRIMARY KEY, rows TEXT)`);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/start') {
      return Response.json(await this.start((await request.json()) as StartParams));
    }
    if (url.pathname === '/status') {
      return Response.json(await this.status());
    }
    if (request.method === 'POST' && url.pathname === '/stop') {
      await this.storage.deleteAlarm();
      await this.storage.delete('meta');
      this.sql.exec('DELETE FROM steps');
      this.sql.exec('DELETE FROM accum');
      return Response.json({ ok: true, stopped: true });
    }
    return new Response('not found', { status: 404 });
  }

  private async start(p: StartParams): Promise<{ ok: boolean; steps: number }> {
    this.sql.exec('DELETE FROM steps');
    this.sql.exec('DELETE FROM accum');
    const base = Date.now();
    p.timeline.forEach((s, i) =>
      this.sql.exec(
        'INSERT INTO steps (idx, fire_at, action, params, done) VALUES (?,?,?,?,0)',
        i, base + Math.max(0, s.delayMs), s.action, JSON.stringify(s.params)
      )
    );
    const meta: Meta = {
      workspaceId: p.workspaceId, scenario: p.scenario, startedBy: p.startedBy,
      startedAt: base, total: p.timeline.length,
    };
    await this.storage.put('meta', meta);
    await this.storage.setAlarm(base + 50);
    return { ok: true, steps: p.timeline.length };
  }

  private async status(): Promise<Record<string, unknown>> {
    const meta = await this.storage.get<Meta>('meta');
    if (!meta) return { running: false };
    const [{ done }] = [...this.sql.exec<{ done: number }>('SELECT COUNT(*) AS done FROM steps WHERE done=1')];
    const next = [...this.sql.exec<{ fire_at: number; action: string }>(
      'SELECT fire_at, action FROM steps WHERE done=0 ORDER BY fire_at LIMIT 1')][0];
    return {
      running: !!next, scenario: meta.scenario, workspaceId: meta.workspaceId,
      startedBy: meta.startedBy, done, total: meta.total,
      nextAction: next?.action ?? null, nextInMs: next ? Math.max(0, next.fire_at - Date.now()) : null,
    };
  }

  async alarm(): Promise<void> {
    const meta = await this.storage.get<Meta>('meta');
    if (!meta) return;
    const now = Date.now();
    const due = [...this.sql.exec<{ idx: number; action: string; params: string }>(
      'SELECT idx, action, params FROM steps WHERE done=0 AND fire_at<=? ORDER BY idx', now)];
    for (const s of due) {
      try {
        await this.runAction(meta, s.action, JSON.parse(s.params));
      } catch (err) {
        // Demo choreography must not wedge on one failed beat — log to admins, continue.
        await notifySuperadmins(this.env,
          `⚠️ Showtime "${meta.scenario}" — acción "${s.action}" falló: ${err instanceof Error ? err.message : String(err)}`
        ).catch(() => {});
      }
      this.sql.exec('UPDATE steps SET done=1 WHERE idx=?', s.idx);
    }
    const next = [...this.sql.exec<{ fire_at: number }>(
      'SELECT fire_at FROM steps WHERE done=0 ORDER BY fire_at LIMIT 1')][0];
    if (next) await this.storage.setAlarm(Math.max(now + 250, next.fire_at));
    else await this.storage.delete('meta');
  }

  // ── Action catalog ─────────────────────────────────────────────────────────
  private async runAction(meta: Meta, action: string, params: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'tick_dataset':   return this.tickDataset(params);
      case 'fire_alert':     return this.fireAlertAction(params);
      case 'notify':         return void await notifySuperadmins(this.env, String(params.message ?? ''));
      case 'generate_tldr':  return void await generateArtifactSummary(this.env, String(params.artifactId));
      default:               throw new Error(`unknown action: ${action}`);
    }
  }

  // Append (or replace) rows on an artifact dataset and re-materialize. Trackers poll
  // so each tick shows up on the next poll. `seed` = baseline on first tick; `replace`
  // = full-table rewrite (dashboards that show a snapshot, not a grow-only ticker).
  private async tickDataset(params: Record<string, unknown>): Promise<void> {
    const artifactId = String(params.artifactId);
    const dataset = String(params.dataset);
    const add = (params.rows as unknown[]) ?? [];
    const seed = params.seed as unknown[] | undefined;
    const replace = params.replace === true;
    const k = `${artifactId}:${dataset}`;

    let rows: unknown[];
    if (replace) {
      rows = add.length ? add : (seed ?? []);
    } else {
      const existing = [...this.sql.exec<{ rows: string }>('SELECT rows FROM accum WHERE k=?', k)][0];
      if (!existing && seed) rows = [...seed];
      else rows = existing ? JSON.parse(existing.rows) : [];
      rows = rows.concat(add);
    }

    this.sql.exec('INSERT OR REPLACE INTO accum (k, rows) VALUES (?, ?)', k, JSON.stringify(rows));
    await writeDatasetRows(this.env, artifactId, dataset, 'json', rows);
  }

  private async fireAlertAction(params: Record<string, unknown>): Promise<void> {
    const message = String(params.message ?? '');
    await fireAlert(this.env, String(params.key ?? `showtime:${Date.now()}`), message, 0);
    if (params.notify !== false) await notifySuperadmins(this.env, message).catch(() => {});
  }
}
