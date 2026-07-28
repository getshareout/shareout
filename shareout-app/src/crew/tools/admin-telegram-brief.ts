import { requireSuperAdminOwner } from './superadmin-guard';
import { defaultReportDate, getDailyPlatformDigest } from '../../superadmin/digest';
import { deliverCeoBrief } from '../../superadmin/brief-deliver';
import type { CrewTool } from '../types';

const MAX_NOTES = 1200;

export const adminTelegramBriefTool: CrewTool = {
  name: 'admin_telegram_brief',
  mode: 'write',
  defaultApproval: 'never',
  description:
    'Send the CEO daily brief to Telegram: dashboard chart image, compact data tables, and your CEO notes. Deduped once per report day (use force only for explicit re-send). Super-admin only. Call ONCE at the end — do not use admin_telegram_notify for the full report.',
  input_schema: {
    type: 'object',
    properties: {
      ceoNotes: {
        type: 'string',
        description: 'Short analyst notes only (celebrate / watch / focus today). Max ~1200 chars. Data tables are auto-generated.',
      },
      date: { type: 'string', description: 'Report day YYYY-MM-DD. Omit for yesterday.' },
      force: { type: 'boolean', description: 'Re-send even if already delivered today. Default false.' },
    },
    required: ['ceoNotes'],
  },
  async execute(ctx, input) {
    const denied = await requireSuperAdminOwner(ctx.data.env, ctx.principal.ownerId);
    if (denied) return { error: denied };

    const notes = typeof input.ceoNotes === 'string' ? input.ceoNotes.trim() : '';
    if (!notes) return { error: 'Provide ceoNotes (your analyst interpretation).' };
    if (notes.length > MAX_NOTES) {
      return { error: `ceoNotes too long (${notes.length}). Max ${MAX_NOTES}.` };
    }

    const date =
      typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
        ? input.date
        : defaultReportDate();

    const digest = await getDailyPlatformDigest(ctx.data.env, date);
    const force = input.force === true;
    const result = await deliverCeoBrief(ctx.data.env, digest, notes, { force });

    if (result.skippedDuplicate) {
      return { delivered: false, skippedDuplicate: true, message: `Brief for ${date} already sent — use force:true to re-send.` };
    }
    if (!result.delivered) {
      return { error: result.error || 'Telegram delivery failed' };
    }
    return {
      delivered: true,
      reportDate: date,
      sentChart: result.sentChart,
      sentTables: result.sentTables,
      sentNotes: result.sentNotes,
    };
  },
};
