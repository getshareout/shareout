/**
 * Scorers, most objective first: the build agent's static check, the browser verify result
 * the instance returns, then the item's own expectations over the produced files. All pure:
 * they read files and results, never the network.
 */
import { PageFiles } from '../../src/build-agent/page-files';
import { checkPage } from '../../src/build-agent/static-check';
import type { Env } from '../../src/types';
import type { Check, EvalItem, Expect, Feature, IssueLine, Lang, StaticScore, VerifyScore, VerifyStatus } from './types';

export interface PageFile {
  path: string;
  content: string;
  mime?: string;
}

const isText = (p: PageFile) => /\.(html?|m?js|css|json|svg|txt)$/i.test(p.path);
const isHtml = (p: PageFile) => /\.html?$/i.test(p.path);

/** 1. The build agent's static check, as the agent ran it before publishing. */
export function scoreStatic(files: PageFile[]): StaticScore {
  const issues = checkPage(PageFiles.from(files), { env: {} as Env, isPublic: false });
  const lines: IssueLine[] = issues.map(({ rule, severity, message, where }) => ({ rule, severity, message, ...(where ? { where } : {}) }));
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity !== 'error').length,
    issues: lines,
  };
}

interface VerifyBody {
  status?: string;
  counts?: { error?: number; warning?: number };
  issues?: Array<{ rule?: string; severity?: string; message?: string; where?: string }>;
}

const STATUSES: VerifyStatus[] = ['pass', 'warn', 'fail', 'partial'];

/** 2. The body of POST /v1/artifacts/{id}/verify. Null when the body is not one. */
export function scoreVerify(body: unknown): VerifyScore | null {
  const b = body as VerifyBody | null;
  if (!b || typeof b !== 'object' || !STATUSES.includes(b.status as VerifyStatus)) return null;
  const issues: IssueLine[] = (b.issues ?? [])
    .filter((i) => i.severity !== 'info')
    .map((i) => ({ rule: i.rule ?? '?', severity: i.severity ?? 'warning', message: i.message ?? '', ...(i.where ? { where: i.where } : {}) }));
  return {
    status: b.status as VerifyStatus,
    errors: b.counts?.error ?? issues.filter((i) => i.severity === 'error').length,
    warnings: b.counts?.warning ?? issues.filter((i) => i.severity === 'warning').length,
    issues,
  };
}

// ── 3. expectation checks ───────────────────────────────────────────────────────

