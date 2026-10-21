// Version change notes against the real migrated schema: the AI "what changed" line is
// written only when a version has no message, respects the workspace switch, fails
// silently, and is exposed (with its source) on history and on the artifact detail.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';

const chatComplete = vi.fn(async (..._a: unknown[]) => '"Added a Q3 revenue chart."');
vi.mock('../../../src/data/agent/anthropic', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  chatComplete: (...a: unknown[]) => chatComplete(...a),
  getAIProvider: () => ({ provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4o' }),
}));

const { compactDiff, normalizeVersionMessage, scheduleVersionSummary, summarizeVersion } = await import('../../../src/artifacts/version-summary');
const { handleGetArtifact, handleGetVersions, handleRestoreVersion } = await import('../../../src/artifacts');
const { applyMigrations, e } = await import('../helpers/migrated-db');

const owner: AuthUser = { id: 'usr_vc_owner', email: 'alice@example.com', username: null };
const viewer: AuthUser = { id: 'usr_vc_viewer', email: 'carol@example.com', username: null };
const stranger: AuthUser = { id: 'usr_vc_none', email: 'dave@example.com', username: null };

let seq = 0;
async function seedArtifact(opts: { workspaceId?: string | null; versions: Array<{ html: string; message?: string; source?: string }> }) {
  const art = `art_vc${++seq}`;
  await e.DB.prepare("INSERT INTO artifacts (id, owner_id, workspace_id, name, slug, visibility) VALUES (?, ?, ?, 'Demo', ?, 'private')")
    .bind(art, owner.id, opts.workspaceId ?? null, `vc-demo-${seq}`).run();
  await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES (?, ?, ?, 'viewer')")
    .bind(`col_${art}`, art, viewer.email).run();
  const ids: string[] = [];
  for (const [i, v] of opts.versions.entries()) {
    const id = `ver_${art}_${i + 1}`;
    ids.push(id);
    await env.ARTIFACTS.put(`${art}/${id}/index.html`, v.html);
    await e.DB.batch([
      e.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by, source, message)
        VALUES (?, ?, ?, 'index.html', '{}', ?, ?, ?, ?)`).bind(id, art, i + 1, new Date(Date.UTC(2026, 0, i + 1)).toISOString(), owner.id, v.source ?? 'api', v.message ?? null),
      e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', ?, 'h')`)
        .bind(`ast_${id}`, id, `${art}/${id}/index.html`, v.html.length),
    ]);
  }
  await e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)")
    .bind(`dep_${art}`, art, ids[ids.length - 1], `vc-demo-${seq}`).run();
  return { art, ids };
}

const messageOf = (id: string) =>
  e.DB.prepare('SELECT message, message_source FROM versions WHERE id = ?').bind(id).first<{ message: string | null; message_source: string | null }>();

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?)')
    .bind(owner.id, owner.email, 'Alice', viewer.id, viewer.email, 'Carol').run();
  await e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id, feature_flags) VALUES ('wsp_vc_on', 'On', 'vc-on', ?, NULL), ('wsp_vc_off', 'Off', 'vc-off', ?, ?)")
    .bind(owner.id, owner.id, JSON.stringify({ 'ai.version_summaries': false })).run();
});

beforeEach(() => { chatComplete.mockClear(); });

