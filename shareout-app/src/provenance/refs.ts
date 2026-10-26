/**
 * Source refs (`kind:name`) and how page markup points at them. Pure string logic shared
 * by the HTML scan and its tests: binding expressions, template/chart sources, computed
 * formulas, and the CSS selector a viewer frame uses to find a fed element.
 */
import type { SourceKind } from './types';

const KINDS: ReadonlySet<string> = new Set<SourceKind>([
  'table', 'json', 'file', 'connection', 'mcp', 'dataset', 'knowledge', 'metric', 'external',
]);

// Store keys allow letters, digits, `_`, `-` and `.` (json keys); everything else is noise.
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/**
 * A `kind:name` ref, or null. `path` reads the name the way bindings do — a json path
 * names its stored key before the first `.` (`json:metrics.revenue` → `json:metrics`)
 * and a table expression its table (`table:orders:sum:amount` → `table:orders`).
 * Without it the name is taken whole, as `data-shareout-source` and SDK calls write it.
 */
export function normalizeRef(raw: string | null | undefined, path = false): string | null {
  const s = (raw ?? '').trim();
  const colon = s.indexOf(':');
  if (colon < 1) return null;
  const kind = s.slice(0, colon).toLowerCase();
  let name = s.slice(colon + 1).trim();
  if (!KINDS.has(kind) || !name) return null;
  if (path && kind === 'json') name = jsonRoot(name);
  else if (kind === 'table' || (path && kind !== 'json')) name = name.split(':')[0];
  if (!NAME.test(name)) return null;
  return `${kind}:${name}`;
}

export function refKind(ref: string): SourceKind {
  return ref.slice(0, ref.indexOf(':')) as SourceKind;
}

export function refName(ref: string): string {
  return ref.slice(ref.indexOf(':') + 1);
}

/** The stored json key a path reads: `metrics.revenue[0]` → `metrics`. */
export function jsonRoot(path: string): string {
  return path.split(/[.[]/)[0];
}

/** Table names a manifest `computed` formula reads: `sum(orders:amount)` → `['orders']`. */
export function formulaTables(formula: string): string[] {
  const out = new Set<string>();
  for (const m of formula.matchAll(/\(\s*([\w$-]+)\s*:/g)) out.add(m[1]);
  return [...out];
}

/**
 * Refs a `data-shareout-binding` expression reads. `computed:name` resolves through the
 * manifest's formulas; the editor's inline form `computed:name:a+b` lists its sources.
 */
export function bindingRefs(expr: string, computed: Record<string, { formula?: unknown }> = {}, depth = 0): string[] {
  const s = expr.trim();
  if (!s || depth > 4) return [];
  const parts = s.split(':');
  const type = parts[0];
  if (type === 'json' || type === 'table') {
    const ref = normalizeRef(s, true);
    return ref ? [ref] : [];
  }
  if (type === 'computed') {
    const name = parts[1] ?? '';
    if (parts.length > 2) {
      return uniq(parts.slice(2).join(':').split('+').flatMap((p) => bindingRefs(p, computed, depth + 1)));
    }
    const formula = computed[name]?.formula;
    return typeof formula === 'string' ? formulaTables(formula).map((t) => `table:${t}`) : [];
  }
  if (type === 'multi') {
    return uniq(parts.slice(2).join(':').split('|').flatMap((p) => bindingRefs(p, computed, depth + 1)));
  }
  const ref = normalizeRef(s, true);
  return ref ? [ref] : [];
}

/** Template placeholders (`table:tasks:row:$id:title`) repeat per item; the list is the feed. */
export function isTemplatePlaceholder(expr: string): boolean {
  return expr.includes('$id') || expr.includes('$index');
}

/** CSS.escape for identifiers (https://drafts.csswg.org/cssom/#serialize-an-identifier). */
export function cssEscapeIdent(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (code === 0) { out += '�'; continue; }
    if ((code >= 0x1 && code <= 0x1f) || code === 0x7f
      || (i === 0 && code >= 0x30 && code <= 0x39)
      || (i === 1 && code >= 0x30 && code <= 0x39 && value.charCodeAt(0) === 0x2d)) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    if (i === 0 && value.length === 1 && code === 0x2d) { out += `\\${ch}`; continue; }
    if (code >= 0x80 || code === 0x2d || code === 0x5f || /[0-9A-Za-z]/.test(ch)) { out += ch; continue; }
    out += `\\${ch}`;
  }
  return out;
}

/** `[attr="value"]` with the value quoted for a CSS string. */
export function attrSelector(attr: string, value: string): string {
  const quoted = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
  return `[${attr}="${quoted}"]`;
}

export function idSelector(id: string): string {
  return `#${cssEscapeIdent(id)}`;
}

function uniq<T>(list: T[]): T[] {
  return [...new Set(list)];
}
