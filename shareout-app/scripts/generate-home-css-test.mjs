#!/usr/bin/env node
/** Emit tests/unit/design-system/home.test.ts after split-home-css.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOME_DIR = join(ROOT, 'src/design-system/pages/home');
const indexSrc = readFileSync(join(HOME_DIR, 'index.ts'), 'utf8');

const imports = [...indexSrc.matchAll(/import \{ (\w+) \} from '\.\/([^']+)\.css';/g)];
const slugs = imports.map((m) => ({ exportName: m[1], slug: m[2] }));

let body = '';
for (const { slug, exportName } of slugs) {
  const file = readFileSync(join(HOME_DIR, `${slug}.css.ts`), 'utf8');
  const m = file.match(new RegExp(`export const ${exportName} = \`([\\s\\S]*)\`;`));
  body += m[1];
}

const sha = createHash('sha256').update(body).digest('hex');

const importLines = imports.map((m) => `import { ${m[1]} } from '../../src/design-system/pages/home/${m[2]}.css';`).join('\n');
const sectionRows = imports.map((m) => `  ['${m[2]}', ${m[1]}],`).join('\n');

const test = `// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { homePageComponents } from '../../src/design-system/pages/home/index';
import { homePageStyles } from '../../src/design-system/pages/home.css';
${importLines}

/** Byte length of the concatenated desktop/shared stylesheet (regression guard). */
const ORIGINAL_STYLE_BYTE_LENGTH = ${body.length};

/** SHA-256 of the current concatenated CSS body. */
const ORIGINAL_STYLE_SHA256 = '${sha}';

const SECTION_EXPORTS = [
${sectionRows}
] as const;

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('home page styles', () => {
  it('exports a non-empty stylesheet from the barrel', () => {
    expect(homePageComponents.length).toBe(ORIGINAL_STYLE_BYTE_LENGTH);
    expect(homePageStyles.length).toBeGreaterThan(homePageComponents.length);
  });

  it('includes signature layout and interaction sections', () => {
    expect(homePageComponents).toContain('.shell {');
    expect(homePageComponents).toContain('.artifact-card {');
    expect(homePageComponents).toContain('.detail-drawer {');
    expect(homePageComponents).toContain('.lib-modal {');
    expect(homePageComponents).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('decomposes into focused section modules, each under 1000 lines of source', () => {
    for (const [name, section] of SECTION_EXPORTS) {
      expect(section.length, \`\${name} should export CSS\`).toBeGreaterThan(0);
      const lineCount = section.split('\\n').length;
      expect(lineCount, \`\${name} section source\`).toBeLessThanOrEqual(1000);
    }
  });

  it('preserves the original monolithic CSS body byte-for-byte', async () => {
    expect(homePageComponents.length).toBe(ORIGINAL_STYLE_BYTE_LENGTH);
    expect(await sha256(homePageComponents)).toBe(ORIGINAL_STYLE_SHA256);
  });
});
`;

writeFileSync(join(ROOT, 'tests/unit/design-system/home.test.ts'), test, 'utf8');
console.log(`Wrote tests/unit/design-system/home.test.ts (${slugs.length} sections, sha ${sha.slice(0, 8)}…)`);