const MANIFEST_RE = /<script\b[^>]*\btype\s*=\s*["']?shareout\/manifest["']?[^>]*>([\s\S]*?)<\/script\s*>/i;

/** Table names under sources.tables of the entry page's manifest. */
export function declaredTables(files: PageFile[]): string[] {
  const html = files.find((f) => f.path === 'index.html')?.content ?? '';
  const m = MANIFEST_RE.exec(html);
  if (!m) return [];
  try {
    return Object.keys((JSON.parse(m[1]) as { sources?: { tables?: Record<string, unknown> } })?.sources?.tables ?? {});
  } catch {
    return [];
  }
}

/** Fillable controls: input (not hidden/submit/button/reset/image), select, textarea. */
export function countFormFields(files: PageFile[]): number {
  let n = 0;
  for (const f of files.filter((p) => isText(p) && !/\.json$/i.test(p.path))) {
    for (const m of f.content.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      if (m[1].toLowerCase() === 'input') {
        const type = m[2].match(/\btype\s*=\s*["']?([a-z-]+)/i)?.[1]?.toLowerCase();
        if (type && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      }
      n++;
    }
  }
  return n;
}

const sourceOf = (files: PageFile[]) => files.filter(isText).map((f) => f.content).join('\n');

/** Heuristics: they say the page has the mechanism, not that it is right (verify and a human decide that). */
const FEATURES: Record<Feature, (src: string) => boolean> = {
  chart: (s) => /chart\.js|chart\.umd|new\s+Chart\s*\(|apexcharts|echarts|plotly|d3(?:\.min)?\.js|d3\.(?:select|scale)|<canvas\b|<svg\b[^>]*>[\s\S]{0,4000}?<(?:rect|path|polyline|circle)\b/i.test(s),
  validation: (s) => /\brequired\b|setCustomValidity|checkValidity|reportValidity|\bminlength\b|\bpattern\s*=|\b(?:min|max)\s*=\s*["']?-?\d|isNaN\(|Number\.isFinite|\.test\(\s*\w+\s*\)/i.test(s),
  formula: (s) => /\.reduce\s*\(|\bMath\.(?:round|floor|ceil|max|min|abs)\s*\(|\.toFixed\s*\(|\bsum\s*\(|\bavg\s*\(|\bpct\s*\(|[a-z_]\w*\s*\/\s*[a-z_]\w*\s*\*\s*100/i.test(s),
  responsive: (s) => /name=["']viewport["']/i.test(s) && /@media|grid-template-columns|flex-wrap|clamp\(|minmax\(|auto-fit|auto-fill/i.test(s),
  persistence: (s) => /\.table\s*\(\s*["'`]/.test(s) && /\.(?:insert|create|add|update|upsert|set)\s*\(/.test(s),
};

/** The text a viewer reads: HTML with scripts, styles and tags removed. */
export function visibleText(files: PageFile[]): string {
  return files.filter(isHtml).map((f) => f.content
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')).join(' ');
}

const ES_WORDS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'para', 'con', 'por', 'una', 'un', 'que', 'en', 'y', 'se', 'su', 'al', 'mes', 'total', 'agregar', 'guardar', 'nuevo', 'nueva', 'todos', 'es', 'lo', 'le', 'si', 'como', 'cada', 'tu', 'mis', 'tus', 'más', 'sin', 'sobre', 'hay', 'quiero']);
const EN_WORDS = new Set(['the', 'of', 'and', 'for', 'with', 'to', 'in', 'your', 'our', 'is', 'are', 'add', 'save', 'new', 'all', 'this', 'from', 'by', 'we', 'you', 'month', 'an', 'that', 'on', 'it', 'each', 'or', 'be', 'can', 'up', 'if', 'at', 'as', 'has', 'have', 'show', 'make']);

/** Which language the visible text reads as, or null when there are too few words to say. */
export function detectLanguage(text: string): Lang | null {
  let es = 0;
  let en = 0;
  for (const w of text.toLowerCase().match(/[a-záéíóúñü]+/g) ?? []) {
    if (ES_WORDS.has(w)) es++;
    if (EN_WORDS.has(w)) en++;
  }
  if (es + en < 5) return null;
  return es > en ? 'es' : 'en';
}

function sectionCount(files: PageFile[]): number {
  let n = 0;
  for (const f of files.filter(isHtml)) n += (f.content.match(/<section\b|<h2\b/gi) ?? []).length;
  return n;
}

const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, ...(detail ? { detail } : {}) });

/** 3. Everything the item expects of the produced files. */
export function scoreExpectations(files: PageFile[], expect: Expect): Check[] {
  const out: Check[] = [];
  const src = sourceOf(files);

  if (expect.tables?.length) {
    const have = new Set(declaredTables(files));
    for (const t of expect.tables) out.push(check(`table:${t}`, have.has(t), have.has(t) ? undefined : `declared: ${[...have].join(', ') || 'none'}`));
  }
  if (expect.minFormFields !== undefined) {
    const n = countFormFields(files);
    out.push(check(`form-fields>=${expect.minFormFields}`, n >= expect.minFormFields, `found ${n}`));
  }
  for (const f of expect.features ?? []) out.push(check(`feature:${f}`, FEATURES[f](src)));
  for (const p of expect.patterns ?? []) {
    let ok = false;
    try { ok = new RegExp(p, 'i').test(src); } catch { /* a bad pattern in the set fails the item loudly below */ }
    out.push(check(`pattern:${p}`, ok));
  }
  if (expect.minSections !== undefined) {
    const n = sectionCount(files);
    out.push(check(`sections>=${expect.minSections}`, n >= expect.minSections, `found ${n}`));
  }
  if (expect.minChars !== undefined) {
    const n = src.length;
    out.push(check(`chars>=${expect.minChars}`, n >= expect.minChars, `found ${n}`));
  }
  if (expect.language) {
    const lang = detectLanguage(visibleText(files));
    out.push(check(`language:${expect.language}`, lang === expect.language, `read as ${lang ?? 'too little text'}`));
  }
  for (const s of expect.preserve ?? []) out.push(check(`preserve:${s.slice(0, 40)}`, src.includes(s)));
  return out;
}

/** Items whose expectations are malformed (a regex that does not compile), caught before spending anything. */
export function validateItem(item: EvalItem): string[] {
  const problems: string[] = [];
  for (const p of item.expect.patterns ?? []) {
    try { new RegExp(p, 'i'); } catch (e) { problems.push(`${item.id}: bad pattern ${p}: ${(e as Error).message}`); }
  }
  if (item.kind === 'edit' && !item.seed?.length) problems.push(`${item.id}: edit item without a seed`);
  if (item.kind === 'build' && item.expect.preserve?.length) problems.push(`${item.id}: preserve only makes sense on edit items`);
  return problems;
}

/** A run passes when the page built, the static check has no errors, verify (if it ran) did not fail, and every expectation held. */
export function runPassed(built: boolean, st: StaticScore | null, verify: VerifyScore | null, checks: Check[]): boolean {
  return built && !!st && st.errors === 0 && (!verify || verify.status !== 'fail') && checks.every((c) => c.pass);
}
