// Reads the worker's route matchers straight from router source, so a route added with
// `path === '/x'`, `path.startsWith('/x/')`, `path.match(/^\/x$/)`, a `const X_RE = /^\/x/`
// or a declarative `{ path: '/x/:id' }` entry is picked up without registering it anywhere.

export type MatcherKind = 'exact' | 'prefix' | 'regex' | 'pattern';

export interface RouteMatcher {
  matcher: string;
  kind: MatcherKind;
  files: string[];
}

const LITERAL = /\bpath\s*===\s*'([^']+)'/g;
const PREFIX = /\bpath\.startsWith\('([^']+)'\)/g;
const REGEX_BODY = String.raw`\/(\^\\\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\[\n])*)\/[a-z]*`;
const REGEX = new RegExp(String.raw`\bpath\.match\(${REGEX_BODY}\)|=\s*${REGEX_BODY};`, 'g');
const DECLARED = /\bpath:\s*'(\/[^']*)'/g;

// Files whose path comparisons are not routes (method tables, path parsers).
const NOT_ROUTERS = [/router\/method-policy\.ts$/];

export function extractRouteMatchers(sources: Record<string, string>): RouteMatcher[] {
  const found = new Map<string, RouteMatcher>();
  const add = (matcher: string, kind: MatcherKind, file: string) => {
    const key = `${kind}:${matcher}`;
    const entry = found.get(key) ?? { matcher, kind, files: [] };
    if (!entry.files.includes(file)) entry.files.push(file);
    found.set(key, entry);
  };
  for (const [path, src] of Object.entries(sources)) {
    if (NOT_ROUTERS.some((re) => re.test(path))) continue;
    const file = path.replace(/^(\.\.\/)+/, '');
    for (const m of src.matchAll(LITERAL)) add(m[1], 'exact', file);
    for (const m of src.matchAll(PREFIX)) add(m[1], 'prefix', file);
    for (const m of src.matchAll(REGEX)) add(m[1] ?? m[2], 'regex', file);
    for (const m of src.matchAll(DECLARED)) add(m[1], 'pattern', file);
  }
  return [...found.values()].sort((a, b) => a.matcher.localeCompare(b.matcher));
}

/** A concrete URL path that the matcher accepts, for probing. */
export function sampleUrlFor(matcher: string, kind: MatcherKind): string {
  if (kind === 'exact') return matcher;
  if (kind === 'prefix') return matcher.endsWith('/') ? `${matcher}probe` : `${matcher}/probe`;
  if (kind === 'pattern') return matcher.replace(/:[^/]+/g, 'probe');
  let s = matcher.replace(/^\^/, '').replace(/\$$/, '');
  // Optional groups and optional trailing slashes drop out; then fill required groups.
  for (let i = 0; i < 5; i++) s = s.replace(/\((?:\?:)?(?:[^()]|\([^()]*\))*\)\?/g, '');
  s = s.replace(/\\\/\?/g, '');
  s = s.replace(/\((?:\?:)?([^()|]+)(?:\|[^()]*)?\)/g, (_g, first: string) => fillGroup(first));
  s = s.replace(/\[\^\.\]\+/g, 'probe').replace(/\\(.)/g, '$1');
  return s;
}

function fillGroup(body: string): string {
  const simple = simpleFill(body);
  // A group mixing literals and character classes (`tpl_[a-f0-9]+`, `[0-9]+\.[A-Za-z0-9_-]+`):
  // build one char per class when the simple fill would not match.
  if (!body.includes('[') || new RegExp(`^(?:${body})$`).test(simple)) return simple;
  return body
    .replace(/\[(\^?)((?:\\.|[^\]\\])*)\][+*]?/g, (_c, neg: string, cls: string) => (neg ? 'p' : cls.replace(/^\\/, '').charAt(0)))
    .replace(/\\(.)/g, '$1');
}

function simpleFill(body: string): string {
  if (body === '\\d+') return '1';
  if (/^\[.*\][+*]$/.test(body) || body === '.+' || body === '.*') return 'probe';
  if (/^[a-z0-9]/i.test(body)) return body.replace(/\\(.)/g, '$1');
  if (body.startsWith('\\/')) return body.replace(/\\(.)/g, '$1');
  return 'probe';
}
