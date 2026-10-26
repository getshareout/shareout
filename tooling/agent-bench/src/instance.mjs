/**
 * A throwaway local ShareOut instance per bench run.
 *
 *   wrangler d1 migrations apply --local --persist-to <state>   (fresh DB)
 *   wrangler dev --local --persist-to <state> on a free port      (the Worker)
 *   counting proxy on another free port                           (what the agent talks to)
 *
 * SHAREOUT_BASE_URL is the proxy origin, so every link the API hands back routes through
 * the counter too. The bench account is the instance's SETUP_ADMIN_EMAIL. `--local`
 * disables remote bindings: nothing here can reach a deployed ShareOut.
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR, ensureDir, freePorts, log, run, sleep } from './lib.mjs';

const WRANGLER = join(APP_DIR, 'node_modules', '.bin', 'wrangler');
export const BENCH_EMAIL = 'bench-owner@bench.shareout.test';
const PUBLISH_TOOLS = new Set(['publish_artifact', 'update_artifact']);

function newCounters() {
  return { http: 0, api: 0, mcp: 0, mcp_tool_calls: 0, publishes: 0, errors_4xx: 0, errors_5xx: 0, by_route: {} };
}

function routeKey(method, path) {
  const p = path
    .split('?')[0]
    .replace(/\/(art|usr|wsp|ver|job|tok)_[A-Za-z0-9]+/g, '/:id')
    .replace(/^\/a\/[^/]+\/.*/, '/a/:slug/*')
    .replace(/^\/v1\/data\/[^/]+/, '/v1/data/:id');
  return `${method} ${p}`;
}

function extractArtifactRefs(text) {
  const refs = [];
  try {
    const j = JSON.parse(text);
    if (j?.artifact?.id || j?.deployment?.url) {
      refs.push({ id: j.artifact?.id, slug: j.deployment?.slug, url: j.deployment?.url });
      return refs;
    }
  } catch {}
  const ids = text.match(/art_[A-Za-z0-9]{6,}/g) || [];
  const urls = text.match(/https?:\/\/[^\s"'\\)]+\/a\/[a-z0-9][a-z0-9-]*\/?/g) || [];
  for (const url of urls) refs.push({ url, slug: url.match(/\/a\/([^/]+)/)[1] });
  for (const id of ids) refs.push({ id });
  return refs;
}

function startProxy(port, upstreamPort, state) {
  const server = http.createServer((req, res) => {
    const started = Date.now();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers, host: `localhost:${port}` };
      delete headers['accept-encoding'];
      const up = http.request(
        { host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers },
        (upRes) => {
          const out = [];
          upRes.on('data', (c) => {
            out.push(c);
            res.write(c);
          });
          upRes.on('end', () => {
            res.end();
            record(state, req, body, upRes.statusCode, Buffer.concat(out), Date.now() - started);
          });
          res.writeHead(upRes.statusCode, upRes.headers);
        }
      );
      up.on('error', (e) => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`bench proxy: upstream error ${e.message}`);
      });
      up.end(body);
    });
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(upstreamPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        lines.push(`${k}: ${k.toLowerCase() === 'host' ? `localhost:${port}` : req.rawHeaders[i + 1]}`);
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
    const c = state.counters[state.phase] ||= newCounters();
    c.http++;
    c.by_route[routeKey('WS', req.url)] = (c.by_route[routeKey('WS', req.url)] || 0) + 1;
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function record(state, req, reqBody, status, resBody, ms) {
  const c = (state.counters[state.phase] ||= newCounters());
  const path = req.url || '/';
  c.http++;
  if (path.startsWith('/v1/')) c.api++;
  if (status >= 500) c.errors_5xx++;
  else if (status >= 400) c.errors_4xx++;
  const key = routeKey(req.method, path);
  c.by_route[key] = (c.by_route[key] || 0) + 1;

  let publish = false;
  if (req.method === 'POST' && path.split('?')[0] === '/v1/publish') publish = true;
  if (path.split('?')[0] === '/mcp' || path.split('?')[0] === '/mcp/') {
    c.mcp++;
    try {
      const msg = JSON.parse(reqBody.toString('utf8'));
      if (msg?.method === 'tools/call') {
        c.mcp_tool_calls++;
        const name = msg.params?.name;
        c.by_route[`MCP ${name}`] = (c.by_route[`MCP ${name}`] || 0) + 1;
        if (PUBLISH_TOOLS.has(name)) publish = true;
      }
    } catch {}
  }
  if (publish) {
    c.publishes++;
    const text = resBody.toString('utf8');
    state.publishes.push({ phase: state.phase, status, ms, at: new Date().toISOString(), refs: status < 300 ? extractArtifactRefs(text) : [], error: status >= 300 || /"isError"\s*:\s*true/.test(text) ? text.slice(0, 500) : undefined });
  }
  state.requests.push({ phase: state.phase, method: req.method, path: path.slice(0, 200), status, ms });
}

async function waitUp(url, timeoutMs, proc) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`wrangler dev exited with code ${proc.exitCode}`);
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`instance not up after ${timeoutMs}ms`);
}

