// Guards public/_bundles/versions.json against drift: a stale hash would pin a URL
// immutably to bytes it does not name. Runs in the node project (reads the files).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import versions from '../../public/_bundles/versions.json';

const FILES: Record<string, string> = {
  '/sdk/shareout.js': 'shareout-sdk.js',
  '/sdk/comments-agent.js': 'shareout-comments-agent.js',
  '/sdk/editor.js': 'editor.js',
  '/sdk/chat-core.js': 'chat-core.js',
};

describe('bundle versions manifest', () => {
  it.each(Object.entries(FILES))('%s hash matches the staged bytes', (path, file) => {
    const bytes = readFileSync(join(__dirname, '../../public/_bundles', file));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    expect((versions as Record<string, string>)[path], 'run node scripts/stage-bundle-versions.mjs').toBe(hash);
  });
});
