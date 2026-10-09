import type { AccountTool } from './types';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { openTicket } from '../../support/intake';
import { TICKET_CATEGORIES, TICKET_SEVERITIES, type TicketCategory, type TicketSeverity } from '../../support/store';

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Escape hatch: when the user is stuck, put it in front of the support team with context. */
export const reportProblemTool: AccountTool = {
  name: 'report_problem',
  description:
    'Open a support ticket for the user so the ShareOut team sees it. Use it when the user is stuck, '
    + 'hits an error you cannot resolve, asks for a human, or reports a bug — do not leave them without a next step. '
    + 'Include what they were trying to do, what you already tried, and any error text. '
    + 'After it succeeds, tell the user in their own language that the team was notified and that the reply will '
    + 'show up in Help & support and by email.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One line: what is wrong.' },
      details: { type: 'string', description: 'What the user was doing, what happened, the exact error text, and what you already tried.' },
      category: { type: 'string', enum: [...TICKET_CATEGORIES] },
      severity: { type: 'string', enum: [...TICKET_SEVERITIES], description: 'blocker = the user cannot work at all.' },
      artifact_id: { type: 'string', description: 'The page involved, if any.' },
      request_id: { type: 'string', description: 'request_id from an error response, if one was shown.' },
      language: { type: 'string', enum: ['en', 'es'], description: 'The language the user writes in.' },
    },
    required: ['summary', 'details'],
  },
  async execute(ctx, input) {
    const summary = str(input.summary, 300);
    const details = str(input.details, 8000);
    if (!summary || !details) return { error: 'summary and details are required.' };
    const ws = ctx.selectedWorkspaceId && ctx.selectedWorkspaceId !== PERSONAL_SCOPE ? ctx.selectedWorkspaceId : null;
    const workspaceId = ws && (await getInternalWorkspaceRole(ctx.env, ws, ctx.userId)) ? ws : null;
    const category = TICKET_CATEGORIES.includes(input.category as TicketCategory) ? (input.category as TicketCategory) : 'bug';
    const severity = TICKET_SEVERITIES.includes(input.severity as TicketSeverity) ? (input.severity as TicketSeverity) : 'normal';
    const ticket = await openTicket(ctx.env, {
      workspaceId,
      requesterUserId: ctx.userId,
      channel: 'ui',
      subject: summary,
      body: details,
      category,
      severity,
      client: 'chat_agent',
      artifactId: str(input.artifact_id, 200),
      requestId: str(input.request_id, 200),
      locale: input.language === 'es' ? 'es' : input.language === 'en' ? 'en' : null,
    });
    return { ok: true, ticket_id: ticket.id, next: 'Tell the user the team was notified; replies arrive in Help & support and by email.' };
  },
};
