// Auto TL;DR + tags on publish (background, best-effort, never blocks publish).
// Reuses the same LLM plumbing and {summary, tags} JSON contract as file enrichment
// (src/assets/enrich.ts), applied to the published entrypoint HTML instead of an
// uploaded file. Writes into existing columns only: `description` (only if the user
// hasn't set one) and `artifact_tags` (existing per-artifact tags table) — both are
// already read by quick-search (src/search/quick-search.ts) and rendered on home
// cards (src/pages/home/render-cards.ts), so no new UI or search wiring is needed.
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { chatComplete, getAIProvider } from '../data/agent/anthropic';
import { contentHash } from '../moderation/check';
import { parseModelJson } from '../assets/enrich';
import { recordAiUsage } from '../data/ai-usage';
import { setPresentation } from '../artifacts/satellites';

const MAX_HTML_CHARS = 20_000; // keep the prompt bounded + cheap
const MODEL_LABEL = 'artifact-summary';

const SYSTEM = `You describe a published web page for a workspace's search index.
Given its HTML, respond with STRICT JSON only:
{"summary": string, "tags": string[]}
- summary: 1-2 sentences, <= 300 characters, plain language, what the page IS and shows.
- tags: 3-6 short lowercase keywords (topic, purpose, data type). No # prefix.
No prose outside the JSON.`;

interface Row {
  workspace_id: string | null;
  owner_id: string | null;
  description: string | null;
  auto_summary_hash: string | null;
  r2_key: string;
}

export async function generateArtifactSummary(env: Env, artifactId: string): Promise<void> {
  if (!getAIProvider(env)) return; // no AI configured — don't churn, a later deploy can backfill

  const row = await env.DB.prepare(`
    SELECT a.workspace_id, a.owner_id, a.description, pres_a.auto_summary_hash, ast.r2_key
      FROM artifacts a
      LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
      JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      JOIN versions v ON v.id = d.version_id
      JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
     WHERE a.id = ? AND ast.mime = 'text/html'
  `).bind(artifactId).first<Row>();
  if (!row) return;

  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return;
  const html = (await obj.text()).slice(0, MAX_HTML_CHARS);
  const hash = await contentHash(html);
  if (hash === row.auto_summary_hash) return; // unchanged since the last summary

  let out: string;
  try {
    out = await chatComplete(env, [{ role: 'user', content: html }], SYSTEM, 200);
  } catch {
    return; // silent — hash not written, so an unchanged re-publish retries later
  }

  const parsed = parseModelJson(out);
  await recordAiUsage(env, {
    workspaceId: row.workspace_id, userId: row.owner_id,
    kind: 'artifact_summary', model: MODEL_LABEL,
    units: Math.ceil((html.length + out.length) / 4), unitKind: 'tokens',
    baseCostMicroUsd: Math.round((html.length / 4) * 0.0025 + (out.length / 4) * 0.01),
    source: artifactId,
  }).catch(() => {});

  if (!parsed) {
    // Model gave unparseable output — mark the hash so we don't hot-loop on the same
    // content, but leave description/tags alone.
    await setPresentation(env, artifactId, { auto_summary_hash: hash });
    return;
  }

  await setPresentation(env, artifactId, { auto_summary_hash: hash });
  if (!row.description) {
    await env.DB.prepare('UPDATE artifacts SET description = ? WHERE id = ?')
      .bind(parsed.summary, artifactId).run();
  }

  for (const tag of parsed.tags) {
    await env.DB.prepare('INSERT OR IGNORE INTO artifact_tags (id, artifact_id, label) VALUES (?, ?, ?)')
      .bind(generateId('tag'), artifactId, tag).run();
  }
}
