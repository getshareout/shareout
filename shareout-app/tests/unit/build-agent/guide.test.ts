// read_guide: the agent reads ShareOut's own guide, in parts, and is told it exists.
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { GUIDE_PAGE_CHARS, GUIDE_TOPICS, readGuide } from '../../../src/build-agent/guide';
import { BUILD_GUIDE } from '../../../src/build-agent/guide.generated';
import { BUILD_TOOLS, TOOL } from '../../../src/build-agent/tools';
import { buildAgentSystemPrompt } from '../../../src/build-agent/prompt';
import { runBuildAgent } from '../../../src/build-agent/agent';
import { GOOD_HTML, deps, lastToolResults, scriptedProvider } from './helpers';

const env = { SHAREOUT_BASE_URL: 'https://app.example' } as Env;

describe('read_guide', () => {
  it('covers the curated topics', () => {
    expect(GUIDE_TOPICS).toEqual(expect.arrayContaining(['stack', 'pre-ship', 'manifest', 'classes', 'access-policy', 'table']));
  });

  it('returns a known section: the manifest page, with its first heading', () => {
    const r = readGuide(env, { topic: 'manifest' });
    expect(r.isError).toBe(false);
    expect(r.content).toBe(readGuide(env, { topic: 'manifest', part: 1 }).content);
    expect(r.content).toContain(BUILD_GUIDE.manifest.text.split('\n')[0]);
    expect(r.content.length).toBeLessThanOrEqual(GUIDE_PAGE_CHARS + 120);
  });

  it('pages long topics and says how to read on', () => {
    const first = readGuide(env, { topic: 'access-policy' });
    expect(first.content).toMatch(/part 1 of \d+; pass part: 2/);
    const second = readGuide(env, { topic: 'access-policy', part: 2 });
    expect(second.content).not.toBe(first.content);
    expect(readGuide(env, { topic: 'access-policy', part: 99 }).content).toMatch(/the last/);
  });

  it('fills the instance origin placeholders', () => {
    const all = GUIDE_TOPICS.map((t) => readGuide(env, { topic: t }).content).join('\n');
    expect(all).not.toContain('$ORIGIN');
  });

  it('answers an unknown topic with the menu, never a prototype member', () => {
    for (const topic of ['nope', 'constructor', '']) {
      const r = readGuide(env, { topic });
      expect(r.isError).toBe(true);
      expect(r.content).toContain('stack:');
    }
  });

  it('is one of the agent tools, and the prompt points to it', () => {
    expect(BUILD_TOOLS.map((t) => t.name)).toContain(TOOL.guide);
    expect(buildAgentSystemPrompt(env)).toContain('read_guide');
  });

  it('the agent can call it mid-build', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [['read_guide', { topic: 'pre-ship' }]] },
      { calls: [['write_file', { path: 'index.html', content: GOOD_HTML }], ['write_file', { path: 'styles.css', content: 'b{}' }], ['write_file', { path: 'app.js', content: 'document.title="x";' }]] },
      { calls: [['publish_page', {}]] },
    ]);
    const r = await runBuildAgent(deps(provider, { env }), { prompt: 'a page' });
    expect(r.ok).toBe(true);
    expect(lastToolResults(calls, 0)[0]).toContain(BUILD_GUIDE['pre-ship'].text.split('\n')[0]);
  });
});
