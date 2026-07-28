import { notifyAdmin } from '../../observability/alerts';
import { isSuperAdminEmail } from '../../superadmin/auth';
import type { CrewTool } from '../types';

const MAX_LEN = 4090; // Telegram hard limit is 4096

export const adminTelegramNotifyTool: CrewTool = {
  name: 'admin_telegram_notify',
  mode: 'write',
  defaultApproval: 'never',
  description:
    'Send a Telegram message to the ShareOut platform admin (super-admin linked chat). Use at the end of a daily ops report. Super-admin only.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Plain-text summary to deliver (keep under 4000 chars).' },
    },
    required: ['message'],
  },
  async execute(ctx, input) {
    const row = await ctx.data.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(ctx.principal.ownerId)
      .first<{ email: string | null }>();
    if (!isSuperAdminEmail(row?.email)) {
      return { error: 'This tool is only available to ShareOut platform super-admins.' };
    }

    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message) return { error: 'Provide a non-empty "message".' };
    if (message.length > MAX_LEN) {
      return { error: `Message too long (${message.length} chars). Max ${MAX_LEN}.` };
    }

    const delivered = await notifyAdmin(ctx.data.env, message);
    return delivered ? { delivered: true } : { error: 'Telegram delivery failed — link Telegram in ShareOut Settings.' };
  },
};
