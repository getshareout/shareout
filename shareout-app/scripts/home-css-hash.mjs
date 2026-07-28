#!/usr/bin/env node
/** Compute home CSS regression constants by reading generated section modules. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = join(__dirname, '../src/design-system/pages/home');

function extractTemplateExport(source, exportName) {
  const re = new RegExp(`export const ${exportName} = \`([\\s\\S]*?)\`;`);
  const m = source.match(re);
  if (!m) throw new Error(`Missing export ${exportName}`);
  return m[1];
}

// Read index.ts for section order.
const indexSrc = readFileSync(join(HOME_DIR, 'index.ts'), 'utf8');
const importRe = /from '\.\/([^']+)\.css'/g;
const slugs = [];
let im;
while ((im = importRe.exec(indexSrc)) !== null) slugs.push(im[1]);

const parts = slugs.map((slug) => {
  const file = readFileSync(join(HOME_DIR, `${slug}.css.ts`), 'utf8');
  const exportMatch = file.match(/export const (\w+) = `/);
  if (!exportMatch) throw new Error(`No export in ${slug}`);
  return extractTemplateExport(file, exportMatch[1]);
});

const body = parts.join('');
const mobileFile = readFileSync(join(__dirname, '../src/design-system/pages/home.mobile.css.ts'), 'utf8');
const mobile = extractTemplateExport(mobileFile, 'homeMobileStyles');

const sha = createHash('sha256').update(body).digest('hex');
console.log(JSON.stringify({
  sectionCount: slugs.length,
  byteLength: body.length,
  sha256: sha,
  mobileBytes: mobile.length,
  totalBytes: body.length + mobile.length,
}, null, 2));
