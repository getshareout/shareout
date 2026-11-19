import type { Env } from '../types';
import { checkSlidingWindowRateLimit } from '../rate-limit';
import { sendDirectMessage, type MessageError, type SendInput, type SendOk } from './store';
import { notifyDirectMessage } from './notify';

/** Send a direct message from any surface: the per-sender ceiling, the rules (store.ts), then the
 *  recipient's Telegram ping. `defer` lets a request answer before the ping goes out. */
export async function sendAndNotify(
  env: Env, input: SendInput, defer?: (work: Promise<unknown>) => void,
): Promise<SendOk | MessageError> {
  const rl = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `dm:${input.senderId}`, 'directMessage');
  if (!rl.allowed) {
    return { ok: false, status: 429, code: 'RATE_LIMITED', message: 'Too many messages in the last hour. Try again later.' };
  }
  const sent = await sendDirectMessage(env, input);
  if (sent.ok) {
    const ping = notifyDirectMessage(env, input.workspaceId, input.senderId, sent);
    if (defer) defer(ping); else await ping;
  }
  return sent;
}
