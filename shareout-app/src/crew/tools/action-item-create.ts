import { createCommentForTool } from '../../data/comments';
import type { CrewTool } from '../types';

export const actionItemCreateTool: CrewTool = {
  name: 'action_item_create',
  mode: 'write',
  defaultApproval: 'never',
  description:
    'Create an action item on this artifact — a comment assigned to a person (must be a workspace member or collaborator). They get notified.',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The action item text.' },
      assignee_email: { type: 'string', description: 'Email of the person to assign. Must be a workspace member or collaborator.' },
      due_at: { type: 'string', description: 'Optional ISO date string for when this is due.' },
    },
    required: ['content', 'assignee_email'],
  },
  async execute(ctx, input) {
    const content = typeof input.content === 'string' ? input.content : '';
    if (!content) return { error: 'Missing required field "content".' };
    const assigneeEmail = typeof input.assignee_email === 'string' ? input.assignee_email : '';
    if (!assigneeEmail) return { error: 'Missing required field "assignee_email".' };
    const dueAt = typeof input.due_at === 'string' ? input.due_at : undefined;

    const res = await createCommentForTool(
      ctx.data,
      { id: ctx.principal.crewId, name: 'Crew' },
      { content, assigneeEmail, dueAt }
    );
    if ('error' in res) return res;
    return {
      commentId: res.comment.id,
      assigneeEmail: res.comment.assigneeEmail,
      dueAt: res.comment.dueAt ?? null,
    };
  },
};
