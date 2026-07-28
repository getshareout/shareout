#!/usr/bin/env node
/**
 * One-shot splitter: decomposes design-system/pages/home.css.ts into
 * design-system/pages/home/*.css.ts section modules + index.ts barrel.
 *
 * Run from shareout-app/: node scripts/split-home-css.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src/design-system/pages');
const OUT_DIR = join(SRC, 'home');
const SOURCE_FILE = join(SRC, 'home.css.ts');

function slugify(title) {
  return title
    .replace(/[()]/g, '')
    .replace(/[=]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function toExportName(slug) {
  const camel = slug
    .split('-')
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
  return `${camel}Styles`;
}

function extractCssBody(source) {
  const match = source.match(/const homePageComponents = `([\s\S]*?)`;\s*\n\nexport/s);
  if (!match) throw new Error('Could not extract homePageComponents template literal');
  return match[1];
}

function splitSections(css) {
  const markerRe = /^\/\* ── ([^─\n]+)/gm;
  const hits = [];
  let m;
  while ((m = markerRe.exec(css)) !== null) {
    hits.push({ index: m.index, title: m[1].trim() });
  }

  const sections = [];

  // Preamble before first section marker (html/body root rules).
  if (hits.length === 0 || hits[0].index > 0) {
    const end = hits[0]?.index ?? css.length;
    const body = css.slice(0, end);
    if (body) {
      sections.push({ slug: 'base', title: 'base', body });
    }
  }

  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = hits[i + 1]?.index ?? css.length;
    const chunk = css.slice(start, end);
    const title = hits[i].title;
    sections.push({ slug: slugify(title), title, body: chunk });
  }

  // Trailing block without a section marker (e.g. Skill Marketplace).
  const lastHit = hits[hits.length - 1];
  if (lastHit) {
    const afterLast = css.slice(lastHit.index);
    const skillIdx = afterLast.indexOf('/* Skill Marketplace */');
    if (skillIdx !== -1) {
      const iconSectionEnd = lastHit.index + skillIdx;
      const iconBody = css.slice(lastHit.index, iconSectionEnd);
      const skillBody = css.slice(iconSectionEnd);
      sections[sections.length - 1] = {
        slug: sections[sections.length - 1].slug,
        title: sections[sections.length - 1].title,
        body: iconBody,
      };
      if (skillBody) {
        sections.push({ slug: 'skill-marketplace', title: 'Skill Marketplace', body: skillBody });
      }
    }
  }

  return sections;
}

function writeSectionFile(section) {
  const exportName = toExportName(section.slug);
  const fileName = `${section.slug}.css.ts`;
  const filePath = join(OUT_DIR, fileName);
  const content = `/**
 * Home page styles — ${section.title}
 * @module design-system/pages/home/${section.slug}
 */

/** CSS rules for: ${section.title} */
export const ${exportName} = \`${section.body}\`;
`;
  writeFileSync(filePath, content, 'utf8');
  return { fileName, exportName, slug: section.slug, title: section.title };
}

function writeIndex(modules) {
  const imports = modules
    .map((mod) => `import { ${mod.exportName} } from './${mod.slug}.css';`)
    .join('\n');
  const array = modules.map((mod) => `  ${mod.exportName},`).join('\n');

  const content = `/**
 * ShareOut Design System — User Home Page Styles
 *
 * My Pages dashboard: Drive-like artifact browser.
 * Confident-blue brand. Use with baseStyles from shell.ts.
 *
 * Each segment lives in its own file for maintainability.
 *
 * @module design-system/pages/home
 */

${imports}

/**
 * Ordered CSS sections concatenated for the home page (desktop + shared rules).
 * Mobile layout rules are appended separately via home.mobile.css.ts.
 */
export const homePageComponents = [
${array}
].join('');
`;
  writeFileSync(join(OUT_DIR, 'index.ts'), content, 'utf8');
}

function writeBarrelReexport() {
  const content = `/**
 * ShareOut Design System - User Home Page Styles
 * My Pages dashboard: Drive-like artifact browser.
 * Confident-blue brand. Use with baseStyles from shell.ts.
 *
 * Decomposed into section modules under ./home/ — this file re-exports the barrel.
 */
import { homePageComponents } from './home/index';
import { homeMobileStyles } from './home.mobile.css';

export { homePageComponents };
export const homePageStyles = homePageComponents + homeMobileStyles;
`;
  writeFileSync(SOURCE_FILE, content, 'utf8');
}

function main() {
  const source = readFileSync(SOURCE_FILE, 'utf8');
  const css = extractCssBody(source);
  const sections = splitSections(css);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const modules = sections.map(writeSectionFile);
  writeIndex(modules);
  writeBarrelReexport();

  const totalBytes = sections.reduce((n, s) => n + s.body.length, 0);
  console.log(`Split ${sections.length} sections (${totalBytes} CSS bytes) into ${OUT_DIR}`);
  for (const mod of modules) {
    console.log(`  ${mod.fileName} → ${mod.exportName}`);
  }
}

main();