/**
 * The app's wrangler.toml with absolute paths, plus a local `send_email` binding so
 * artifacts that email the owner behave as on a configured instance (Miniflare captures
 * the mail locally; nothing is sent).
 */
function benchConfig(stateDir) {
  let toml = readFileSync(join(APP_DIR, 'wrangler.toml'), 'utf8');
  const swap = (from, to) => {
    if (!toml.includes(from)) throw new Error(`wrangler.toml changed: cannot find ${from}`);
    toml = toml.replace(from, to);
  };
  swap('main = "src/index.ts"', `main = ${JSON.stringify(join(APP_DIR, 'src', 'index.ts'))}`);
  swap('directory = "./public"', `directory = ${JSON.stringify(join(APP_DIR, 'public'))}`);
  swap('database_name = "shareout-db"', `database_name = "shareout-db"\nmigrations_dir = ${JSON.stringify(join(APP_DIR, 'migrations'))}`);
  toml += '\n[[send_email]]\nname = "EMAIL"\n';
  const path = join(stateDir, 'wrangler.bench.toml');
  writeFileSync(path, toml);
  return path;
}

export async function startInstance({ stateDir, logDir }) {
  ensureDir(stateDir);
  ensureDir(logDir);
  const [workerPort, proxyPort, inspectorPort] = await freePorts(3, 55400 + Math.floor(Math.random() * 400));
  const origin = `http://localhost:${proxyPort}`;
  const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };

  log(`instance: migrating fresh D1 in ${stateDir}`);
  const config = benchConfig(stateDir);
  const mig = await run(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', stateDir], { cwd: APP_DIR, env, timeoutMs: 180_000 });
  if (mig.code !== 0) throw new Error(`migrations failed:\n${mig.stdout.slice(-2000)}\n${mig.stderr.slice(-2000)}`);

  const vars = {
    SHAREOUT_BASE_URL: origin,
    SETUP_ADMIN_EMAIL: BENCH_EMAIL,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    VENDOR_PACKAGES_EXTRA: 'axe-core',
    NURTURE_EMAILS_ENABLED: '0',
    LOG_LEVEL: 'warn',
  };
  const args = [
    'dev', '--config', config, '--local', '--port', String(workerPort), '--ip', '127.0.0.1',
    '--inspector-port', String(inspectorPort), '--persist-to', stateDir,
    '--show-interactive-dev-session=false', '--log-level', 'warn',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  log(`instance: wrangler dev on :${workerPort}, proxy on :${proxyPort}`);
  const proc = spawn(WRANGLER, args, { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const wlog = createWriteStream(join(logDir, 'wrangler.log'));
  proc.stdout.pipe(wlog);
  proc.stderr.pipe(wlog);

  const state = { phase: 'setup', counters: {}, publishes: [], requests: [] };
  let server;
  const stop = async () => {
    if (server) await new Promise((r) => server.close(() => r()));
    server = null;
    if (proc.exitCode == null) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
      for (let i = 0; i < 20 && proc.exitCode == null; i++) await sleep(250);
      if (proc.exitCode == null) try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
    }
  };

  try {
    await waitUp(`http://127.0.0.1:${workerPort}/`, 180_000, proc);
    server = await startProxy(proxyPort, workerPort, state);

    const login = await fetch(`${origin}/auth/dev?email=${encodeURIComponent(BENCH_EMAIL)}&redirect=/`, { redirect: 'manual' });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    if (login.status !== 302 || !cookie) throw new Error(`/auth/dev failed: ${login.status}`);
    const minted = await fetch(`${origin}/v1/me/tokens`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'agent-bench' }),
    });
    const tok = await minted.json().catch(() => ({}));
    if (!minted.ok || !tok.token) throw new Error(`token mint failed: ${minted.status} ${JSON.stringify(tok).slice(0, 300)}`);

    return {
      origin,
      workerPort,
      email: BENCH_EMAIL,
      token: tok.token,
      cookie,
      state,
      setPhase(p) { state.phase = p; },
      counters(p) { return state.counters[p] || newCounters(); },
      publishes(p) { return state.publishes.filter((x) => !p || x.phase === p); },
      api(path, init = {}) {
        return fetch(`${origin}${path}`, {
          ...init,
          headers: { authorization: `Bearer ${tok.token}`, 'content-type': 'application/json', ...(init.headers || {}) },
        });
      },
      stop,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
