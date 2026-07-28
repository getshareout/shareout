import type { CrewTool } from '../types';
import { getOrCreateAssetBucket } from '../../assets/bucket';
import { listDeliverables } from '../../assets/deliverables';

// List the workspace's Files (asset library) so a crew can find a document by name/summary.
export const fileListTool: CrewTool = {
  name: 'file_list',
  mode: 'read',
  description: "List files in the workspace's file library (name, type, size, and — when available — an AI summary and tags). Use before file_read to find a file id.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const env = ctx.data.env;
    const bucket = await getOrCreateAssetBucket(env, ctx.principal.ownerId, ctx.principal.workspaceId || null);
    const files = await listDeliverables(env, bucket.id);
    return {
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        summary: f.enrichment?.status === 'ok' ? f.enrichment.summary ?? null : null,
        tags: f.enrichment?.status === 'ok' ? f.enrichment.tags ?? [] : [],
        usedInArtifacts: f.usageCount,
      })),
    };
  },
};
