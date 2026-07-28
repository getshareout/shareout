import type { Env } from './types';
import { INDEX_PATH, isKnowledgeEnabled, getKnowledgeFile, parseNode } from './knowledge';

const DEFAULT_MAX_CHARS = 1500;

// The workspace knowledge trunk (overview note) as ambient agent context. '' when
// knowledge is off or no overview exists. Never throws — best-effort, zero-cost.
export async function knowledgeTrunkForContext(
  env: Env,
  workspaceId: string,
  opts: { maxChars?: number } = {}
): Promise<string> {
  try {
    if (!(await isKnowledgeEnabled(env, workspaceId))) return '';
    // Hot path (every home/workspace snapshot + /v1/skill): read ONLY the trunk row, not the
    // whole KB. INDEX_PATH is the overview note; a targeted get keeps this near zero-cost.
    const file = await getKnowledgeFile(env, workspaceId, INDEX_PATH);
    if (!file) return '';
    const body = parseNode(file.path, file.content).node?.body.trim();
    if (!body) return '';
    const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const trimmed = body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
    return `## What this workspace knows\n${trimmed}`;
  } catch {
    return '';
  }
}
