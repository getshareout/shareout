import type { AccountTool } from './types';
import { presentArtifact } from '../../present/present-artifact';

/** "Make a deck from this dashboard" → an AI-generated sibling slides artifact. */
export const presentArtifactTool: AccountTool = {
  name: 'present_artifact',
  description:
    "Turn a published artifact (dashboard/report/app) into a slides presentation. Generates a deck with AI from the page's content and publishes it as a new PRIVATE artifact in the same workspace. Use when the user says 'make a deck / slides / presentation from this'. Returns the new deck's URL.",
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string', description: 'The artifact to turn into a deck.' },
    },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id.trim() : '';
    if (!artifactId) return { error: 'Tell me which artifact to present (artifact_id).' };
    const result = await presentArtifact(ctx.env, ctx.userId, artifactId);
    if (!result.ok) return { error: result.error };
    return { ok: true, artifact_id: result.artifact_id, url: result.url };
  },
};
