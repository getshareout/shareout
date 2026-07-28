/**
 * Job authorization — viewer self-delivery rules and manage checks.
 */
import type { Env } from '../../types';
import { getUserRole } from '../../artifacts';
import type {
  EmailConfig,
  JobAction,
  JobConfig,
  SlackConfig,
  TelegramConfig,
} from './types';

/**
 * Viewers may only schedule delivery to themselves (Slack DM, own email, own Telegram).
 * Returns an error string when the request is not allowed, else null.
 */
export async function checkViewerSelfDelivery(
  env: Env,
  userId: string,
  action: JobAction,
  config: JobConfig,
): Promise<string | null> {
  if (action === 'slack') {
    const c = config as SlackConfig;
    if (c.targetType !== 'dm' || !c.slackUserId) {
      return 'Viewers can only schedule a Slack DM to themselves (set targetType "dm" and your Slack member id)';
    }
    return null;
  }
  if (action === 'email') {
    const c = config as EmailConfig;
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(userId).first<{ email: string | null }>();
    const email = (user?.email || '').toLowerCase();
    const recipients = (c.recipients || []).map(r => r.toLowerCase());
    if (!email || recipients.length !== 1 || recipients[0] !== email) {
      return 'Viewers can only schedule email delivery to their own account address';
    }
    return null;
  }
  if (action === 'telegram') {
    const c = config as TelegramConfig;
    if (c.chatId) return 'Viewers can only send to their own linked Telegram (omit chatId)';
    return null;
  }
  return 'Viewers can only schedule a Slack DM, email, or Telegram message to themselves';
}

/** A user may manage a job if they created it or own the underlying artifact. */
export async function canManageJob(
  env: Env,
  job: { owner_id: string; artifact_id: string },
  userId: string,
): Promise<boolean> {
  if (job.owner_id === userId) return true;
  const role = await getUserRole(env, job.artifact_id, userId);
  return role === 'owner';
}
