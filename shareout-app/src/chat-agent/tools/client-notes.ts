import type { AccountTool, ToolContext } from './types';
import { getInternalWorkspaceRole } from '../../workspaces';
import { upsertShareeContextFile } from '../../workspace-context';

// Lets the workspace assistant keep a Client's notes current — the AI half of "admin
// or AI can edit". Workspace-private (never shared with the client). Direct write
// (no confirm): it only touches internal account notes. The acting user must be a
// workspace admin; the file is stamped as a user edit (the AI acts on their behalf).
export const setClientNotesTool: AccountTool = {
  name: 'set_client_notes',
  description:
    'Save or update internal notes about a CLIENT (external sharing org) — account intel, preferences, history, next steps. These notes are private to the workspace, never shared with the client, and are auto-loaded into your context next time. Use this to remember what you learn about a client. Workspace admins only.',
  input_schema: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'The client org — its name or id.' },
      note: { type: 'string', description: 'Markdown file name, e.g. "account-notes.md". Defaults to notes.md. Use separate files for distinct topics.' },
      content: { type: 'string', description: 'The full markdown content of the note (replaces the file).' },
    },
    required: ['client', 'content'],
  },
  async execute(ctx: ToolContext, input) {
    const wsId = ctx.selectedWorkspaceId;
    if (!wsId || wsId === '__personal') {
      return { error: 'Open a workspace first — client notes live in a workspace.' };
    }
    const role = await getInternalWorkspaceRole(ctx.env, wsId, ctx.userId);
    if (role !== 'owner' && role !== 'admin') {
      return { error: 'Only a workspace admin can edit client notes.' };
    }

    const clientRef = typeof input.client === 'string' ? input.client.trim() : '';
    const content = typeof input.content === 'string' ? input.content : '';
    let name = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : 'notes.md';
    if (!name.endsWith('.md')) name += '.md';
    if (!clientRef) return { error: 'Tell me which client.' };

    const sharee = await ctx.env.DB.prepare(
      'SELECT id, name FROM sharees WHERE workspace_id = ? AND (id = ? OR lower(name) = lower(?)) LIMIT 1'
    ).bind(wsId, clientRef, clientRef).first<{ id: string; name: string }>();
    if (!sharee) return { error: `No client named "${clientRef}" in this workspace.` };

    const err = await upsertShareeContextFile(ctx.env, wsId, sharee.id, name, content, ctx.userId);
    if (err) return { error: `Couldn’t save the note (${err}).` };
    return { ok: true, client: sharee.name, note: name };
  },
};
