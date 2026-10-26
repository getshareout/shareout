/**
 * Read a published page for provenance: the manifest it declares, the elements its
 * bindings feed, and the SDK stores its scripts call. One HTMLRewriter pass over the
 * page plus a regex pass over its scripts — no DOM, worker only.
 */
import { parseManifest, type ParsedManifest } from '../../shared/editor-readiness/manifest';
import { parseMetricsBlock } from '../metric-alerts/definitions';
import { attrSelector, bindingRefs, idSelector, isTemplatePlaceholder, normalizeRef } from './refs';

/** An element on the page and the sources it shows. */
export interface ScannedElement {
  refs: string[];
  selector: string;
  element_id?: string;
  label?: string;
  /** Raw data-shareout-binding expressions (metric feeds match on them). */
  bindings?: string[];
}

/** Stores the page's scripts call by literal name. */
export interface CodeRefs {
  json: Set<string>;
  tables: Set<string>;
  connections: Set<string>;
  datasets: Set<string>;
  platforms: Set<string>;
  secrets: Set<string>;
  files: Set<string>;
  knowledge: boolean;
  blobs: boolean;
}

export interface PageScan {
  manifest: ParsedManifest | null;
  elements: ScannedElement[];
  code: CodeRefs;
  /** Same-artifact script paths the page loads (`<script src>`), resolved against it. */
  scriptPaths: string[];
  /** Metric ids the page declares in its own `shareout/metrics` block. */
  metricIds: Set<string>;
}

// Source-carrying attributes, in the order a selector is built from.
const FEED_ATTRS = [
  'data-shareout-binding',
  'data-shareout-template-source',
  'data-shareout-chart-data',
  'data-shareout-options-source',
  'data-shareout-source',
] as const;

const MAX_ELEMENTS = 2000;
const MAX_LABEL = 80;

export function emptyCodeRefs(): CodeRefs {
  return {
    json: new Set(), tables: new Set(), connections: new Set(), datasets: new Set(),
    platforms: new Set(), secrets: new Set(), files: new Set(), knowledge: false, blobs: false,
  };
}

export async function scanPage(html: string, pagePath: string): Promise<PageScan> {
  const manifest = parseManifest(html);
  const computed = (manifest?.manifest.computed ?? {}) as Record<string, { formula?: unknown }>;
  const elements: ScannedElement[] = [];
  const scripts: string[] = [];
  const scriptPaths: string[] = [];
  let inlineScript: string[] | null = null;

  const rewriter = new HTMLRewriter()
    .on('*', {
      element(el) {
        if (elements.length >= MAX_ELEMENTS) return;
        const refs = new Set<string>();
        let selectorAttr: string | null = null;
        for (const attr of FEED_ATTRS) {
          const value = el.getAttribute(attr);
          if (value === null) continue;
          const found = attr === 'data-shareout-binding'
            ? (isTemplatePlaceholder(value) ? [] : bindingRefs(value, computed))
            : [normalizeRef(value, attr !== 'data-shareout-source')].filter((r): r is string => !!r);
          if (!found.length) continue;
          found.forEach((r) => refs.add(r));
          selectorAttr ??= attr;
        }
        if (!refs.size || !selectorAttr) return;
        const id = el.getAttribute('id')?.trim() || undefined;
        const binding = el.getAttribute('data-shareout-binding');
        elements.push({
          refs: [...refs],
          selector: id ? idSelector(id) : attrSelector(selectorAttr, el.getAttribute(selectorAttr) ?? ''),
          ...(id ? { element_id: id } : {}),
          ...labelFor(el),
          ...(binding ? { bindings: [binding.trim()] } : {}),
        });
      },
    })
    .on('script', {
      element(el) {
        const src = el.getAttribute('src');
        if (src) {
          const resolved = resolveScriptPath(src, pagePath);
          if (resolved) scriptPaths.push(resolved);
          return;
        }
        const type = (el.getAttribute('type') || '').trim().toLowerCase();
        if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') return;
        const chunks: string[] = [];
        inlineScript = chunks;
        el.onEndTag(() => {
          scripts.push(chunks.join(''));
          inlineScript = null;
        });
      },
      text(chunk) {
        inlineScript?.push(chunk.text);
      },
    });

  await rewriter.transform(new Response(html)).arrayBuffer();

  const code = detectCodeRefs(scripts);
  for (const m of html.matchAll(FILE_URL)) code.files.add(m[1]);
  const metricIds = new Set(
    parseMetricsBlock(html)
      .map((m) => (m.id ?? m.metric_id) as unknown)
      .filter((id): id is string => typeof id === 'string'),
  );
  return { manifest, elements, code, scriptPaths: [...new Set(scriptPaths)], metricIds };
}

