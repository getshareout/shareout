// Workspace Files → artifacts in place, against the migrated schema: each convertible file
// becomes a page by its owner in its folder and is soft-deleted; linked or unconvertible
// files are kept and skipped; batches report what is left.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const queueKnowledgeSource = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/knowledge/corpus/ingest', () => ({ queueKnowledgeSource }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';
import { filesToArtifacts, planFilesToArtifacts } from '../../../src/assets/to-artifacts';

const U = 'usr_ta';
const M = 'usr_ta_m';
const WS = 'wsp_ta';
const FLD = 'fld_ta';
let bucket = '';
let n = 0;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(U, 'ta@example.com', 'Ta'),
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(M, 'm@example.com', 'M'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'TA', 'ta-ws', U),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ta', ?, ?, 'owner')").bind(WS, U),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_tm', ?, ?, 'member')").bind(WS, M),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug) VALUES (?, ?, ?, 'SGI', 'sgi')").bind(FLD, WS, U),
  ]);
  bucket = (await getOrCreateAssetBucket(e, U, WS)).id;
});

async function file(name: string, filename: string, body: string, opts: { owner?: string; visibility?: string; usedBy?: string } = {}): Promise<string> {
  const id = `dlv_ta${++n}`;
  const key = `${bucket}/blobs/${id}/${filename}`;
  await e.ARTIFACTS.put(key, body);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, bucket, WS, opts.owner || U, name, opts.visibility || 'team', FLD),
    e.DB.prepare('INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
      .bind(`blob_${id}`, bucket, filename, 'text/markdown', key, body.length, id),
  ]);
  if (opts.usedBy) await e.DB.prepare('INSERT INTO file_artifact_usage (deliverable_id, artifact_id) VALUES (?, ?)').bind(id, opts.usedBy).run();
  return id;
}

const state = (id: string) => e.DB.prepare('SELECT deleted_at, type_metadata FROM asset_deliverables WHERE id = ?').bind(id)
  .first<{ deleted_at: string | null; type_metadata: string | null }>();

describe('files → artifacts', () => {
  it('plans without writing, then converts in batches by owner, folder and visibility', async () => {
    const a = await file('PG-05 Revision Rev.8', 'proc.md', '# Procedimiento\n\nTexto.', { owner: M });
    const b = await file('Notas privadas', 'notas.txt', 'solo mías', { visibility: 'private' });
    const zip = await file('Backup', 'backup.zip', 'PK');
    const linked = await file('Logo', 'logo.md', '# logo', { usedBy: bucket });

    const plan = await planFilesToArtifacts(e, WS);
    expect(plan.files.map((f) => [f.id, f.convertible, f.inUse])).toEqual([[a, true, false], [b, true, false], [zip, false, false], [linked, true, true]]);
    expect((await state(a))!.deleted_at).toBeNull();

    const first = await filesToArtifacts(e, WS, { limit: 2 });
    expect(first.converted.map((c) => c.id)).toEqual([a, b]);
    expect(first.remaining).toBe(2);
    const art = (id: string) => e.DB.prepare('SELECT owner_id, workspace_id, folder_id, visibility, artifact_type FROM artifacts WHERE id = ?').bind(id).first();
    expect(await e.DB.prepare('SELECT name FROM artifacts WHERE id = ?').bind(first.converted[0].artifactId).first('name')).toBe('PG-05 Revision Rev.8');
    expect(await art(first.converted[0].artifactId)).toMatchObject({ owner_id: M, workspace_id: WS, folder_id: FLD, visibility: 'workspace', artifact_type: 'markdown' });
    expect(await art(first.converted[1].artifactId)).toMatchObject({ visibility: 'private', artifact_type: 'txt' });
    // Each new page is learned like any publish (post-publish tasks run without a request context).
    expect(queueKnowledgeSource).toHaveBeenCalledWith(e, expect.anything(), expect.objectContaining({ workspaceId: WS, kind: 'page', refId: first.converted[0].artifactId }), expect.any(String));
    const done = (await state(a))!;
    expect(done.deleted_at).not.toBeNull();
    expect(JSON.parse(done.type_metadata!).toArtifact).toBe(first.converted[0].artifactId);

    const second = await filesToArtifacts(e, WS, { limit: 5 });
    expect(second.converted).toEqual([]);
    expect(second.kept.map((k) => [k.id, k.code])).toEqual([[zip, 'NOT_CONVERTIBLE'], [linked, 'IN_USE']]);
    expect(second.remaining).toBe(0);
    expect((await state(linked))!.deleted_at).toBeNull();

    // A file whose folder was deleted lands at the top level instead of failing.
    const orphan = await file('Logo', 'logo2.md', '# logo');
    await e.DB.prepare("UPDATE asset_deliverables SET folder_id = 'fld_gone' WHERE id = ?").bind(orphan).run();
    const third = await filesToArtifacts(e, WS);
    expect(third.converted.map((c) => c.id)).toEqual([orphan]);
    expect(await art(third.converted[0].artifactId)).toMatchObject({ folder_id: null });

    // Kept files are not retried until asked; a retry clears the marks and tries again.
    expect((await filesToArtifacts(e, WS)).kept).toEqual([]);
    expect((await filesToArtifacts(e, WS, { retry: true, limit: 5 })).kept.map((k) => k.code)).toEqual(['NOT_CONVERTIBLE', 'IN_USE']);
  });
});
