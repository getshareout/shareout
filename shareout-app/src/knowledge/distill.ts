import type { Env } from '../types';
import { extractTextFromHtml } from '../serve/utils';
import { chatComplete, getAIProvider } from '../data/agent/anthropic';
import { recordAiUsage } from '../data/ai-usage';
import { upsertLearnedFile, isTombstoned, loadKnowledge, getKnowledgeFile } from './store';
import { artifactDigestPath, INDEX_PATH } from './types';

const MAX_PER_RUN = 20;
const MAX_PER_WORKSPACE = 5;
// ponytail: hard wall-clock cap so a pathological run can't monopolize the cron; raise if legit runs approach it.
const MAX_RUN_MS = 120_000;
const ARTIFACT_TEXT_CAP = 8000;
const EMBED_TEXT_CAP = 2000;
const DISTILL_MAX_TOKENS = 600;
const TOP_TOPICS = 15;
// ponytail: retry ceiling — rows unprocessed for >7 days are dropped from the
// sweep (never re-selected), not retried forever. P1 cleanup can prune the rows.
const STALE_INGEST_WINDOW = '-7 days';
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

export type DistillComplete = (system: string, user: string) => Promise<string>;

export interface DistillResult {
  processed: number;
  skipped: number;
}

interface IngestRow {
  workspace_id: string;
  artifact_id: string;
  reason: string;
}

interface ArtifactMeta {
  name: string;
  description: string | null;
  moderation_status: string;
  workspace_id: string | null;
  tags: string | null;
}

const SYSTEM_PROMPT = `You distill a published page into a short knowledge digest for a workspace's memory.
Respond with a single JSON object on the first line, then a blank line, then the digest body in markdown.
JSON shape: {"title": string, "topics": string[], "entities": string[], "summary": string}
- topics: 2-5 lowercase slug tags (e.g. "retention", "ad-spend"). entities: proper names (clients, products, systems).
- Body: 3-6 sentences of concrete facts and numbers a teammate would want. No preamble, no headings.`;

function yamlList(items: string[]): string {
  return `[${items.map(s => JSON.stringify(s)).join(', ')}]`;
}

function digestFile(fields: {
  artifactId: string;
  title: string;
  topics: string[];
  entities: string[];
  body: string;
}): string {
  const fm = [
    '---',
    'kind: artifact-digest',
    `id: art.${fields.artifactId}`,
    `title: ${JSON.stringify(fields.title)}`,
    `topics: ${yamlList(fields.topics)}`,
    `entities: ${yamlList(fields.entities)}`,
    `sources: ${yamlList([fields.artifactId])}`,
    'confidence: inferred',
    `learned_at: ${new Date().toISOString()}`,
    'pinned: false',
    '---',
  ].join('\n');
  return `${fm}\n${fields.body.trim()}\n`;
}

function parseDigest(
  response: string,
  fallbackTitle: string
): { title: string; topics: string[]; entities: string[]; body: string } {
  const match = response.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      const header = JSON.parse(match[0]) as {
        title?: unknown;
        topics?: unknown;
        entities?: unknown;
        summary?: unknown;
      };
      const body = response.slice(match.index! + match[0].length).trim();
      const list = (v: unknown) =>
        Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
      return {
        title: typeof header.title === 'string' && header.title.trim() ? header.title.trim() : fallbackTitle,
        topics: list(header.topics),
        entities: list(header.entities),
        body: body || (typeof header.summary === 'string' ? header.summary : response.trim()),
      };
    } catch {
      // fall through to body-only digest
    }
  }
  return { title: fallbackTitle, topics: [], entities: [], body: response.trim() };
}

async function readArtifactText(env: Env, artifactId: string): Promise<string> {
  const dep = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  )
    .bind(artifactId)
    .first<{ version_id: string }>();
  if (!dep) return '';
  const ver = await env.DB.prepare('SELECT entrypoint FROM versions WHERE id = ?')
    .bind(dep.version_id)
    .first<{ entrypoint: string }>();
  if (!ver?.entrypoint) return '';
  const asset = await env.DB.prepare(
    'SELECT r2_key, mime FROM assets WHERE version_id = ? AND path = ?'
  )
    .bind(dep.version_id, ver.entrypoint)
    .first<{ r2_key: string; mime: string }>();
  if (!asset) return '';
  const obj = await env.ARTIFACTS.get(asset.r2_key);
  if (!obj) return '';
  const raw = await obj.text();
  const text = asset.mime.includes('html') ? extractTextFromHtml(raw) : raw;
  return text.slice(0, ARTIFACT_TEXT_CAP);
}

