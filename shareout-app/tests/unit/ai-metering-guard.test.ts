/**
 * Every LLM call is metered into ai_usage_events — for every workspace, for good. The
 * monthly AI spend report each workspace gets is built from that ledger, so a model call
 * that skips it is spend nobody can see (2026-10: transcription, the editor, the page
 * builder, in-page agents, crews, moderation and page pilot all called models unmetered,
 * and the provider credit ran out unnoticed).
 *
 * The provider entry points take a required `meter` (streamChat, chatComplete, chat,
 * crew streamTurn), so TypeScript catches a caller that skips it. This pins the other
 * half: no code talks to a model API except through a module that meters.
 */
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const sources: Record<string, string> = Object.fromEntries(
  (readdirSync(SRC, { recursive: true }) as string[])
    .filter((rel) => rel.endsWith('.ts'))
    .map((rel) => [rel.split('\\').join('/'), readFileSync(join(SRC, rel), 'utf8')]),
);

/** Ways code reaches a model API: the request paths and the auth-header builder. */
const MODEL_CALL = [/\/chat\/completions/, /\/messages`/, /providerHeaders\(/, /\.AI\.run\(\s*[A-Z_]*(LLM|CHAT|EXTRACT)/];

/** The modules allowed to call a model, each of which meters what it calls. */
const METERED = ['data/agent/anthropic.ts', 'crew/provider.ts', 'data/agent/pilot.ts', 'moderation/check.ts', 'knowledge/corpus/extract.ts'];
/** Not our spend: the secrets proxy forwards a page's own calls with keys the workspace
 *  stored itself (its provider bills it), and only names a model path in an error hint. */
const NOT_OURS = ['data/secrets/handler.ts'];

describe('AI metering guard', () => {
  it('reads the source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(200);
  });

  it('only metered modules call a model API', () => {
    const callers = Object.entries(sources)
      .filter(([, text]) => MODEL_CALL.some((re) => re.test(text)))
      .map(([path]) => path)
      .sort();
    expect(callers.filter((p) => !METERED.includes(p) && !NOT_OURS.includes(p))).toEqual([]);
  });

  it('each metered module records usage', () => {
    for (const path of METERED) {
      expect(sources[path], path).toBeDefined();
      expect(/meterAiCall\(|meterKnowledge\(/.test(sources[path]), `${path} must meter its model calls`).toBe(true);
    }
  });
});
