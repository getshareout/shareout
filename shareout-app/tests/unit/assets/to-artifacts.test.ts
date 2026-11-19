// Workspace Files → artifacts in place, against the migrated schema: each convertible file
// becomes a page by its owner in its folder and is soft-deleted; linked or unconvertible
// files are kept and skipped; batches report what is left. A retried call (client timeout)
// never makes a second page of the same file.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const queueKnowledgeSource = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/knowledge/corpus/ingest', () => ({ queueKnowledgeSource }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';
import { filesToArtifacts, planFilesToArtifacts } from '../../../src/assets/to-artifacts';
import { convertToPage } from '../../../src/file-imports/convert';

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

const livePages = () => e.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE workspace_id = ? AND deleted_at IS NULL').bind(WS).first<number>('n');
const claimed = (id: string, slug: string, minutesAgo: number) => e.DB.prepare(`
  UPDATE asset_deliverables SET type_metadata = json_set(COALESCE(type_metadata, '{}'), '$.toArtifact', json_object('claim', ?, 'at', ?)) WHERE id = ?
`).bind(slug, new Date(Date.now() - minutesAgo * 60_000).toISOString(), id).run();

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

  it('two calls at once (a client retrying after a timeout) make one page per file', async () => {
    const ids = [await file('Acme A', 'a.md', '# A'), await file('Acme B', 'b.md', '# B'), await file('Acme C', 'c.md', '# C')];
    const before = await livePages();
    const [x, y] = await Promise.all([filesToArtifacts(e, WS, { limit: 5 }), filesToArtifacts(e, WS, { limit: 5 })]);
    expect([...x.converted, ...y.converted].map((c) => c.id).sort()).toEqual([...ids].sort());
    expect(await livePages()).toBe(before! + 3);
    // Whichever call finished first saw the other's file still in progress; once both are done, nothing is.
    expect(await filesToArtifacts(e, WS)).toMatchObject({ converted: [], inProgress: 0, remaining: 0 });
  });

  it('leaves a file another call holds, and takes over a dead call without a second page', async () => {
    const held = await file('Acme held', 'held.md', '# held');
    await claimed(held, 'acme-held-aaaaaa', 1);
    const busy = await filesToArtifacts(e, WS);
    expect(busy).toMatchObject({ converted: [], kept: [], inProgress: 1, remaining: 0 });
    expect((await planFilesToArtifacts(e, WS)).files.map((f) => f.id)).not.toContain(held);

    // The holder published its page, then died before marking the file: that page is reused.
    const page = await convertToPage(e, {
      user: { id: U, email: 'ta@example.com' }, workspaceId: WS, folderId: FLD, visibility: 'workspace',
      filename: 'held.md', displayName: 'Acme held.md', bytes: new TextEncoder().encode('# held'), slug: 'acme-held-aaaaaa',
    });
    if (!page.ok) throw new Error(page.message);
    await claimed(held, 'acme-held-aaaaaa', 16);
    const before = await livePages();
    const took = await filesToArtifacts(e, WS);
    expect(took.converted).toEqual([{ id: held, name: 'Acme held', artifactId: page.artifactId, slug: 'acme-held-aaaaaa' }]);
    expect(took.inProgress).toBe(0);
    expect(await livePages()).toBe(before);
    expect(JSON.parse((await state(held))!.type_metadata!).toArtifact).toBe(page.artifactId);

    // The holder died before publishing: converted now, under the slug it claimed.
    const lost = await file('Acme lost', 'lost.md', '# lost');
    await claimed(lost, 'acme-lost-bbbbbb', 16);
    const again = await filesToArtifacts(e, WS);
    expect(again.converted.map((c) => [c.id, c.slug])).toEqual([[lost, 'acme-lost-bbbbbb']]);
    expect(await e.DB.prepare('SELECT display_slug FROM artifacts WHERE id = ?').bind(again.converted[0].artifactId).first('display_slug')).toBe('acme-lost-bbbbbb');
  });
});