export async function upsertKnowledgeVector(
  env: Env,
  workspaceId: string,
  path: string,
  kind: string,
  text: string
): Promise<void> {
  if (!env.VECTORIZE || !env.AI) return;
  try {
    const res = (await env.AI.run(EMBED_MODEL, { text: [text.slice(0, EMBED_TEXT_CAP)] })) as {
      data?: number[][];
    };
    const values = res.data?.[0];
    if (!values) return;
    await env.VECTORIZE.upsert([
      { id: `kn:${workspaceId}:${path}`, values, namespace: 'knowledge', metadata: { workspace_id: workspaceId, path, kind } },
    ]);
  } catch {
    // best-effort, mirrors indexArtifactVector
  }
}

export async function deleteKnowledgeVector(
  env: Env,
  workspaceId: string,
  path: string
): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    await env.VECTORIZE.deleteByIds([`kn:${workspaceId}:${path}`]);
  } catch {
    // best-effort — a stale vector for a deleted page is harmless (path filter drops it).
  }
}

// Mark every unprocessed ingest row for this (workspace, artifact) — publish + backfill
// rows point at the same page, so one digest satisfies them all (no duplicate LLM spend).
async function markProcessed(env: Env, workspaceId: string, artifactId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE knowledge_ingest SET processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE workspace_id = ? AND artifact_id = ? AND processed_at IS NULL"
  )
    .bind(workspaceId, artifactId)
    .run();
}

async function regenerateIndex(env: Env, workspaceId: string): Promise<void> {
  // Bootstrap-only: once an index.md exists (the nightly consolidator writes a Sonnet
  // trunk overview), the hourly distill must not clobber it. Only seed the naive index
  // when none exists yet, so a fresh workspace gets a trunk within the hour.
  if (await getKnowledgeFile(env, workspaceId, INDEX_PATH)) return;
  const { nodes } = await loadKnowledge(env, workspaceId);
  const digests = nodes.filter(n => n.kind === 'artifact-digest');
  const counts = new Map<string, number>();
  for (const d of digests) for (const t of d.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TOPICS);

  const fm = [
    '---',
    'kind: overview',
    'id: index',
    'title: "Workspace knowledge"',
    'pinned: false',
    '---',
  ].join('\n');
  const lines = [
    `${digests.length} pages learned. Updated ${new Date().toISOString().slice(0, 10)}.`,
    '',
    '## Top topics',
    ...(top.length ? top.map(([t, c]) => `- ${t} (${c})`) : ['- none yet']),
  ];
  await upsertLearnedFile(env, workspaceId, {
    path: INDEX_PATH,
    content: `${fm}\n${lines.join('\n')}\n`,
    source: 'consolidated',
  });
}

/** Hourly sweep: drain the ingest queue into artifact digests + vectors. Self-limiting.
 *  When `workspaceId` is set the sweep is scoped to that one workspace (on-demand Train
 *  kick) and may spend its whole `maxItems` budget — the MAX_PER_WORKSPACE fairness cap
 *  is only for the shared cron. Defaults leave the cron path untouched. */
