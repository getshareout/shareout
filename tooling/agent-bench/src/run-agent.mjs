/**
 * Run one brief through a headless Claude Code agent and capture what it cost.
 *
 * cli mode — the agent works in a temp dir with the skill under test installed as a
 *   project skill, real tools (Bash/Read/Write/Edit), and SHAREOUT_ORIGIN/SHAREOUT_TOKEN
 *   in its environment. Its shell sees HOME as a throwaway dir whose
 *   ~/.shareout/credentials points at the bench instance (CLAUDE_ENV_FILE), the way a
 *   signed-in user's machine looks. Bash runs in Claude Code's OS sandbox with network
 *   limited to localhost, and the real ~/.shareout is unreadable: the agent cannot reach
 *   any deployed ShareOut, nor pick up the operator's real credentials.
 * mcp mode — simulates claude.ai / ChatGPT: no shell, no file tools, no skill; only the
 *   instance's /mcp connector (Bearer token). Fixtures are pasted into the prompt as
 *   attachments.
 *
 * Isolation from the operator's own Claude setup: --setting-sources project (no user
 * settings, plugins, hooks or CLAUDE.md), --strict-mcp-config, no session persistence,
 * auto-memory off, and a work dir outside any repo. Set CLAUDE_BENCH_CONFIG_DIR to a
 * dedicated, logged-in config dir to isolate further.
 */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BENCH_DIR, childClaudeEnv, ensureDir, log, run } from './lib.mjs';

const CLI_TOOLS = 'Bash,Read,Write,Edit,Skill,Task';

function benchSettings() {
  return {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: ['localhost', '127.0.0.1'], allowLocalBinding: true },
    },
    permissions: {
      deny: ['Read(~/.shareout/**)', 'Edit(~/.shareout/**)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)'],
    },
    autoMemoryEnabled: false,
  };
}

export function renderPrompt(brief, ctx) {
  return brief.prompt.replace(/\{\{(\w+)(?::([\w-]+))?\}\}/g, (m, k, arg) => {
    if (k === 'url' && ctx.setup?.[arg]) return ctx.setup[arg].url;
    if (k === 'origin') return ctx.origin;
    return m;
  });
}

function attachFixtures(brief) {
  return (brief.fixtures || [])
    .map((f) => {
      const text = readFileSync(join(BENCH_DIR, 'fixtures', f), 'utf8');
      return `\n\n<attached_file name="${basename(f)}">\n${text}\n</attached_file>`;
    })
    .join('');
}

const URL_RE = /https?:\/\/([a-z0-9.-]+)(?::\d+)?/gi;

export function summarizeTranscript(lines) {
  const out = { init: null, result: null, tool_calls: 0, tools: {}, external_hosts: [], assistant_turns: 0, skill_loaded: false, files_read: [] };
  const hosts = new Set();
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') out.init = ev;
    if (ev.type === 'result') out.result = ev;
    if (ev.type === 'assistant') {
      out.assistant_turns++;
      for (const c of ev.message?.content || []) {
        if (c.type !== 'tool_use') continue;
        out.tool_calls++;
        out.tools[c.name] = (out.tools[c.name] || 0) + 1;
        if (c.name === 'Skill') out.skill_loaded = true;
        if (c.name === 'Read' && c.input?.file_path) out.files_read.push(c.input.file_path);
        if (c.name === 'Read' && /shareout-skill\/SKILL\.md$/.test(c.input?.file_path || '')) out.skill_loaded = true;
        const cmd = c.name === 'Bash' ? String(c.input?.command || '') : '';
        for (const m of cmd.matchAll(URL_RE)) {
          const h = m[1].toLowerCase();
          if (h !== 'localhost' && h !== '127.0.0.1') hosts.add(h);
        }
      }
    }
  }
  out.external_hosts = [...hosts];
  return out;
}