describe('compactDiff', () => {
  it('keeps only changed lines, trims shared head/tail and caps the size', () => {
    expect(compactDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne')).toBe('- b\n+ B\n+ e\n');
    expect(compactDiff('same\n  x', 'same\nx')).toBe('');
    const big = compactDiff('', Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'), 200);
    expect(big.length).toBeLessThan(240);
    expect(big).toContain('diff truncated');
  });

  it('normalizes publisher messages', () => {
    expect(normalizeVersionMessage('  Fixed totals  ')).toBe('Fixed totals');
    expect(normalizeVersionMessage('   ')).toBeNull();
    expect(normalizeVersionMessage(42)).toBeNull();
    expect(normalizeVersionMessage('x'.repeat(900))).toHaveLength(500);
  });
});

describe('summarizeVersion', () => {
  it('writes a cleaned AI note for a new version without a message', async () => {
    const { ids } = await seedArtifact({ workspaceId: 'wsp_vc_on', versions: [{ html: '<h1>One</h1>' }, { html: '<h1>One</h1>\n<canvas id="q3"></canvas>' }] });
    await summarizeVersion(e, ids[1]);
    expect(chatComplete).toHaveBeenCalledTimes(1);
    expect((chatComplete.mock.calls[0][2] as Array<{ content: string }>)[0].content).toBe('+ <canvas id="q3"></canvas>\n');
    expect(await messageOf(ids[1])).toEqual({ message: 'Added a Q3 revenue chart', message_source: 'ai' });
    // Metered by chatComplete itself (mocked here): the call carries whom it is for.
    expect(chatComplete.mock.calls[0][1]).toMatchObject({ kind: 'version_summary' });
  });

  it('never overwrites an author message, and skips first versions and restores', async () => {
    const authored = await seedArtifact({ versions: [{ html: 'a' }, { html: 'b', message: 'Mine' }] });
    await summarizeVersion(e, authored.ids[1]);
    const first = await seedArtifact({ versions: [{ html: 'a' }] });
    await summarizeVersion(e, first.ids[0]);
    const restored = await seedArtifact({ versions: [{ html: 'a' }, { html: 'b' }, { html: 'a', source: 'restore' }] });
    await summarizeVersion(e, restored.ids[2]);
    expect(chatComplete).not.toHaveBeenCalled();
    expect((await messageOf(authored.ids[1]))?.message).toBe('Mine');
    expect((await messageOf(restored.ids[2]))?.message).toBeNull();
  });

  it('respects the workspace switch', async () => {
    const { ids } = await seedArtifact({ workspaceId: 'wsp_vc_off', versions: [{ html: 'a' }, { html: 'b' }] });
    await summarizeVersion(e, ids[1]);
    expect(chatComplete).not.toHaveBeenCalled();
    expect((await messageOf(ids[1]))?.message).toBeNull();
  });

  it('skips unchanged text and fails silently through scheduleVersionSummary', async () => {
    const same = await seedArtifact({ versions: [{ html: 'a' }, { html: 'a\n' }] });
    await summarizeVersion(e, same.ids[1]);
    expect(chatComplete).not.toHaveBeenCalled();

    chatComplete.mockRejectedValueOnce(new Error('provider down'));
    const broken = await seedArtifact({ versions: [{ html: 'a' }, { html: 'b' }] });
    const pending: Promise<unknown>[] = [];
    scheduleVersionSummary(e, (p) => pending.push(p), broken.ids[1], null);
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect((await messageOf(broken.ids[1]))?.message).toBeNull();

    scheduleVersionSummary(e, (p) => pending.push(p), broken.ids[1], 'Author note');
    expect(pending).toHaveLength(1);
  });
});

describe('exposure', () => {
  it('history and detail carry the message and its source to a viewer, not to a stranger', async () => {
    const { art, ids } = await seedArtifact({ versions: [{ html: 'a' }, { html: 'b' }] });
    await summarizeVersion(e, ids[1]);
    const hist = await (await handleGetVersions(new Request('https://x'), e, viewer, art)).json() as { versions: Array<Record<string, unknown>> };
    expect(hist.versions[0]).toMatchObject({ version_no: 2, message: 'Added a Q3 revenue chart', message_source: 'ai' });
    const detail = await (await handleGetArtifact(new Request('https://x'), e, viewer, art)).json() as Record<string, unknown>;
    expect(detail).toMatchObject({ live_message: 'Added a Q3 revenue chart', live_message_source: 'ai' });
    expect((await handleGetVersions(new Request('https://x'), e, stranger, art)).status).toBe(403);
    expect((await handleGetArtifact(new Request('https://x'), e, stranger, art)).status).toBe(403);
  });

  it('marks a restore note as author-written', async () => {
    const { art } = await seedArtifact({ versions: [{ html: 'a' }, { html: 'b' }] });
    const res = await handleRestoreVersion(new Request('https://x', { method: 'POST', body: JSON.stringify({ message: 'Back to v1' }) }), e, owner, art, 1);
    expect(res.status).toBe(201);
    const { version_id } = await res.json() as { version_id: string };
    expect(await messageOf(version_id)).toEqual({ message: 'Back to v1', message_source: 'author' });
  });
});
