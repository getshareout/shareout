import type { Env } from '../types';
import { normalize, quickSearch, type SearchHit } from './quick-search';
import { runAgentTurn } from '../chat-agent/agent-loop';

export interface AskCitation {
  artifact_id: string;
  title: string;
  url: string;
}

export interface AskResult {
  answer: string;
  citations: AskCitation[];
}

const CANDIDATE_LIMIT = 8;

/**
 * "Ask your workspace" — one focused agent turn answering a question over the pages
 * the requesting user can access. quickSearch supplies the access-scoped candidate set
 * (it hard-checks workspace membership and per-artifact visibility); runAgentTurn's own
 * search/read tools re-gate on the same identity. Citations are the candidates the model
 * referenced by their [n] marker, the pages it read, and any page its own access-gated
 * search tools found that the answer names — so we only ever cite pages the caller can open.
 */
export async function askWorkspace(
  env: Env,
  userId: string,
  workspaceId: string | undefined,
  question: string,
): Promise<AskResult> {
  const { artifacts } = await quickSearch(env, userId, {
    q: question,
    workspaceId,
    groups: ['artifacts'],
    limit: CANDIDATE_LIMIT,
  });

  const workspaceContext = artifacts.length
    ? 'Pages in scope (cite the ones you use by their [n] marker):\n' +
      artifacts
        .map((a, i) => `[${i + 1}] ${a.title}${a.subtitle ? ' — ' + a.subtitle : ''}`)
        .join('\n')
    : undefined;

  const userText = artifacts.length
    ? `${question}\n\nAnswer from the workspace pages. Cite each page you use inline with its [n] marker from the pages-in-scope list (e.g. [1]).`
    : question;

  const read: Source[] = [];
  const seen: Source[] = [];
  const { reply } = await runAgentTurn(env, {
    userId,
    platform: 'web',
    selectedWorkspaceId: workspaceId,
    userText,
    history: [],
    workspaceContext,
    capabilities: { canQueryConnections: false, canSchedule: false, canBuild: false, readOnly: true },
    usageKind: 'ask_workspace',
    onToolResult: (name, _input, out) => {
      const o = out as { id?: unknown; name?: unknown; error?: unknown; artifacts?: unknown } | null;
      if (!o || typeof o !== 'object' || o.error) return;
      if (name === 'read_artifact' && typeof o.id === 'string') read.push({ id: o.id, name: typeof o.name === 'string' ? o.name : '' });
      else if (Array.isArray(o.artifacts)) {
        for (const a of o.artifacts as Array<{ id?: unknown; name?: unknown; slug?: unknown }>) {
          if (typeof a.id === 'string' && typeof a.name === 'string') {
            seen.push({ id: a.id, name: a.name, slug: typeof a.slug === 'string' ? a.slug : undefined });
          }
        }
      }
    },
  });

  const cited = new Set<number>();
  for (const m of reply.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= artifacts.length) cited.add(n);
  }
  const sources = new Map<string, Source>();
  for (const n of [...cited].sort((a, b) => a - b)) {
    const hit = artifacts[n - 1];
    sources.set(hit.id, { id: hit.id, name: hit.title, slug: hit.slug });
  }
  const answer = normalize(reply);
  const named = (name: string) => name.trim().length >= 3 && answer.includes(normalize(name));
  for (const s of read) if (!sources.has(s.id)) sources.set(s.id, s);
  for (const s of seen) if (!sources.has(s.id) && named(s.name)) sources.set(s.id, s);

  return { answer: reply, citations: await toCitations(env, [...sources.values()]) };
}

interface Source { id: string; name: string; slug?: string }

/** Citations in source order; fills the slug/name of pages a tool returned without them. */
async function toCitations(env: Env, sources: Source[]): Promise<AskCitation[]> {
  const missing = sources.filter((s) => !s.slug || !s.name).map((s) => s.id);
  const rows = missing.length
    ? (await env.DB.prepare(`SELECT id, name, slug FROM artifacts WHERE id IN (${missing.map(() => '?').join(',')})`)
      .bind(...missing).all<{ id: string; name: string; slug: string | null }>()).results ?? []
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return sources.map((s) => {
    const row = byId.get(s.id);
    return toCitation({ id: s.id, title: s.name || row?.name || '', slug: s.slug || row?.slug || undefined });
  });
}

function toCitation(hit: Pick<SearchHit, 'id' | 'title' | 'slug'>): AskCitation {
  return { artifact_id: hit.id, title: hit.title, url: `/a/${hit.slug || hit.id}/` };
}
