import type { AccountTool } from './types';
import { deriveName } from '../../data/agent/build-page';
import type { PendingAction } from '../actions';

// Build & publish a brand-new ShareOut page from a natural-language spec. The
// heavy generation (strong model) runs only after the user confirms — at propose
// time we just capture the spec, so a long build never blocks the chat turn.
export const createArtifactTool: AccountTool = {
  name: 'create_artifact',
  description:
    "Build and publish a brand-new ShareOut page from a description. Use when the user wants to CREATE a new page/app/dashboard/site from scratch (not edit an existing one — use edit_page for that). Pass a detailed spec of what to build, including purpose, content, and any data/interactivity. The user confirms before it's generated and published.",
  input_schema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'A detailed build instruction: what the page is for, its content, layout, and any live data or interactivity it needs.',
      },
      name: {
        type: 'string',
        description: 'Optional short page name. Derived from the prompt if omitted.',
      },
      source_file_id: {
        type: 'string',
        description: 'Optional file id from list_files or read_file when building from an uploaded/emailed file.',
      },
    },
    required: ['prompt'],
  },
  async execute(_ctx, input): Promise<{ __propose: PendingAction }> {
    const prompt = String(input.prompt || '').trim();
    const name = (typeof input.name === 'string' && input.name.trim()) || deriveName(prompt);
    const sourceFileId = typeof input.source_file_id === 'string' ? input.source_file_id.trim() : '';
    return {
      __propose: {
        kind: 'build_artifact',
        name,
        prompt,
        ...(sourceFileId ? { source_file_id: sourceFileId } : {}),
      },
    };
  },
};