export async function runKnowledgeDistill(
  env: Env,
  opts?: { complete?: DistillComplete; workspaceId?: string; maxItems?: number; maxMs?: number }
): Promise<DistillResult> {
  const provider = getAIProvider(env);
  const complete: DistillComplete | null =
    opts?.complete ??
    (provider
      ? (system, user) =>
          chatComplete(env, [{ role: 'user', content: user }], system, DISTILL_MAX_TOKENS, provider)
      : null);
  if (!complete) return { processed: 0, skipped: 0 };

  const scoped = !!opts?.workspaceId;
  const rnCap = scoped ? (opts?.maxItems ?? MAX_PER_WORKSPACE) : MAX_PER_WORKSPACE;
  const limit = scoped ? (opts?.maxItems ?? MAX_PER_RUN) : MAX_PER_RUN;
  const maxMs = opts?.maxMs ?? MAX_RUN_MS;

  // Per-workspace window (ROW_NUMBER) caps each workspace in SQL, so one big backfill
  // can't starve every other workspace's queue in a single sweep.
  const rows = (
    await env.DB.prepare(
      `SELECT workspace_id, artifact_id, reason FROM (
         SELECT ki.workspace_id, ki.artifact_id, ki.reason, ki.queued_at,
                ROW_NUMBER() OVER (PARTITION BY ki.workspace_id ORDER BY ki.queued_at ASC) AS rn
         FROM knowledge_ingest ki
         JOIN knowledge_settings ks ON ks.workspace_id = ki.workspace_id AND ks.enabled = 1
         WHERE ki.processed_at IS NULL AND ki.queued_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
               ${scoped ? 'AND ki.workspace_id = ?' : ''}
       ) WHERE rn <= ?
       ORDER BY queued_at ASC
       LIMIT ?`
    )
      .bind(...(scoped ? [STALE_INGEST_WINDOW, opts!.workspaceId, rnCap, limit] : [STALE_INGEST_WINDOW, rnCap, limit]))
      .all<IngestRow>()
  ).results;

  const touched = new Set<string>();
  const handled = new Set<string>();
  const startedAt = Date.now();
  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    // ponytail: wall-clock kill-switch — stop selecting new work past the budget, don't half-write a digest.
    if (Date.now() - startedAt > maxMs) break;
    const ws = row.workspace_id;
    // A sibling row (e.g. publish + backfill for the same page) already handled + marked this run.
    const key = `${ws}:${row.artifact_id}`;
    if (handled.has(key)) continue;
    handled.add(key);

    const path = artifactDigestPath(row.artifact_id);
    const meta = await env.DB.prepare(
      `SELECT a.name, a.description, COALESCE(m.status, 'approved') AS moderation_status,
              a.workspace_id,
              (SELECT GROUP_CONCAT(label, ', ') FROM artifact_tags WHERE artifact_id = a.id) AS tags
       FROM artifacts a
       LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
       WHERE a.id = ? AND a.deleted_at IS NULL`
    )
      .bind(row.artifact_id)
      .first<ArtifactMeta>();

    if (
      !meta ||
      meta.moderation_status !== 'approved' ||
      !meta.workspace_id ||
      (await isTombstoned(env, ws, path))
    ) {
      await markProcessed(env, ws, row.artifact_id);
      skipped++;
      continue;
    }

    const text = await readArtifactText(env, row.artifact_id);
    if (!text.trim()) {
      await markProcessed(env, ws, row.artifact_id);
      skipped++;
      continue;
    }

    const userPrompt = [
      `Page name: ${meta.name}`,
      meta.description ? `Description: ${meta.description}` : '',
      meta.tags ? `Tags: ${meta.tags}` : '',
      '',
      text,
    ]
      .filter(Boolean)
      .join('\n');

    let response: string;
    try {
      response = await complete(SYSTEM_PROMPT, userPrompt);
    } catch {
      // leave unprocessed; retried next sweep until the stale window drops it
      skipped++;
      continue;
    }

    const digest = parseDigest(response, meta.name);
    const content = digestFile({
      artifactId: row.artifact_id,
      title: digest.title,
      topics: digest.topics,
      entities: digest.entities,
      body: digest.body,
    });
    await upsertLearnedFile(env, ws, { path, content, source: 'learned' });
    await upsertKnowledgeVector(
      env,
      ws,
      path,
      'artifact-digest',
      [digest.title, digest.topics.join(' '), digest.body].join('\n')
    );
    await recordAiUsage(env, {
      workspaceId: ws,
      userId: null,
      kind: 'knowledge_distill',
      model: provider?.model ?? 'injected',
      units: Math.ceil(digest.body.length / 4),
      unitKind: 'tokens_out',
      baseCostMicroUsd: 0,
      source: 'knowledge',
    }).catch(() => {});

    await markProcessed(env, ws, row.artifact_id);
    touched.add(ws);
    processed++;
  }

  for (const ws of touched) await regenerateIndex(env, ws);

  return { processed, skipped };
}
