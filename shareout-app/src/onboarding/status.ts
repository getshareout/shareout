/**
 * Onboarding status resolver (work/033). ONE shared definition of "done" per task,
 * live-derived from real tables — consumed by the in-chat checklist (real-time D1).
 *
 * Externals (member_class != 'internal') get no onboarding. Task copy is client-side.
 */
import type { Env, WorkspaceRole } from '../types';
import { tasksForTrack, type OnboardingTrack, type OnboardingAction } from './tasks';

const ELIGIBLE_WINDOW_DAYS = 14;

interface Membership {
  role: WorkspaceRole;
  created_at: string;
  member_class: string | null;
}

interface Signals {
  firstArtifact: boolean;
  dataSource: boolean;
  slack: boolean;
  alert: boolean;
  telegram: boolean;
  viewed: boolean;
  commented: boolean;
  skillAck: boolean;
  assistant: boolean;
  shared: boolean;
}

export interface OnboardingTaskView {
  key: string;
  done: boolean;
  action: OnboardingAction;
  skippable: boolean;
}

export interface OnboardingStatus {
  track: OnboardingTrack;
  tasks: OnboardingTaskView[];
  pct: number;
  eligible: boolean;
  dismissed: boolean;
  celebrated: boolean;
}

async function getMembership(env: Env, workspaceId: string, userId: string): Promise<Membership | null> {
  return env.DB.prepare(
    'SELECT role, created_at, member_class FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<Membership>();
}

/** Boolean signals in a single round-trip (5 EXISTS across workspace + user scope). */
async function getSignals(env: Env, workspaceId: string, userId: string, skillAck: boolean): Promise<Signals> {
  const row = await env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM artifacts WHERE owner_id=?1 AND is_example=0 AND deleted_at IS NULL) AS firstArtifact,
       EXISTS(SELECT 1 FROM connections WHERE scope_type='workspace' AND scope_id=?2 AND provider<>'slack') AS dataSource,
       EXISTS(SELECT 1 FROM connections WHERE scope_type='workspace' AND scope_id=?2 AND provider='slack')  AS slack,
       EXISTS(SELECT 1 FROM metric_alert_rules WHERE workspace_id=?2 AND enabled=1)             AS alert,
       EXISTS(SELECT 1 FROM messaging_links WHERE platform='telegram' AND user_id=?1)           AS telegram,
       EXISTS(SELECT 1 FROM user_recent_views WHERE user_id=?1)                                 AS viewed,
       (EXISTS(SELECT 1 FROM artifact_comments WHERE author_id=?1)
         OR EXISTS(SELECT 1 FROM comment_reactions WHERE user_id=?1))                           AS commented`
  ).bind(userId, workspaceId).first<Record<string, number>>();
  return {
    firstArtifact: !!row?.firstArtifact,
    dataSource: !!row?.dataSource,
    slack: !!row?.slack,
    alert: !!row?.alert,
    telegram: !!row?.telegram,
    viewed: !!row?.viewed,
    commented: !!row?.commented,
    skillAck,
    assistant: false, // workspace tracks don't use these two
    shared: false,
  };
}

/** Personal-track signals — all user-scoped (no workspace to key on). */
async function getPersonalSignals(env: Env, userId: string, skillAck: boolean): Promise<Pick<Signals, 'firstArtifact' | 'assistant' | 'shared' | 'skillAck'>> {
  const row = await env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM artifacts WHERE owner_id=?1 AND is_example=0 AND deleted_at IS NULL)            AS firstArtifact,
       EXISTS(SELECT 1 FROM agent_threads WHERE scope_type='workspace' AND user_id=?1)                  AS assistant,
       EXISTS(SELECT 1 FROM collaborators c JOIN artifacts a ON a.id=c.artifact_id WHERE a.owner_id=?1)     AS shared`
  ).bind(userId).first<Record<string, number>>();
  return {
    firstArtifact: !!row?.firstArtifact,
    assistant: !!row?.assistant,
    shared: !!row?.shared,
    skillAck,
  };
}

function daysBetween(fromIso: string, now: number): number {
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 86_400_000;
}

/**
 * Full onboarding status for one (workspace, user). Returns null when there is no
 * onboarding surface: no membership, or an external member.
 */
export async function getOnboardingStatus(
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<OnboardingStatus | null> {
  const member = await getMembership(env, workspaceId, userId);
  if (!member) return null;
  if ((member.member_class ?? 'internal') !== 'internal') return null;

  const track: OnboardingTrack = member.role === 'owner' || member.role === 'admin' ? 'admin' : 'member';
  const state = await getState(env, workspaceId, userId);
  const signals = await getSignals(env, workspaceId, userId, !!state?.skill_ack_at);
  return buildStatus(track, signals as unknown as Record<string, boolean>, state, member.created_at, env);
}

interface OnboardingState { skill_ack_at: string | null; dismissed_at: string | null; celebrated_at: string | null }

async function getState(env: Env, workspaceId: string, userId: string): Promise<OnboardingState | null> {
  return env.DB.prepare(
    'SELECT skill_ack_at, dismissed_at, celebrated_at FROM onboarding_state WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<OnboardingState>();
}

/** Shared assembly: task views, required-only pct, and the eligibility window. */
function buildStatus(
  track: OnboardingTrack,
  signals: Record<string, boolean>,
  state: OnboardingState | null,
  joinedAtIso: string,
  env?: Env,
): OnboardingStatus {
  const tasks: OnboardingTaskView[] = tasksForTrack(track, env).map((d) => ({
    key: d.key,
    done: !!signals[d.signal],
    action: d.action,
    skippable: !!d.skippable,
  }));

  // pct over REQUIRED tasks only — skippable ones (Slack) are a bonus and must never
  // block reaching 100% (a workspace with no Slack should still be able to finish).
  const required = tasks.filter((t) => !t.skippable);
  const pct = required.length ? Math.round((required.filter((t) => t.done).length / required.length) * 100) : 100;

  const dismissed = !!state?.dismissed_at;
  const celebrated = !!state?.celebrated_at;
  const recentlyJoined = daysBetween(joinedAtIso, Date.now()) <= ELIGIBLE_WINDOW_DAYS;
  return { track, tasks, pct, eligible: recentlyJoined && pct < 100 && !dismissed, dismissed, celebrated };
}

/** Personal-home checklist — sentinel workspace 'personal', eligibility from account age. */
export const PERSONAL_WS = 'personal';

export async function getPersonalOnboardingStatus(env: Env, userId: string): Promise<OnboardingStatus | null> {
  const user = await env.DB.prepare('SELECT created_at FROM users WHERE id = ?')
    .bind(userId).first<{ created_at: string }>();
  if (!user) return null;
  const state = await getState(env, PERSONAL_WS, userId);
  const signals = await getPersonalSignals(env, userId, !!state?.skill_ack_at);
  return buildStatus('personal', signals as unknown as Record<string, boolean>, state, user.created_at, env);
}
