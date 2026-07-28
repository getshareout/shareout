import type { Env } from '../types';
import { quickSearch, type SearchHit } from './quick-search';
import { runAgentTurn } from '../chat-agent/agent-loop';
import { recordAiUsage } from '../data/ai-usage';

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
 * referenced by their [n] marker, so we only ever cite pages already in the scoped set.
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

  const { reply } = await runAgentTurn(env, {
    userId,
    platform: 'web',
    selectedWorkspaceId: workspaceId,
    userText,
    history: [],
    workspaceContext,
    capabilities: { canQueryConnections: false, canSchedule: false, canBuild: false },
  });

  const cited = new Set<number>();
  for (const m of reply.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= artifacts.length) cited.add(n);
  }
  const citations = [...cited].sort((a, b) => a - b).map((n) => toCitation(artifacts[n - 1]));

  await recordAiUsage(env, {
    workspaceId: workspaceId ?? null,
    userId,
    kind: 'ask_workspace',
    model: env.BUILD_MODEL || 'crew-default',
    units: 1,
    unitKind: 'turn',
    baseCostMicroUsd: 0,
    source: 'ask',
  }).catch(() => {});

  return { answer: reply, citations };
}

function toCitation(hit: SearchHit): AskCitation {
  return { artifact_id: hit.id, title: hit.title, url: `/a/${hit.slug || hit.id}/` };
}
