// "Where is this covered?" from a chat surface: a multi-page site (procedures index + one
// sub-page per procedure, numbered sections with ids) answers with the artifact, the
// sub-page, the section heading and a deep link — from a live scan when Knowledge is off,
// from the section-chunked corpus when it is on — and never from a page the member can't open.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { findPassagesTool, type Passage } from '../../../src/chat-agent/tools/passages';
import { readArtifactTool } from '../../../src/chat-agent/tools/artifacts';
import { listVersionsTool, listCommentsTool, resolveCommentTool, restoreVersionTool } from '../../../src/chat-agent/tools/history';
import { executeAction, describeAction, type PendingAction } from '../../../src/chat-agent/actions';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { setKnowledgeEnabled } from '../../../src/knowledge';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

const WS = 'wsp_fp_acme';
const ALICE = 'usr_fp_alice';
const BOB = 'usr_fp_bob';
const CAROL = 'usr_fp_carol';
const SITE = 'art_fp_procs';
const DRAFT = 'art_fp_draft';

const INDEX = `<!doctype html><html><head><title>Procedures</title></head><body>
<h1>Procedures index</h1><ul><li><a href="procedures/waste.html">Waste management</a></li><li><a href="procedures/safety.html">Site safety</a></li></ul></body></html>`;
const WASTE = `<!doctype html><html><head><title>Waste management</title></head><body>
<h1>Waste management procedure</h1>
<h2 id="sec-1">1. Scope</h2><p>Applies to every site operated by Acme.</p>
<h2 id="sec-3">3. Waste classification</h2><p>3.1 Classify each waste stream as hazardous or non-hazardous before it leaves the site.</p>
<p>3.2 Identify hazardous waste by the orange label on its container and the safety data sheet.</p>
<h2 id="sec-4">4. Storage</h2><p>Keep containers closed and away from drains.</p></body></html>`;
const SAFETY = `<!doctype html><html><head><title>Site safety</title></head><body><h1>Site safety</h1><h2>1. Helmets</h2><p>Wear a helmet on site.</p></body></html>`;
const DRAFT_HTML = `<!doctype html><html><body><h1>Draft</h1><h2 id="x">Waste classification rewrite</h2><p>Secret draft: classification of hazardous waste changes next year.</p></body></html>`;

const ctx = (userId: string, ws: string | null = WS): ToolContext => ({ env: e, userId, selectedWorkspaceId: ws });
const passages = async (userId: string, query: string, ws: string | null = WS) =>
  (await findPassagesTool.execute(ctx(userId, ws), { query })) as { mode: string; passages: Passage[]; error?: string };

