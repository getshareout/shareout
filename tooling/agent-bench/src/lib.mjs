import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = join(BENCH_DIR, '..', '..');
export const APP_DIR = join(REPO_DIR, 'shareout-app');
export const SKILL_DIR = join(REPO_DIR, 'skills', 'ShareOutSkill');

const appRequire = createRequire(join(APP_DIR, 'package.json'));

/** Dependencies come from shareout-app's node_modules so the bench adds none of its own. */
export function appModule(name) {
  return appRequire(name);
}

export function appResolve(name) {
  return appRequire.resolve(name);
}

export const CHROME_FOR_TESTING =
  process.env.BENCH_CHROME ||
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

export function assertChromeForTesting() {
  if (/\/Google Chrome\.app\//.test(CHROME_FOR_TESTING)) {
    throw new Error('BENCH_CHROME points at the everyday Chrome app; use Chrome for Testing');
  }
  if (!existsSync(CHROME_FOR_TESTING)) {
    throw new Error(
      `Chrome for Testing not found at ${CHROME_FOR_TESTING}. Install it with ` +
        '`npx @puppeteer/browsers install chrome@stable` and set BENCH_CHROME to the binary.'
    );
  }
  return CHROME_FOR_TESTING;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort(start = 55400) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > 55999) return reject(new Error('no free port in 55400-55999'));
      const srv = createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryPort(start);
  });
}

export async function freePorts(n, start = 55400) {
  const out = [];
  let next = start;
  for (let i = 0; i < n; i++) {
    const p = await freePort(next);
    out.push(p);
    next = p + 1;
  }
  return out;
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function timestamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.error(`[${t}]`, ...args);
}

/** Environment for child Claude processes: drop the parent session's markers. */
export function childClaudeEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN')) delete env[k];
  }
  delete env.CLAUDE_EFFORT;
  delete env.CLAUDE_PID;
  if (process.env.CLAUDE_BENCH_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_BENCH_CONFIG_DIR;
  return { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', DISABLE_AUTOUPDATER: '1', ...extra };
}

/**
 * Run a process to completion, streaming stdout lines to `onLine`.
 * Resolves with { code, stdout, stderr, ms, timedOut }.
 */
export function run(cmd, args, { cwd, env, input, timeoutMs, onLine } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let buf = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000);
        }, timeoutMs)
      : null;
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (onLine) {
        buf += s;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (onLine && buf) onLine(buf);
      resolve({ code, stdout, stderr, ms: Date.now() - started, timedOut });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function spread(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (v.length < 2) return 0;
  return Math.max(...v) - Math.min(...v);
}

export const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
