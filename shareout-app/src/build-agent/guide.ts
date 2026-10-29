/**
 * read_guide: the agent reads ShareOut's own artifact guide (a curated slice of the skill,
 * embedded at build time by scripts/gen-build-guide.mjs) when it needs the exact rule rather
 * than the summary in its prompt. Read-only; a topic is served in pages so one call stays small.
 */
import type { Env } from '../types';
import { rewriteSkillOrigin } from '../skill-origin';
import { BUILD_GUIDE } from './guide.generated';
import type { ToolReply } from './tools';

/** One call returns at most this many characters of a topic. */
export const GUIDE_PAGE_CHARS = 6000;

export const GUIDE_TOPICS = Object.keys(BUILD_GUIDE);

/** The topic menu, one line each, for the tool description and the unknown-topic reply. */
export function guideMenu(): string {
  return GUIDE_TOPICS.map((k) => `${k}: ${BUILD_GUIDE[k].title}`).join('\n');
}

/** Splits at line boundaries into pages of at most GUIDE_PAGE_CHARS (a single longer line is cut). */
function pages(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > GUIDE_PAGE_CHARS) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
    while (cur.length > GUIDE_PAGE_CHARS) {
      out.push(cur.slice(0, GUIDE_PAGE_CHARS));
      cur = cur.slice(GUIDE_PAGE_CHARS);
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function readGuide(env: Env, input: Record<string, unknown>): ToolReply {
  const topic = typeof input.topic === 'string' ? input.topic.trim().toLowerCase() : '';
  const entry = Object.prototype.hasOwnProperty.call(BUILD_GUIDE, topic) ? BUILD_GUIDE[topic] : undefined;
  if (!entry) return { isError: true, content: `UNKNOWN_TOPIC: "${topic}". Topics:\n${guideMenu()}` };
  const all = pages(rewriteSkillOrigin(entry.text, env));
  const part = Math.min(all.length, Math.max(1, Math.floor(Number(input.part) || 1)));
  const more = part < all.length ? `\n\n(part ${part} of ${all.length}; pass part: ${part + 1} to read on.)` : all.length > 1 ? `\n\n(part ${part} of ${all.length}, the last.)` : '';
  return { isError: false, content: `${all[part - 1]}${more}` };
}