function labelFor(el: Element): { label?: string } {
  const chart = el.getAttribute('data-shareout-chart');
  let chartTitle: string | undefined;
  if (chart && chart.trim().startsWith('{')) {
    try {
      const t = (JSON.parse(chart) as { title?: unknown }).title;
      if (typeof t === 'string') chartTitle = t;
    } catch { /* not JSON: no title */ }
  }
  const label = [
    el.getAttribute('data-shareout-display'),
    chartTitle,
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('alt'),
  ].find((v) => typeof v === 'string' && v.trim());
  return label ? { label: label.trim().slice(0, MAX_LABEL) } : {};
}

/** A same-artifact script path relative to the page, or null for absolute/foreign URLs. */
export function resolveScriptPath(src: string, pagePath: string): string | null {
  const clean = src.trim().split(/[?#]/)[0];
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//') || clean.startsWith('/')) return null;
  const base = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/') + 1) : '';
  const out: string[] = [];
  for (const seg of (base + clean).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); continue; }
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

// Literal-name SDK calls. Variable names vary (so, sdk, app.so), so match on the call.
const Q = String.raw`\s*(['"\x60])([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})\1`;
const PATTERNS: Array<[keyof Omit<CodeRefs, 'knowledge' | 'blobs'>, RegExp]> = [
  ['json', new RegExp(String.raw`\.json\s*\.\s*(?:get|set|update|delete|exists|subscribe|watch|increment|merge|push|append)\s*\(${Q}`, 'g')],
  ['tables', new RegExp(String.raw`\.(?:table|grid)\s*\(${Q}`, 'g')],
  ['connections', new RegExp(String.raw`\.connection\s*\(${Q}`, 'g')],
  ['datasets', new RegExp(String.raw`\.dataset\s*\(${Q}`, 'g')],
  ['platforms', new RegExp(String.raw`\.platform\s*\.\s*provider\s*\(${Q}`, 'g')],
  ['secrets', new RegExp(String.raw`\.secrets\s*\.\s*(?:get|post|put|delete|proxy)\s*\(${Q}`, 'g')],
  ['files', new RegExp(String.raw`\.files\s*\.\s*getUrl\s*\(\s*(['"\x60])(dlv_[A-Za-z0-9_-]{1,64})\1`, 'g')],
];
const KNOWLEDGE = /\.knowledge\s*\.\s*search\s*\(/;
const BLOBS_READ = /\.blobs\s*\.\s*(?:list|get|getDownloadUrl)\s*\(/;
const FILE_URL = /\/v1\/files\/(dlv_[A-Za-z0-9_-]{1,64})\/content/g;

/** Fold `extra` (e.g. the page's own script files) into `into`. */
export function mergeCodeRefs(into: CodeRefs, extra: CodeRefs): CodeRefs {
  for (const bucket of ['json', 'tables', 'connections', 'datasets', 'platforms', 'secrets', 'files'] as const) {
    extra[bucket].forEach((v) => into[bucket].add(v));
  }
  into.knowledge ||= extra.knowledge;
  into.blobs ||= extra.blobs;
  return into;
}

export function detectCodeRefs(sources: string[]): CodeRefs {
  const out = emptyCodeRefs();
  for (const src of sources) {
    if (!src) continue;
    for (const [bucket, re] of PATTERNS) {
      for (const m of src.matchAll(re)) out[bucket].add(m[2]);
    }
    for (const m of src.matchAll(FILE_URL)) out.files.add(m[1]);
    if (KNOWLEDGE.test(src)) out.knowledge = true;
    if (BLOBS_READ.test(src)) out.blobs = true;
  }
  return out;
}
