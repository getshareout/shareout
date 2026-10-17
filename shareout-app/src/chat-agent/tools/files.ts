import type { AccountTool, ToolContext } from './types';
import { getOrCreateAssetBucket, type AssetBucketRow } from '../../assets/bucket';
import { summarizeFile } from '../../data/files';
import { scopedWorkspaceId } from '../scope';

interface FileRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  artifact_id: string;
  source: string | null;
  sender: string | null;
  subject: string | null;
  body_text: string | null;
  used_for: string | null;
}

/** The asset buckets this user may read: personal always, plus the selected
 *  workspace's bucket when they are an internal member of it. */
async function resolveBuckets(ctx: ToolContext): Promise<AssetBucketRow[]> {
  const buckets = [await getOrCreateAssetBucket(ctx.env, ctx.userId, null)];
  const wsId = await scopedWorkspaceId(ctx);
  if (wsId) buckets.push(await getOrCreateAssetBucket(ctx.env, ctx.userId, wsId));
  return buckets;
}

/** True when the file is in the user's personal bucket or, when given, the bucket of a
 *  workspace they are an internal member of (the caller checks that membership). */
export async function fileInUserBuckets(env: ToolContext['env'], userId: string, workspaceId: string | null, fileId: string): Promise<boolean> {
  const buckets = [await getOrCreateAssetBucket(env, userId, null)];
  if (workspaceId) buckets.push(await getOrCreateAssetBucket(env, userId, workspaceId));
  const ids = buckets.map((b) => b.id);
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM blobs WHERE id = ? AND artifact_id IN (${ids.map(() => '?').join(', ')})`
  ).bind(fileId, ...ids).first<{ ok: number }>();
  return !!row;
}

function fileQuery(bucketIds: string[], extraWhere: string): string {
  const ph = bucketIds.map(() => '?').join(', ');
  return `
    SELECT b.id, b.filename, b.mime_type, b.size_bytes, b.created_at, b.artifact_id,
           o.source, o.sender, o.subject, o.body_text,
           (SELECT group_concat(a.name || ' [' || a.id || ']')
              FROM blob_artifact_links l JOIN artifacts a ON a.id = l.artifact_id
             WHERE l.blob_id = b.id AND a.deleted_at IS NULL
               AND (a.owner_id = ? OR a.visibility != 'private')) AS used_for
    FROM blobs b
    LEFT JOIN blob_origins o ON o.blob_id = b.id
    WHERE b.artifact_id IN (${ph}) ${extraWhere}
  `;
}

const ORIGIN_LABEL: Record<string, string> = {
  email: 'emailed in',
  chat: 'attached in chat',
  share_target: 'shared from phone',
};

export const listFilesTool: AccountTool = {
  name: 'list_files',
  description:
    "List files in the user's library (uploads, chat attachments, emailed-in files, phone shares). Shows where each file came from and which artifact it previously built — if the user re-sends a file that built an artifact, propose UPDATING that artifact instead of creating a new one.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional filename substring filter.' },
    },
  },
  async execute(ctx, input) {
    const buckets = await resolveBuckets(ctx);
    const ids = buckets.map(b => b.id);
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    const sql = fileQuery(ids, query ? 'AND b.filename LIKE ? ' : '') +
      ' ORDER BY b.created_at DESC LIMIT 50';
    const binds = query ? [...ids, `%${query}%`] : ids;
    const rows = (await ctx.env.DB.prepare(sql).bind(ctx.userId, ...binds).all<FileRow>()).results || [];

    if (!rows.length) return { files: [], note: 'No files in the library yet.' };
    return {
      files: rows.map(r => ({
        file_id: r.id,
        filename: r.filename,
        sizeKb: Math.round(r.size_bytes / 1000),
        uploadedAt: r.created_at,
        origin: r.source
          ? `${ORIGIN_LABEL[r.source] || r.source}${r.sender ? ` by ${r.sender}` : ''}${r.subject ? `: "${r.subject}"` : ''}`
          : 'uploaded',
        usedForArtifacts: r.used_for || null,
      })),
    };
  },
};

export const readFileTool: AccountTool = {
  name: 'read_file',
  description:
    'Read a file from the library as text: spreadsheets (xlsx/csv) return sheet schemas plus sample rows, presentations (pptx) return slide text, text files return content. Use whenever a user message references an attached file id, or before building/updating an artifact from a file. Large files are summarized, never dumped.',
  input_schema: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'The file id from list_files or the attached-file reference in the message.' },
    },
    required: ['file_id'],
  },
  async execute(ctx, input) {
    const fileId = String(input.file_id || '').trim();
    if (!fileId) return { error: 'file_id is required' };

    const buckets = await resolveBuckets(ctx);
    const ids = buckets.map(b => b.id);
    // Authorization: the blob must live in one of the caller's own buckets.
    const row = await ctx.env.DB.prepare(
      fileQuery(ids, 'AND b.id = ? ')
    ).bind(ctx.userId, ...ids, fileId).first<FileRow & { r2_key?: string }>();
    if (!row) return { error: `No file "${fileId}" in your library.` };

    const meta = await ctx.env.DB.prepare(
      'SELECT r2_key FROM blobs WHERE id = ?'
    ).bind(fileId).first<{ r2_key: string }>();
    const obj = meta && await ctx.env.ARTIFACTS.get(meta.r2_key);
    if (!obj) return { error: 'File content missing from storage.' };

    let content: string;
    try {
      content = summarizeFile(await obj.arrayBuffer(), row.filename, row.mime_type);
    } catch (e) {
      return { error: `Could not read ${row.filename}: ${e instanceof Error ? e.message : 'parse error'}` };
    }

    // Prepend the cached AI summary/tags when this blob is the enriched (latest) version —
    // cheap context the model gets for free, and it works for types summarizeFile can't read.
    const enr = await ctx.env.DB.prepare(
      'SELECT d.type_metadata FROM blobs b JOIN asset_deliverables d ON d.id = b.deliverable_id WHERE b.id = ?'
    ).bind(fileId).first<{ type_metadata: string | null }>();
    let summary: { summary?: string; tags?: string[] } | null = null;
    if (enr?.type_metadata) {
      try {
        const e = (JSON.parse(enr.type_metadata) as { enrichment?: { status: string; blobId: string; summary?: string; tags?: string[] } }).enrichment;
        if (e && e.status === 'ok' && e.blobId === fileId) summary = { summary: e.summary, tags: e.tags };
      } catch { /* ignore malformed metadata */ }
    }

    return {
      filename: row.filename,
      usedForArtifacts: row.used_for || null,
      emailContext: row.body_text ? row.body_text.slice(0, 2000) : null,
      aiSummary: summary?.summary || null,
      aiTags: summary?.tags || null,
      content,
    };
  },
};
