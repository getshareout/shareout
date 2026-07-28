import type { CrewTool } from '../types';
import { getOrCreateAssetBucket } from '../../assets/bucket';
import { summarizeFile } from '../../data/files';

interface Row {
  visibility: string; type_metadata: string | null;
  blob_id: string; r2_key: string; filename: string; mime_type: string; size_bytes: number;
}

// Read a file's content (extracted text for xlsx/pptx/csv/txt/md/json) plus its cached AI
// summary/tags. Scoped to the crew's own workspace file library.
export const fileReadTool: CrewTool = {
  name: 'file_read',
  mode: 'read',
  description: 'Read a workspace file by its id (from file_list). Returns the AI summary, tags, and extracted text content.',
  input_schema: {
    type: 'object',
    properties: { file_id: { type: 'string', description: 'The file id (dlv_…) from file_list.' } },
    required: ['file_id'],
  },
  async execute(ctx, input) {
    const env = ctx.data.env;
    const fileId = String(input.file_id || '').trim();
    if (!fileId) return { error: 'file_id is required' };

    const bucket = await getOrCreateAssetBucket(env, ctx.principal.ownerId, ctx.principal.workspaceId || null);
    const row = await env.DB.prepare(`
      SELECT d.visibility, d.type_metadata,
             b.id AS blob_id, b.r2_key, b.filename, b.mime_type, b.size_bytes
        FROM asset_deliverables d
        JOIN blobs b ON b.deliverable_id = d.id
          AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
       WHERE d.id = ? AND d.bucket_artifact_id = ? AND d.deleted_at IS NULL
    `).bind(fileId, bucket.id).first<Row>();
    if (!row) return { error: `No file "${fileId}" in this workspace's library.` };

    let summary: string | null = null;
    let tags: string[] = [];
    if (row.type_metadata) {
      try {
        const enr = (JSON.parse(row.type_metadata) as { enrichment?: { status: string; blobId: string; summary?: string; tags?: string[] } }).enrichment;
        if (enr && enr.status === 'ok' && enr.blobId === row.blob_id) { summary = enr.summary ?? null; tags = enr.tags ?? []; }
      } catch { /* ignore */ }
    }

    const obj = await env.ARTIFACTS.get(row.r2_key);
    if (!obj) return { error: 'File content missing from storage.' };
    let content: string;
    try { content = summarizeFile(await obj.arrayBuffer(), row.filename, row.mime_type); }
    catch (e) { return { error: `Could not read ${row.filename}: ${e instanceof Error ? e.message : 'parse error'}` }; }

    return { filename: row.filename, mimeType: row.mime_type, summary, tags, content };
  },
};
