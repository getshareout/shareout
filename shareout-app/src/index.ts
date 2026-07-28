import type { Env, ViewEventMessage } from './types';
import { RealtimeCoordinator } from './realtime/coordinator';
import { CommentsCoordinator } from './realtime/comments-coordinator';
import { MiniDB } from './data/minidb';
import { ChatDO } from './chat-agent/session-do';
import { PresenceCoordinator } from './realtime/presence-coordinator';
import { Showtime } from './demo/showtime';
import { handleScheduledEvent } from './scheduling/handler';
import { handleViewEventBatch } from './analytics';
import { logScheduledRun, withRequestLogging } from './request-logging';
import { handleFetch } from './router/handle-fetch';
import { handleInboundEmail } from './email/inbound';

export { RealtimeCoordinator, CommentsCoordinator, MiniDB, ChatDO, PresenceCoordinator, Showtime };

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(logScheduledRun(env, () => handleScheduledEvent(env, event.scheduledTime)));
  },

  // Cloudflare Email Routing inbound handler (catch-all on inbox.shareout.site).
  // Resolves the recipient to an opt-in artifact inbox, stores the message, and
  // fires the email.received event. Rejects unknown/disabled/spoofed recipients.
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleInboundEmail(message, env, ctx);
  },

  // Batched analytics view-event ingest (opt-006). Other queues are ignored here.
  async queue(batch: MessageBatch<ViewEventMessage>, env: Env): Promise<void> {
    if (batch.queue === 'shareout-analytics-views') {
      await handleViewEventBatch(batch, env);
    }
  },

  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withRequestLogging(request, env, ctx, (req, environment) => handleFetch(req, environment, ctx));
  },
};
