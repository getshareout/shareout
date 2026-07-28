import { createCommentForTool } from '../../data/comments';
import type { CrewTool } from '../types';

export const commentCreateTool: CrewTool = {
  name: 'comment_create',
  mode: 'write',
  defaultApproval: 'never',
  description: "Post a comment on this app (shown in the comments panel). Use to leave a note or summary for people viewing the app.",
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The comment text.' },
      contextId: { type: 'string', description: 'Optional context/thread id to attach the comment to.' },
    },
    required: ['content'],
  },
  async execute(ctx, input) {
    const content = typeof input.content === 'string' ? input.content : '';
    if (!content) return { error: 'Missing required field "content".' };
    const res = await createCommentForTool(
      ctx.data,
      { id: ctx.principal.crewId, name: 'Crew' },
      { content, contextId: typeof input.contextId === 'string' ? input.contextId : undefined }
    );
    if ('error' in res) return res;
    return { commentId: res.comment.id, created: true };
  },
};
