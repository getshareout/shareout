import { describe, expect, it } from 'vitest';
import type { Env } from '../../../../src/types';
import { buildSystemPrompt } from '../../../../src/data/agent/build-page';
import { buildAdminSystemPrompt } from '../../../../src/data/agent/context';
import { SDK_REFERENCE, SDK_SURFACE } from '../../../../src/data/agent/sdk-reference.generated';

const env = { SHAREOUT_BASE_URL: 'https://shareout.example' } as unknown as Env;

/**
 * Every `sdk.x`, `sdk.x.y`, `sdk.x(…).y` (or the same on a `shareout` instance) and
 * `ShareOut.x` the text names that the SDK lacks. Paths like `/sdk/shareout.js` are skipped.
 */
function unknownSdkCalls(text: string): string[] {
  const missing = new Set<string>();
  for (const [, ns, member] of text.matchAll(/(?<![\w./-])(?:sdk|shareout)\.(\w+)(?:\([^()]*\))?(?:\.(\w+))?/g)) {
    if (!(ns in SDK_SURFACE)) missing.add(`sdk.${ns}`);
    else if (member && !SDK_SURFACE[ns].includes(member)) missing.add(`sdk.${ns}.${member}`);
  }
  for (const [, member] of text.matchAll(/\bShareOut\.(\w+)/g)) {
    if (!SDK_SURFACE.ShareOut.includes(member)) missing.add(`ShareOut.${member}`);
  }
  return [...missing];
}

describe('build agent prompt names only the real SDK', () => {
  it('flags methods the SDK does not have', () => {
    const text = 'await sdk.json.merge(k, v); shareout.theme.current(); sdk.table("t").upsert(); ShareOut.boot(); <script src="/sdk/shareout.js">';
    expect(unknownSdkCalls(text)).toEqual(['sdk.json.merge', 'sdk.theme', 'sdk.table.upsert', 'ShareOut.boot']);
  });

  it('every sdk.<namespace>.<method> in the build prompt exists', async () => {
    const prompt = await buildSystemPrompt(env);
    expect(prompt).toContain(SDK_REFERENCE.trim());
    expect(unknownSdkCalls(prompt)).toEqual([]);
  });

  it('the owner chat gets the same generated reference', () => {
    const prompt = buildAdminSystemPrompt({
      files: [],
      skillDocs: SDK_REFERENCE,
      artifact: { id: 'a', name: 'A', visibility: 'private', currentVersion: 1 },
      json: {},
      tables: [],
      folderGuide: null,
    });
    expect(unknownSdkCalls(prompt)).toEqual([]);
  });

  it('follows the skill: ShareOut.create, root-relative /sdk and /vendor, current visibilities', async () => {
    const prompt = await buildSystemPrompt(env);
    expect(prompt).toContain('await ShareOut.create()');
    expect(prompt).toContain('<script src="/sdk/shareout.js"></script>');
    expect(prompt).toContain('/vendor/');
    expect(prompt).toContain('/sdk/shareout.css');
    expect(prompt).not.toMatch(/new ShareOut\(/);
    expect(prompt).not.toMatch(/\/sdk\/v1\//);
    expect(prompt).not.toMatch(/https?:\/\/[^\s"']+\/sdk\//);
    expect(prompt).not.toMatch(/unlisted/i);
    expect(prompt).not.toMatch(/vary light\/dark/i);
  });
});
