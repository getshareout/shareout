/** Onboarding UI-state upserts (work/033). Only the three non-derivable fields. */
import type { Env } from '../types';
import { PERSONAL_WS } from './status';

type StateCol = 'skill_ack_at' | 'dismissed_at' | 'celebrated_at';

async function stamp(env: Env, workspaceId: string, userId: string, col: StateCol): Promise<void> {
  if (workspaceId === PERSONAL_WS) {
    await env.DB.prepare(
      `INSERT INTO onboarding_personal_state (user_id, ${col})
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(user_id) DO UPDATE SET ${col} = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).bind(userId).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO onboarding_state (workspace_id, user_id, ${col})
       VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET ${col} = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspaceId, userId).run();
}

export const markDismissed = (env: Env, ws: string, uid: string) => stamp(env, ws, uid, 'dismissed_at');
export const markSkillAck = (env: Env, ws: string, uid: string) => stamp(env, ws, uid, 'skill_ack_at');
export const markCelebrated = (env: Env, ws: string, uid: string) => stamp(env, ws, uid, 'celebrated_at');
