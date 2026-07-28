#!/usr/bin/env node
/**
 * Decomposes pages/home/render-workspace/client-script/home-views.ts into
 * home-views/*.ts section modules + index.ts barrel.
 *
 * Run from shareout-app/: node scripts/split-home-views.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLIENT = join(ROOT, 'src/pages/home/render-workspace/client-script');
const SOURCE = join(CLIENT, 'home-views.ts');
const OUT_DIR = join(CLIENT, 'home-views');

/** Section definitions: slug → start marker (unique prefix of the comment). */
const SECTIONS = [
  { slug: 'artifacts-browser', marker: '  // ===== rail nav', doc: 'Rail navigation, artifact browser filters, and folder drill-in.' },
  { slug: 'schedules', marker: '  // ----- My Schedules', doc: 'My Schedules lens — Airflow-style job list and run history.' },
  { slug: 'analytics', marker: '  // ----- Analytics', doc: 'Workspace analytics roll-up: totals, trends, daily chart.' },
  { slug: 'datasets', marker: '  // ----- Datasets', doc: 'Workspace shared tables catalogue (read-only).' },
  { slug: 'crew', marker: '  // ----- Crew AI', doc: 'Crew AI automations: run, pause, delete, run history.' },
  { slug: 'library', marker: '  // ----- Library', doc: 'Reusable JS modules and marketplace skills.' },
  { slug: 'connectors', marker: '  // ----- Connectors', doc: 'Provider catalog and existing workspace connections.' },
  { slug: 'modals-forms', marker: '  // ===== Modal + native create forms', doc: 'Shared modal helpers and connector/library create forms.' },
  { slug: 'admin', marker: '  // ----- Admin', doc: 'Admin lens — overview, members, billing, security, settings.' },
  { slug: 'assets', marker: '  // ----- Assets', doc: 'Deliverables library (versions) and asset collections.' },
  { slug: 'deliveries', marker: '  // ----- sent deliveries', doc: 'Sent delivery links: list, copy, revoke.' },
  { slug: 'lens-routing', marker: '  var lenses = ws.querySelectorAll', doc: 'Lens tab routing, lazy view loading, and help panel.' },
];

function extractJsBody(source) {
  const match = source.match(/export const workspace_client_home_views_JS = `([\s\S]*)`;\s*$/);
  if (!match) throw new Error('Could not extract workspace_client_home_views_JS template literal');
  return match[1];
}

function slugToExport(slug) {
  const camel = slug
    .split('-')
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
  return `workspace_client_home_views_${camel}_JS`;
}

function splitBody(body) {
  const chunks = [];
  for (let i = 0; i < SECTIONS.length; i++) {
    const start = body.indexOf(SECTIONS[i].marker);
    if (start === -1) throw new Error(`Marker not found: ${SECTIONS[i].marker}`);
    const end = i + 1 < SECTIONS.length ? body.indexOf(SECTIONS[i + 1].marker) : body.length;
    if (end === -1) throw new Error(`End marker missing after ${SECTIONS[i].slug}`);
    chunks.push({ ...SECTIONS[i], body: body.slice(start, end) });
  }
  return chunks;
}

function writeModule(chunk) {
  const exportName = slugToExport(chunk.slug);
  const file = join(OUT_DIR, `${chunk.slug}.ts`);
  // Concatenate — do not interpolate chunk.body into a template literal (that re-processes escapes).
  const header = `/** ${chunk.doc} */\nexport const ${exportName} = \``;
  const footer = '`;\n';
  writeFileSync(file, header + chunk.body + footer, 'utf8');
  return { file, exportName };
}

function main() {
  const source = readFileSync(SOURCE, 'utf8');
  const body = extractJsBody(source);
  const hash = createHash('sha256').update(body).digest('hex');
  const byteLen = Buffer.byteLength(body, 'utf8');

  mkdirSync(OUT_DIR, { recursive: true });
  const chunks = splitBody(body);
  const imports = [];
  const parts = [];

  for (const chunk of chunks) {
    const { exportName } = writeModule(chunk);
    imports.push(`import { ${exportName} } from './${chunk.slug}';`);
    parts.push(exportName);
  }

  const indexContent = `/**
 * Home pane views — composed from focused client-script fragments.
 * Fragments share one IIFE scope with the rest of WORKSPACE_CLIENT (order matters).
 */
${imports.join('\n')}

/** Full home-views client script (rail lenses: artifacts, schedules, admin, …). */
export const workspace_client_home_views_JS = [
${parts.map((p) => `  ${p},`).join('\n')}
].join('');
`;

  writeFileSync(join(OUT_DIR, 'index.ts'), indexContent, 'utf8');

  const legacy = `/**
 * @deprecated Import from \`./home-views/index\` — kept for stable import path.
 * Home pane views client script (artifacts, schedules, admin, assets, …).
 */
export { workspace_client_home_views_JS } from './home-views/index';
`;
  writeFileSync(SOURCE, legacy, 'utf8');

  const meta = { byteLen, sha256: hash, sections: chunks.map((c) => c.slug) };
  writeFileSync(join(OUT_DIR, 'bundle-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log(`Split ${SOURCE} → ${OUT_DIR}/ (${chunks.length} modules)`);
  console.log(`Bundle: ${byteLen} bytes, sha256=${hash}`);
  for (const c of chunks) {
    const lines = c.body.split('\n').length;
    console.log(`  ${c.slug}.ts — ${lines} lines`);
  }
}

main();