export async function runAgent({ brief, inst, skillDir, mode, model, workDir, outDir, setup }) {
  ensureDir(workDir);
  ensureDir(outDir);
  const minutes = brief.budget?.minutes ?? 20;
  const usd = brief.budget?.usd ?? 5;
  let prompt = renderPrompt(brief, { origin: inst.origin, setup });

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--setting-sources', 'project', '--strict-mcp-config', '--permission-prompts', 'none',
    '--max-budget-usd', String(usd)];
  if (model) args.push('--model', model);

  const settingsPath = join(workDir, '..', `${basename(workDir)}.settings.json`);
  const envFile = join(workDir, '..', 'bash-env.sh');
  writeFileSync(settingsPath, JSON.stringify(benchSettings(), null, 2));
  args.push('--settings', settingsPath);

  if (mode === 'mcp') {
    const mcp = { mcpServers: { shareout: { type: 'http', url: `${inst.origin}/mcp`, headers: { Authorization: `Bearer ${inst.token}` } } } };
    args.push('--mcp-config', JSON.stringify(mcp), '--tools', 'ToolSearch', '--allowedTools', 'mcp__shareout', 'ToolSearch', '--disallowedTools', 'Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch');
    prompt += attachFixtures(brief);
  } else {
    const home = ensureDir(join(workDir, '..', 'home'));
    ensureDir(join(home, '.shareout'));
    writeFileSync(join(home, '.shareout', 'credentials'), JSON.stringify({ token: inst.token, origin: inst.origin }, null, 2), { mode: 0o600 });
    writeFileSync(envFile, `export HOME=${JSON.stringify(home)}\n`);
    args.push('--mcp-config', JSON.stringify({ mcpServers: {} }), '--tools', CLI_TOOLS, '--allowedTools', 'Read', 'Write', 'Edit', 'Skill', '--permission-mode', 'acceptEdits');
    if (skillDir) cpSync(skillDir, join(workDir, '.claude', 'skills', 'shareout-skill'), { recursive: true });
    for (const f of brief.fixtures || []) cpSync(join(BENCH_DIR, 'fixtures', f), join(workDir, basename(f)), { recursive: true });
  }

  writeFileSync(join(outDir, 'prompt.txt'), prompt);
  const transcript = [];
  log(`agent[${mode}] ${brief.id}: start (budget ${minutes}m / $${usd})`);
  inst.setPhase('agent');
  const res = await run('claude', args, {
    cwd: workDir,
    env: childClaudeEnv(mode === 'mcp' ? {} : { SHAREOUT_ORIGIN: inst.origin, SHAREOUT_TOKEN: inst.token, CLAUDE_ENV_FILE: envFile }),
    input: prompt,
    timeoutMs: minutes * 60_000,
    onLine: (l) => transcript.push(l),
  });
  inst.setPhase('post');
  writeFileSync(join(outDir, 'transcript.jsonl'), transcript.join('\n') + '\n');
  if (res.stderr) writeFileSync(join(outDir, 'agent.stderr.txt'), res.stderr);

  const t = summarizeTranscript(transcript);
  const r = t.result || {};
  const u = r.usage || {};
  const summary = {
    mode,
    model: t.init?.model || model || null,
    exit_code: res.code,
    timed_out: res.timedOut,
    is_error: !!r.is_error,
    terminal_reason: r.terminal_reason || null,
    wall_ms: res.ms,
    duration_ms: r.duration_ms ?? null,
    cost_usd: r.total_cost_usd ?? null,
    turns: r.num_turns ?? null,
    tokens: {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      cache_write: u.cache_creation_input_tokens ?? 0,
      total: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    },
    tool_calls: t.tool_calls,
    tools: t.tools,
    skill_loaded: t.skill_loaded,
    external_hosts: t.external_hosts,
    environment: t.init
      ? {
          skills: t.init.skills,
          plugins: (t.init.plugins || []).map((p) => p.source || p.name),
          mcp_servers: (t.init.mcp_servers || []).map((s) => `${s.name}:${s.status}`),
          tools: t.init.tools,
        }
      : null,
    final_message: typeof r.result === 'string' ? r.result.slice(0, 4000) : null,
  };
  log(`agent ${brief.id}: done in ${Math.round(res.ms / 1000)}s, $${summary.cost_usd?.toFixed?.(3)}, ${summary.tool_calls} tool calls${res.timedOut ? ' (TIMED OUT)' : ''}`);
  return summary;
}
