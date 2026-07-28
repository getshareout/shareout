import type { Env } from '../types';
import { defaultReportDate } from './digest';

const MICRO = 1_000_000;

export type InvestigateTopic =
  | 'marketing_funnel'
  | 'workspace_detail'
  | 'top_artifacts'
  | 'user_logins'
  | 'errors'
  | 'ai_by_workspace'
  | 'publishes'
  | 'crew_activity';

export interface InvestigateInput {
  topic: InvestigateTopic;
  date?: string;
  workspace?: string;
  limit?: number;
}

function parseDate(input?: string): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return defaultReportDate();
}

function clampLimit(n: unknown, max = 25): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 1) return 10;
  return Math.min(max, Math.floor(v));
}

/** Drill-down queries for the CEO daily crew — super-admin API only. */
export async function investigatePlatformMetrics(
  env: Env,
  input: InvestigateInput
): Promise<Record<string, unknown>> {
  const date = parseDate(input.date);
  const limit = clampLimit(input.limit);
  const prior = new Date(`${date}T12:00:00.000Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  const priorDate = prior.toISOString().slice(0, 10);

  switch (input.topic) {
    case 'marketing_funnel': {
      const [byEvent, byMode, byCountry, sessions, chips, teamsEvents, priorViews] = await Promise.all([
        env.DB.prepare(
          `SELECT event, COUNT(*) AS count FROM funnel_events WHERE date(ts) = ? GROUP BY event ORDER BY count DESC`
        )
          .bind(date)
          .all<{ event: string; count: number }>(),
        env.DB.prepare(
          `SELECT COALESCE(mode, '(none)') AS mode, event, COUNT(*) AS count
           FROM funnel_events WHERE date(ts) = ? GROUP BY mode, event ORDER BY count DESC`
        )
          .bind(date)
          .all<{ mode: string; event: string; count: number }>(),
        env.DB.prepare(
          `SELECT COALESCE(country, 'XX') AS country, COUNT(*) AS count
           FROM funnel_events WHERE date(ts) = ? AND event = 'view' GROUP BY country ORDER BY count DESC LIMIT ?`
        )
          .bind(date, limit)
          .all<{ country: string; count: number }>(),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT sid) AS sessions FROM funnel_events WHERE date(ts) = ? AND sid IS NOT NULL`
        )
          .bind(date)
          .first<{ sessions: number }>(),
        env.DB.prepare(
          `SELECT label, COUNT(*) AS count FROM funnel_events
           WHERE date(ts) = ? AND event = 'chip' AND label IS NOT NULL GROUP BY label ORDER BY count DESC LIMIT ?`
        )
          .bind(date, limit)
          .all<{ label: string; count: number }>(),
        env.DB.prepare(
          `SELECT event, COUNT(*) AS count FROM funnel_events
           WHERE date(ts) = ? AND event LIKE 'teams_%' GROUP BY event ORDER BY count DESC`
        )
          .bind(date)
          .all<{ event: string; count: number }>(),
        env.DB.prepare(
          `SELECT COUNT(*) AS views FROM funnel_events WHERE date(ts) = ? AND event = 'view'`
        )
          .bind(priorDate)
          .first<{ views: number }>(),
      ]);
      const views = (byEvent.results ?? []).find((r) => r.event === 'view')?.count ?? 0;
      const priorViewCount = priorViews?.views ?? 0;
      return {
        topic: 'marketing_funnel',
        date,
        uniqueSessions: sessions?.sessions ?? 0,
        landingViews: views,
        vsPriorDayViews: priorViewCount,
        byEvent: byEvent.results ?? [],
        byMode: byMode.results ?? [],
        topCountries: byCountry.results ?? [],
        starterChips: chips.results ?? [],
        teamsEvents: teamsEvents.results ?? [],
      };
    }

    case 'workspace_detail': {
      const needle = (input.workspace || '').trim().toLowerCase();
      const rows = await env.DB.prepare(
        `SELECT w.id, w.name, w.slug, w.created_at AS createdAt,
                (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS memberCount,
                (SELECT COUNT(*) FROM artifacts a WHERE a.workspace_id = w.id) AS artifactCount,
                (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id AND date(wm.created_at) = ?1) AS newMembersOnDay,
                (SELECT COUNT(*) FROM versions v JOIN artifacts a ON a.id = v.artifact_id
                 WHERE a.workspace_id = w.id AND date(v.created_at) = ?1) AS publishesOnDay,
                (SELECT COUNT(DISTINCT u.id) FROM users u
                 JOIN workspace_members wm ON wm.user_id = u.id
                 WHERE wm.workspace_id = w.id AND date(u.last_login_at) = ?1) AS loginsOnDay,
                (SELECT COALESCE(SUM(e.input_tokens + e.output_tokens),0) FROM agent_usage_events e
                 WHERE e.workspace_id = w.id AND date(e.created_at) = ?1) AS aiTokensOnDay,
                (SELECT COALESCE(SUM(e.billed_cost_micro_usd),0) FROM agent_usage_events e
                 WHERE e.workspace_id = w.id AND date(e.created_at) = ?1) AS aiRevenueMicroOnDay
         FROM workspaces w
         ORDER BY publishesOnDay DESC, newMembersOnDay DESC, loginsOnDay DESC`
      )
        .bind(date)
        .all<{
          id: string;
          name: string;
          slug: string;
          createdAt: string;
          memberCount: number;
          artifactCount: number;
          newMembersOnDay: number;
          publishesOnDay: number;
          loginsOnDay: number;
          aiTokensOnDay: number;
          aiRevenueMicroOnDay: number;
        }>();

      let list = rows.results ?? [];
      if (needle) {
        list = list.filter(
          (r) => r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)
        );
      }
      return {
        topic: 'workspace_detail',
        date,
        workspaces: list.slice(0, limit).map((r) => ({
          ...r,
          aiRevenueUsd: (r.aiRevenueMicroOnDay ?? 0) / MICRO,
        })),
      };
    }

    case 'top_artifacts': {
      const dayStart = Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);
      const dayEnd = dayStart + 86_400;
      const [rollup, live] = await Promise.all([
        env.DB.prepare(
          `SELECT a.name, a.slug, a.artifact_type AS type, COALESCE(w.name, '') AS workspace,
                  d.views, d.unique_visitors AS uniqueVisitors
           FROM analytics_daily d
           JOIN artifacts a ON a.id = d.artifact_id
           LEFT JOIN workspaces w ON w.id = a.workspace_id
           WHERE d.date = ? ORDER BY d.views DESC LIMIT ?`
        )
          .bind(date, limit)
          .all<{ name: string; slug: string; type: string; workspace: string; views: number; uniqueVisitors: number }>(),
        env.DB.prepare(
          `SELECT a.name, a.slug, COUNT(*) AS views, COUNT(DISTINCT e.visitor_hash) AS uniqueVisitors
           FROM analytics_events e
           JOIN artifacts a ON a.id = e.artifact_id
           WHERE e.event_type = 'view' AND e.created_at >= ? AND e.created_at < ?
           GROUP BY a.id ORDER BY views DESC LIMIT ?`
        )
          .bind(dayStart, dayEnd, limit)
          .all<{ name: string; slug: string; views: number; uniqueVisitors: number }>(),
      ]);
      const useRollup = (rollup.results?.length ?? 0) > 0;
      return {
        topic: 'top_artifacts',
        date,
        source: useRollup ? 'analytics_daily' : 'analytics_events',
        artifacts: useRollup ? rollup.results : live.results,
      };
    }

    case 'user_logins': {
      const rows = await env.DB.prepare(
        `SELECT u.email, u.name, u.created_at AS signedUpAt, u.last_login_at AS lastLoginAt,
                (SELECT GROUP_CONCAT(w.name, ', ') FROM workspace_members wm
                 JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = u.id) AS workspaces
         FROM users u
         WHERE date(u.last_login_at) = ? OR date(u.created_at) = ?
         ORDER BY u.last_login_at DESC LIMIT ?`
      )
        .bind(date, date, limit)
        .all<{ email: string; name: string; signedUpAt: string; lastLoginAt: string; workspaces: string | null }>();
      return { topic: 'user_logins', date, users: rows.results ?? [] };
    }

    case 'errors': {
      const rows = await env.DB.prepare(
        `SELECT ts, status, outcome, method, route, path, substr(message, 1, 300) AS message
         FROM ops_error_log WHERE date(ts) = ? ORDER BY ts DESC LIMIT ?`
      )
        .bind(date, limit)
        .all<Record<string, unknown>>();
      return { topic: 'errors', date, errors: rows.results ?? [] };
    }

    case 'ai_by_workspace': {
      const rows = await env.DB.prepare(
        `SELECT COALESCE(w.name, '(no workspace)') AS workspace,
                COUNT(*) AS events,
                COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,
                COALESCE(SUM(base_cost_micro_usd),0) AS costMicro,
                COALESCE(SUM(billed_cost_micro_usd),0) AS revenueMicro
         FROM agent_usage_events e
         LEFT JOIN workspaces w ON w.id = e.workspace_id
         WHERE date(e.created_at) = ?
         GROUP BY e.workspace_id ORDER BY tokens DESC LIMIT ?`
      )
        .bind(date, limit)
        .all<{ workspace: string; events: number; tokens: number; costMicro: number; revenueMicro: number }>();
      return {
        topic: 'ai_by_workspace',
        date,
        workspaces: (rows.results ?? []).map((r) => ({
          workspace: r.workspace,
          events: r.events,
          tokens: r.tokens,
          costUsd: r.costMicro / MICRO,
          revenueUsd: r.revenueMicro / MICRO,
        })),
      };
    }

    case 'publishes': {
      const rows = await env.DB.prepare(
        `SELECT a.name, a.slug, COALESCE(w.name, '') AS workspace,
                v.version_no AS versionNo, v.created_at AS createdAt,
                COALESCE(u.email, '') AS publisher
         FROM versions v
         JOIN artifacts a ON a.id = v.artifact_id
         LEFT JOIN workspaces w ON w.id = a.workspace_id
         LEFT JOIN users u ON u.id = a.owner_id
         WHERE date(v.created_at) = ?
         ORDER BY v.created_at DESC LIMIT ?`
      )
        .bind(date, limit)
        .all<Record<string, unknown>>();
      return { topic: 'publishes', date, publishes: rows.results ?? [] };
    }

    case 'crew_activity': {
      const rows = await env.DB.prepare(
        `SELECT c.name AS crewName, a.name AS artifactName, a.slug,
                r.trigger_kind AS trigger, r.termination_reason AS outcome,
                r.started_at AS startedAt, substr(r.result_text, 1, 200) AS summary
         FROM crew_runs r
         JOIN crews c ON c.id = r.crew_id
         JOIN artifacts a ON a.id = r.artifact_id
         WHERE date(r.started_at) = ?
         ORDER BY r.started_at DESC LIMIT ?`
      )
        .bind(date, limit)
        .all<Record<string, unknown>>();
      return { topic: 'crew_activity', date, runs: rows.results ?? [] };
    }

    default:
      return { error: `Unknown topic: ${input.topic}` };
  }
}