async function publish(id: string, slug: string, name: string, owner: string, visibility: string, pages: Record<string, string>) {
  const ver = `ver_${id}`;
  const stmts = [
    e.DB.prepare('INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)').bind(id, owner, name, slug, visibility, WS),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES (?, ?, 1, 'index.html')").bind(ver, id),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, ver, slug),
  ];
  for (const [path, html] of Object.entries(pages)) {
    const key = `test/fp/${id}/${path}`;
    await e.ARTIFACTS.put(key, html);
    stmts.push(e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, ?, ?, 'text/html', ?, 'x')")
      .bind(`ast_${id}_${path}`, ver, path, key, html.length));
  }
  await e.DB.batch(stmts);
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'alice@example.com', 'Alice'), (?, 'bob@example.com', 'Bob'), (?, 'carol@example.com', 'Carol')")
      .bind(ALICE, BOB, CAROL),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-fp', ?)").bind(WS, BOB),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_fp_1', ?, ?, 'owner', 'internal'), ('wm_fp_2', ?, ?, 'member', 'internal')`).bind(WS, BOB, WS, ALICE),
  ]);
  await publish(SITE, 'acme-procedures', 'Procedures', BOB, 'workspace', {
    'index.html': INDEX, 'procedures/waste.html': WASTE, 'procedures/safety.html': SAFETY,
  });
  await publish(DRAFT, 'bob-draft', 'Draft notes', BOB, 'private', { 'index.html': DRAFT_HTML });
});

const WASTE_URL = 'https://shareout.test/a/acme-procedures/?page=procedures/waste.html&section=sec-3';

describe('find_passages — live scan (Knowledge off)', () => {
  it('returns the sub-page, the numbered section, an excerpt and a deep link', async () => {
    const r = await passages(ALICE, 'waste classification');
    expect(r.mode).toBe('scan');
    expect(r.passages[0]).toMatchObject({
      artifact: { id: SITE, title: 'Procedures' },
      page: 'procedures/waste.html',
      page_title: 'Waste management',
      section: '3. Waste classification',
      url: WASTE_URL,
    });
    expect(r.passages[0].excerpt).toContain('hazardous');
  });

  it('never returns a passage from a page the member cannot open', async () => {
    const alice = await passages(ALICE, 'waste classification');
    expect(alice.passages.map((p) => p.artifact.id)).not.toContain(DRAFT);
    const bob = await passages(BOB, 'secret draft classification');
    expect(bob.passages.map((p) => p.artifact.id)).toContain(DRAFT);
    expect((await passages(CAROL, 'waste classification', null)).passages).toEqual([]);
    expect(await passages(CAROL, 'waste classification')).toHaveProperty('error');
  });
});

describe('find_passages — knowledge corpus (Knowledge on)', () => {
  beforeAll(async () => {
    await setKnowledgeEnabled(e, WS, true);
    await queueKnowledgeSource(e, undefined, { workspaceId: WS, kind: 'page', refId: SITE }, `ver_${SITE}`);
    await queueKnowledgeSource(e, undefined, { workspaceId: WS, kind: 'page', refId: DRAFT }, `ver_${DRAFT}`);
  });

  it('learns every sub-page by section and cites page + section + link', async () => {
    const r = await passages(ALICE, 'waste classification');
    expect(r.mode).toBe('indexed');
    expect(r.passages[0]).toMatchObject({
      artifact: { id: SITE },
      page: 'procedures/waste.html',
      page_title: 'Waste management',
      section: '3. Waste classification',
      url: WASTE_URL,
    });
  });

  it('works from the all-pages scope too, and hides private pages', async () => {
    const r = await passages(ALICE, 'waste classification', null);
    expect(r.passages[0].url).toBe(WASTE_URL);
    expect(r.passages.map((p) => p.artifact.id)).not.toContain(DRAFT);
  });
});

describe('page links and review tools', () => {
  it('read_artifact gives absolute links for the page and each sub-page, and reads one sub-page', async () => {
    const r = (await readArtifactTool.execute(ctx(ALICE), { artifact_id: SITE, page: 'procedures/waste.html' })) as {
      url: string; pages: { path: string; url: string }[]; reportText: string;
    };
    expect(r.url).toBe('https://shareout.test/a/acme-procedures/?page=procedures/waste.html');
    expect(r.pages[0]).toEqual({ path: 'index.html', url: 'https://shareout.test/a/acme-procedures/' });
    expect(r.pages.map((p) => p.path)).toContain('procedures/safety.html');
    expect(r.reportText).toContain('orange label');
  });

  it('list_versions and list_comments are read-only and gated', async () => {
    await e.DB.prepare("INSERT INTO artifact_comments (id, artifact_id, author_name, content, resolved) VALUES ('cmt_fp_1', ?, 'Alice', 'Check 3.2', 0)").bind(SITE).run();
    const v = (await listVersionsTool.execute(ctx(BOB), { artifact_id: SITE })) as { versions: { version: number; live: boolean }[] };
    expect(v.versions[0]).toMatchObject({ version: 1, live: true });
    // Same rule as the REST history route: a workspace viewer is not a collaborator.
    expect(await listVersionsTool.execute(ctx(ALICE), { artifact_id: SITE })).toHaveProperty('error');
    const c = (await listCommentsTool.execute(ctx(ALICE), { artifact_id: SITE })) as { open: number; threads: { text: string }[] };
    expect(c).toMatchObject({ open: 1, threads: [{ text: 'Check 3.2' }] });
    expect(await listVersionsTool.execute(ctx(ALICE), { artifact_id: DRAFT })).toHaveProperty('error');
    expect(await listCommentsTool.execute(ctx(CAROL, null), { artifact_id: SITE })).toHaveProperty('error');
  });
});

describe('confirm-gated review writes', () => {
  it('resolve_comment only proposes; the confirmed action resolves it as the user', async () => {
    const r = (await resolveCommentTool.execute(ctx(BOB), { artifact_id: SITE, comment_id: 'cmt_fp_1' })) as { __propose: PendingAction };
    expect(r.__propose).toMatchObject({ kind: 'comment_resolve', commentId: 'cmt_fp_1', resolved: true });
    expect(describeAction(r.__propose, 'es')).toContain('Resuelvo');
    const before = await e.DB.prepare("SELECT resolved FROM artifact_comments WHERE id = 'cmt_fp_1'").first<{ resolved: number }>();
    expect(before?.resolved).toBe(0);
    expect(await executeAction(e, BOB, r.__propose)).toContain('resolved');
    const after = await e.DB.prepare("SELECT resolved FROM artifact_comments WHERE id = 'cmt_fp_1'").first<{ resolved: number }>();
    expect(after?.resolved).toBe(1);
  });

  it('restore_version refuses a viewer before proposing anything', async () => {
    expect(await restoreVersionTool.execute(ctx(ALICE), { artifact_id: SITE, version_no: 1 })).toHaveProperty('error');
    expect(await restoreVersionTool.execute(ctx(BOB), { artifact_id: SITE, version_no: 1 })).toHaveProperty('__propose');
  });
});
