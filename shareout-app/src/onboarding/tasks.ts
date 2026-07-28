/**
 * Onboarding task + track definitions (work/033). The server returns task KEYS and
 * done flags only — all display copy lives client-side in HOME_COPY (t('onb.<key>.*'))
 * so it localizes (en/es) without the worker holding user-facing strings.
 *
 * `action` tells the dock how a task's inline button behaves (see onboarding.ts):
 *   ask   → seed a guided agent chat (agentAsk)
 *   nav   → switch to a home lens (target)
 *   page  → open a same-origin connect page in a new tab (url)
 *   skill → ack "got the skill" + open the skill library
 */
import type { Env } from '../types';

export type OnboardingTrack = 'admin' | 'member' | 'personal';

export type OnboardingAction =
  | { kind: 'ask'; seedKey: string }
  | { kind: 'nav'; target: string }
  | { kind: 'page'; url: string }
  | { kind: 'skill' };

export interface OnboardingTaskDef {
  key: string;
  /** which live signal proves it done (see status.ts Signals) */
  signal: string;
  action: OnboardingAction;
  /** skippable tasks render a "Skip" affordance and don't block 100% weighting */
  skippable?: boolean;
}

export const ADMIN_TASKS: OnboardingTaskDef[] = [
  { key: 'first_artifact', signal: 'firstArtifact', action: { kind: 'ask', seedKey: 'onb.seed.firstArtifact' } },
  { key: 'data_source', signal: 'dataSource', action: { kind: 'nav', target: 'connectors' } },
  { key: 'telegram', signal: 'telegram', action: { kind: 'page', url: '/settings/telegram?go=1' } },
  { key: 'slack', signal: 'slack', action: { kind: 'page', url: '/settings/slack' }, skippable: true },
  { key: 'alert', signal: 'alert', action: { kind: 'ask', seedKey: 'onb.seed.alert' } },
  { key: 'skill', signal: 'skillAck', action: { kind: 'skill' } },
];

export const MEMBER_TASKS: OnboardingTaskDef[] = [
  { key: 'explore', signal: 'viewed', action: { kind: 'nav', target: 'artifacts' } },
  { key: 'comment', signal: 'commented', action: { kind: 'nav', target: 'artifacts' } },
  { key: 'telegram', signal: 'telegram', action: { kind: 'page', url: '/settings/telegram?go=1' } },
  { key: 'skill_publish', signal: 'firstArtifact', action: { kind: 'skill' } },
];

// Personal track: a solo user on their own home (no workspace). Every signal is
// user-scoped — the workspace-scoped ones (Slack, alerts, connectors) don't apply to
// a NULL workspace, so the ladder is publish → try the assistant → share → get the skill.
export const PERSONAL_TASKS: OnboardingTaskDef[] = [
  { key: 'first_artifact', signal: 'firstArtifact', action: { kind: 'ask', seedKey: 'onb.seed.firstArtifact' } },
  { key: 'try_assistant', signal: 'assistant', action: { kind: 'ask', seedKey: 'onb.seed.tryAssistant' } },
  { key: 'share_page', signal: 'shared', action: { kind: 'nav', target: 'artifacts' } },
  { key: 'skill', signal: 'skillAck', action: { kind: 'skill' } },
];

/**
 * Integrations a task depends on. A checklist must not show a step the instance
 * cannot perform: the `telegram` task completes only when a user links a Telegram
 * account, which needs a bot token. On an instance without one the signal can never
 * fire, and since `pct` is measured over non-skippable tasks (see status.ts), the
 * checklist could never reach 100% and the finish moment never fired.
 */
const TASK_REQUIRES: Record<string, (env: Env) => boolean> = {
  telegram: (env) => Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
  slack: (env) => Boolean(env.SLACK_CLIENT_ID?.trim() && env.SLACK_CLIENT_SECRET?.trim()),
};

/**
 * Tasks for a track, minus any whose integration this instance has not configured.
 * `env` is optional so existing callers and tests keep the full ladder.
 */
export function tasksForTrack(track: OnboardingTrack, env?: Env): OnboardingTaskDef[] {
  const all = track === 'personal' ? PERSONAL_TASKS : track === 'admin' ? ADMIN_TASKS : MEMBER_TASKS;
  if (!env) return all;
  return all.filter((t) => {
    const requires = TASK_REQUIRES[t.key];
    return !requires || requires(env);
  });
}
