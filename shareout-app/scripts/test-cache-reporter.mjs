// Records each test file that passed, keyed by what it loaded (see test-cache.mjs).
// scripts/test-affected.mjs adds it, with --experimental.importDurations.limit so vitest
// reports every module a file imported.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { APP_DIR, ASSETS_DIR, READS_DISK, keyFor, record, staticClosure, toRel } from './test-cache.mjs';

const readsDisk = new Map();
function touchesDisk(rel) {
  if (!readsDisk.has(rel)) {
    const abs = path.join(APP_DIR, rel);
    readsDisk.set(rel, existsSync(abs) && statSync(abs).isFile() && READS_DISK.test(readFileSync(abs, 'utf8')));
  }
  return readsDisk.get(rel);
}

export default class TestCacheReporter {
  onTestRunEnd(modules, errors, reason) {
    // An unhandled error can come from any file; an interrupted run proves nothing.
    if (errors?.length || reason === 'interrupted') return;
    const entries = {};
    for (const m of modules) {
      if (m.state() !== 'passed') continue;
      const test = toRel(m.moduleId);
      if (!test) continue;
      const deps = new Set(staticClosure(test));
      // Files sharing an isolate are pure by construction (tests/isolation.ts), and their
      // import list mixes in whatever ran earlier in that worker: the static graph is theirs.
      if (m.project.config.isolate !== false) {
        for (const id of Object.keys(m.diagnostic().importDurations)) {
          const rel = toRel(id);
          if (rel && rel !== test) deps.add(rel);
        }
      }
      if (deps.has('src/router/handle-fetch.ts') || /\bASSETS\b/.test(readFileSync(m.moduleId, 'utf8'))) deps.add(ASSETS_DIR);
      // Test code that reads the disk has inputs we can't see: it always runs.
      if (touchesDisk(test) || [...deps].some((d) => !d.startsWith('src/') && touchesDisk(d))) continue;
      entries[test] = { deps: [...deps], key: keyFor(test, deps) };
    }
    if (Object.keys(entries).length) record(entries);
  }
}
