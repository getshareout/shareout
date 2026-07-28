import type { AccountTool, ToolContext } from './types';
import type { PendingAction } from '../actions';
import { resolveArtifactAccessForUser } from '../access';
import { parseCronSchedule } from '../../scheduling/jobs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function artifactName(ctx: ToolContext, artifactId: string): Promise<string> {
  const row = await ctx.env.DB.prepare('SELECT name FROM artifacts WHERE id = ?').bind(artifactId).first<{ name: string }>();
  return row?.name?.trim() || 'page';
}

async function ownEmail(ctx: ToolContext): Promise<string | null> {
  const row = await ctx.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(ctx.userId).first<{ email: string | null }>();
  return row?.email?.toLowerCase() || null;
}

export const createScheduleTool: AccountTool = {
  name: 'create_schedule',
  description:
    'Set up a recurring email of a page on a schedule (e.g. "email me this dashboard every Monday 9am"). Owner/editor only. Translate the user\'s timing into a 5-field cron (minute hour day month weekday, UTC). Defaults to emailing the user themselves. Asks the user to confirm before creating.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string', description: 'The page to send.' },
      schedule: { type: 'string', description: '5-field cron in UTC, e.g. "0 9 * * 1" for Mondays 09:00 UTC.' },
      recipients: { type: 'array', items: { type: 'string' }, description: 'Email addresses (default: the user themselves).' },
      subject: { type: 'string', description: 'Email subject (default: the page name).' },
      attach_pdf: { type: 'boolean', description: 'Attach a rendered PDF of the page (default false).' },
    },
    required: ['artifact_id', 'schedule'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const schedule = typeof input.schedule === 'string' ? input.schedule.trim() : '';
    if (!artifactId) return { error: 'Which page should I schedule?' };
    if (!schedule) return { error: 'Tell me when to send it (I need a cron schedule).' };

    const cron = parseCronSchedule(schedule);
    if (!cron.valid) return { error: cron.error || 'That schedule isn’t a valid 5-field cron.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };
    if (access.role !== 'owner' && access.role !== 'editor') return { error: 'Only the owner or an editor can schedule a page.' };

    let recipients = Array.isArray(input.recipients)
      ? input.recipients.filter((e): e is string => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))
      : [];
    if (recipients.length === 0) {
      const self = await ownEmail(ctx);
      if (!self) return { error: 'I couldn’t find an email to send to — give me a recipient address.' };
      recipients = [self];
    }

    const name = await artifactName(ctx, artifactId);
    const proposal: PendingAction = {
      kind: 'job_create',
      artifactId,
      artifactName: name,
      schedule,
      recipients,
      subject: typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim() : name,
      includePdf: input.attach_pdf === true,
    };
    return { __propose: proposal };
  },
};
