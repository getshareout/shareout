// Decides which workers-pool test files may share one isolate (vitest `isolate: false`).
//
// A fresh isolate per file re-imports the module graph every time — that was ~90% of
// the suite's wall time. Files that only call code and assert can share an isolate.
// Files that mock modules, patch globals, fake timers, or touch the shared D1/DO
// bindings cannot: their state leaks into whatever file runs next in that isolate.
// The check follows local imports, so a test that pulls `vi.mock` in through
// `./mocks` or `./setup` is caught too.
//
// A file the scan cannot see through — e.g. a victim of a module-level cache in src/ —
// opts out with a `vitest-isolate` comment anywhere in the file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const NEEDS_ISOLATE =
  /vitest-isolate|vi\.(mock|doMock|stubGlobal|stubEnv|mocked|unstubAll|useFakeTimers)\b|vi\.spyOn\(globalThis|globalThis\.\w+\s*=[^=]|cloudflare:(test|workers)|migrated-db|\benv\.DB\b/;
const LOCAL_IMPORT = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;

function resolveLocal(from: string, spec: string): string | undefined {
  const base = normalize(join(dirname(from), spec));
  return [base, `${base}.ts`, base.replace(/\.js$/, '.ts'), join(base, 'index.ts')].find(
    (p) => p.endsWith('.ts') && existsSync(p),
  );
}

export function sharedIsolateFiles(root: string, testsDir: string, notWorkers: (rel: string) => boolean): string[] {
  const memo = new Map<string, boolean>();
  const needsIsolate = (file: string): boolean => {
    const cached = memo.get(file);
    if (cached !== undefined) return cached;
    memo.set(file, false);
    const src = readFileSync(file, 'utf8');
    const result =
      NEEDS_ISOLATE.test(src) ||
      [...src.matchAll(LOCAL_IMPORT)].some(([, spec]) => {
        const dep = resolveLocal(file, spec);
        return dep !== undefined && dep.startsWith(join(root, 'tests')) && needsIsolate(dep);
      });
    memo.set(file, result);
    return result;
  };
  return (readdirSync(join(root, testsDir), { recursive: true }) as string[])
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => relative(root, join(root, testsDir, f)).split('\\').join('/'))
    .filter((rel) => !notWorkers(rel) && !needsIsolate(join(root, rel)))
    .sort();
}
