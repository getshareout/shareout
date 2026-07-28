#!/usr/bin/env node
/**
 * One-shot splitter: decomposes serve/sandbox-viewer/toolbar/styles.ts into
 * toolbar/styles/*.css.ts section modules + index.ts barrel.
 *
 * Run from shareout-app/: node scripts/split-toolbar-styles.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TOOLBAR_DIR = join(ROOT, 'src/serve/sandbox-viewer/toolbar');
const SOURCE_FILE = join(TOOLBAR_DIR, 'styles.ts');
const OUT_DIR = join(TOOLBAR_DIR, 'styles');

/** Ordered section anchors — preserve 4-space indent from the monolith for byte-identical output. */
const SECTIONS = [
  {
    file: 'toolbar-shell.css.ts',
    exportName: 'toolbarShellStyles',
    title: 'Floating toolbar shell, buttons, trigger, and avatar',
    start: null,
    endBefore: '    #so-back-zone',
  },
  {
    file: 'back-home.css.ts',
    exportName: 'backHomeStyles',
    title: 'Back-to-home hover zone and pill link',
    start: '    #so-back-zone',
    endBefore: '    #so-stats-overlay',
  },
  {
    file: 'stats-skills-overlay.css.ts',
    exportName: 'statsSkillsOverlayStyles',
    title: 'Stats and skills slide-up overlays',
    start: '    #so-stats-overlay',
    endBefore: '    #so-admin-overlay',
  },
  {
    file: 'admin-overlay.css.ts',
    exportName: 'adminOverlayStyles',
    title: 'Artifact admin properties overlay',
    start: '    #so-admin-overlay',
    endBefore: '    #so-comments-overlay',
  },
  {
    file: 'comments-overlay.css.ts',
    exportName: 'commentsOverlayStyles',
    title: 'Comments panel, pins, and composer',
    start: '    #so-comments-overlay',
    endBefore: '    /* Viewer schedule / alert modals */',
  },
  {
    file: 'schedule-modals.css.ts',
    exportName: 'scheduleModalsStyles',
    title: 'Viewer schedule and alert modal forms',
    start: '    /* Viewer schedule / alert modals */',
    endBefore: '    @media (max-width: 640px)',
  },
  {
    file: 'responsive.css.ts',
    exportName: 'responsiveStyles',
    title: 'Mobile toolbar layout and overlay sizing',
    start: '    @media (max-width: 640px)',
    endBefore: null,
  },
];

function extractCssBody(source) {
  const match = source.match(/export const TOOLBAR_STYLES = `([\s\S]*?)`;\s*$/);
  if (!match) throw new Error('Could not extract TOOLBAR_STYLES template literal');
  return match[1];
}

function sliceSection(css, { start, endBefore }) {
  const startIdx = start == null ? 0 : css.indexOf(start);
  if (start != null && startIdx === -1) throw new Error(`Section anchor not found: ${start}`);
  const endIdx = endBefore ? css.indexOf(endBefore, startIdx) : css.length;
  if (endBefore && endIdx === -1) throw new Error(`Section end anchor not found: ${endBefore}`);
  return css.slice(startIdx, endIdx);
}

function writeSectionModule({ file, exportName, title, body }) {
  const content = `/**
 * Viewer toolbar styles — ${title}
 * @module serve/sandbox-viewer/toolbar/styles/${file.replace('.css.ts', '')}
 */

/** CSS rules for: ${title} */
export const ${exportName} = \`${body}\`;
`;
  writeFileSync(join(OUT_DIR, file), content, 'utf8');
}

function writeBarrel(sections) {
  const imports = sections
    .map((s) => `import { ${s.exportName} } from './${s.file.replace('.ts', '')}';`)
    .join('\n');
  const array = sections.map((s) => `  ${s.exportName},`).join('\n');
  const content = `/**
 * CSS for the floating viewer toolbar (favorites, comments, admin overlays).
 * Injected only when the viewer is logged in or comments are enabled.
 *
 * Each segment lives in its own file for maintainability; the barrel
 * concatenates them in DOM-order so cascade behavior is unchanged.
 *
 * @module serve/sandbox-viewer/toolbar/styles
 */
${imports}

/** Ordered CSS sections concatenated for the viewer toolbar. */
export const TOOLBAR_STYLES = [
${array}
].join('');
`;
  writeFileSync(join(OUT_DIR, 'index.ts'), content, 'utf8');
}

function writeLegacyReexport() {
  const content = `/**
 * @deprecated Import from \`./styles/index\` — kept for stable import paths.
 */
export { TOOLBAR_STYLES } from './styles/index';
`;
  writeFileSync(SOURCE_FILE, content, 'utf8');
}

const source = readFileSync(SOURCE_FILE, 'utf8');
const css = extractCssBody(source);

mkdirSync(OUT_DIR, { recursive: true });

const written = [];
for (const section of SECTIONS) {
  const body = sliceSection(css, section);
  writeSectionModule({ ...section, body });
  written.push(section);
  console.log(`  wrote ${section.file} (${body.length} bytes)`);
}

writeBarrel(written);
writeLegacyReexport();
console.log(`\nDone — ${written.length} sections + barrel; legacy styles.ts is a re-export.`);
