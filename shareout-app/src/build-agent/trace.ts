/**
 * A trace for every AI page build: what the builder did and how it ended, kept in
 * page_build_traces and shown in the admin Health view. ai_usage_events has the tokens
 * per call; this is the story across them, so a failed build can be explained later.
 *
 * Both builders feed one BuildTrace. The tool-using agent is observed from outside, through
 * `traceProvider` (every model turn and the tool results it is sent next) and its
 * verify/publish deps, so agent.ts needs no changes. The one-shot builder reports its
 * turns itself. A trace never holds file contents, and recording never throws.
 */
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { createLogger } from '../logging';
import type { AiMeter } from '../data/ai-usage';
import type { CrewProvider, NeutralToolCall, ProviderEvent, ProviderTurnArgs } from '../crew/provider';
import { gatewayReasoningParams } from '../data/agent/models';
import { TOOL } from './tools';

export type BuildPath = 'agent' | 'one_shot';
/** `previewed`: a one-shot build that was shown, not published (the /create preview phase). */
export type BuildOutcome = 'published' | 'previewed' | 'gave_up' | 'failed' | 'truncated';

export type TraceStep =
  | { k: 'turn'; n: number; stop: string; in: number; out: number }
  | { k: 'tool'; name: string; ok: boolean | null }
  | { k: 'check'; errors: number }
  | { k: 'verify'; status: string; errors: number }
  | { k: 'publish'; ok: boolean; draft: boolean }
  | { k: 'note'; text: string }
  | { k: 'dropped'; count: number };

/** Most steps kept per build; the rest are counted, not stored. */
export const MAX_TRACE_STEPS = 150;
/** Hard cap on the stored steps JSON, in characters. */
export const MAX_STEPS_JSON = 16_000;
const MAX_TEXT = 500;
const RETENTION_DAYS = 90;

const clip = (s: string | undefined | null, n = MAX_TEXT): string | null => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

/** Keeps the serialized steps under `max` characters by dropping from the end and saying how many went. */
export function capSteps(steps: TraceStep[], dropped = 0, max = MAX_STEPS_JSON): string {
  let kept = steps;
  let lost = dropped;
  const render = () => JSON.stringify(lost ? [...kept, { k: 'dropped', count: lost } satisfies TraceStep] : kept);
  let json = render();
  while (json.length > max && kept.length > 0) {
    const cut = Math.max(1, Math.floor(kept.length / 4));
    lost += cut;
    kept = kept.slice(0, kept.length - cut);
    json = render();
  }
  return json;
}

export interface TraceFinish {
  artifactId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export class BuildTrace {
  readonly id = generateId('bld');
  private readonly startedAt = new Date();
  private steps: TraceStep[] = [];
  private dropped = 0;
  private pending = new Map<string, string>();
  private done = false;
  private model: string | null = null;
  private effort: string | null = null;
  private turns = 0;
  private toolCount = 0;
  private toolErrors = 0;
  private checkRounds = 0;
  private verifyStatus: string | null = null;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(
    private readonly env: Env,
    private readonly meter: AiMeter,
    readonly path: BuildPath,
  ) {}

  private push(step: TraceStep): void {
    if (this.steps.length >= MAX_TRACE_STEPS) this.dropped++;
    else this.steps.push(step);
  }

  /** One model call finished. */
  turn(info: { model: string | null; provider: string | null; stopReason: string; inputTokens: number; outputTokens: number }): void {
    this.turns++;
    this.model = info.model;
    this.effort = info.provider === 'vercel-gateway' && info.model ? gatewayReasoningParams(info.model).reasoning?.effort ?? null : null;
    this.inputTokens += info.inputTokens;
    this.outputTokens += info.outputTokens;
    this.push({ k: 'turn', n: this.turns, stop: info.stopReason, in: info.inputTokens, out: info.outputTokens });
  }

  /** The model asked for these tools; their results arrive with the next turn. */
  toolCalls(calls: NeutralToolCall[]): void {
    for (const c of calls) {
      this.toolCount++;
      this.pending.set(c.id, c.name);
    }
  }

  /** The results the model was sent for earlier tool calls. Only names and verdicts are kept. */
  toolResults(results: Array<{ id: string; content: string }>): void {
    for (const r of results) {
      const name = this.pending.get(r.id);
      if (!name) continue;
      this.pending.delete(r.id);
      const failed = /^ERROR/.test(r.content);
      if (failed) this.toolErrors++;
      this.push({ k: 'tool', name, ok: !failed });
      // The agent reports a failed static check as "N errors to fix" (check_page) or
      // "NOT PUBLISHED: N errors to fix first" (publish_page).
      const found = /(\d+) errors? to fix/.exec(r.content);
      if ((name === TOOL.check || name === TOOL.publish) && found) this.checkRound(Number(found[1]));
    }
  }

  checkRound(errors: number): void {
    this.checkRounds++;
    this.push({ k: 'check', errors });
  }

  verify(status: string, errors: number): void {
    this.verifyStatus = status;
    this.push({ k: 'verify', status, errors });
  }

  publish(ok: boolean, draft: boolean): void {
    this.push({ k: 'publish', ok, draft });
  }

  note(text: string): void {
    this.push({ k: 'note', text: clip(text) ?? '' });
  }

  /** Write the trace. The first call wins; later ones (a caller closing a build the builder already closed) do nothing. Never throws. */
  async finish(outcome: BuildOutcome, extra: TraceFinish = {}): Promise<void> {
    if (this.done) return;
    this.done = true;
    // Calls that never got a result (the build ended on them) keep an unknown verdict.
    for (const name of this.pending.values()) this.push({ k: 'tool', name, ok: null });
    this.pending.clear();
    const finishedAt = new Date();
    try {
      let versionNo: number | null = null;
      if (extra.artifactId) {
        versionNo = (await this.env.DB.prepare('SELECT MAX(version_no) AS v FROM versions WHERE artifact_id = ?').bind(extra.artifactId).first<{ v: number | null }>())?.v ?? null;
      }
      await this.env.DB.prepare(
        `INSERT INTO page_build_traces
           (id, workspace_id, user_id, source, path, model, effort, outcome, artifact_id, version_no,
            turns, tool_calls, tool_errors, check_rounds, verify_status, input_tokens, output_tokens,
            error_code, error_message, steps_json, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        this.id, this.meter.workspaceId, this.meter.userId, this.meter.source ?? null, this.path, this.model, this.effort,
        outcome, extra.artifactId ?? null, versionNo,
        this.turns, this.toolCount, this.toolErrors, this.checkRounds, this.verifyStatus, this.inputTokens, this.outputTokens,
        clip(extra.errorCode, 80), clip(extra.errorMessage), capSteps(this.steps, this.dropped),
        this.startedAt.toISOString(), finishedAt.toISOString(),
      ).run();
    } catch (err) {
      createLogger(this.env, { scope: 'page_build', event: 'trace.write_failed' }).error('page build trace not recorded', { error: String(err) });
    }
  }
}

export function startBuildTrace(env: Env, meter: AiMeter, path: BuildPath): BuildTrace {
  return new BuildTrace(env, meter, path);
}

/**
 * The provider the agent loop talks to, with every turn reported to the trace: tokens and stop
 * reason per call, the tools asked for, and the results sent back on the next call.
 */
export function traceProvider(inner: CrewProvider, trace: BuildTrace): CrewProvider {
  return {
    get provider() { return inner.provider; },
    get model() { return inner.model; },
    async *streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent> {
      const last = args.transcript.at(-1);
      if (last?.role === 'tool') trace.toolResults(last.results);
      const calls: NeutralToolCall[] = [];
      for await (const ev of inner.streamTurn(args)) {
        if (ev.type === 'tool_use') calls.push({ id: ev.id, name: ev.name, input: {} });
        else if (ev.type === 'message_stop') {
          trace.turn({ model: inner.model, provider: inner.provider, stopReason: ev.stopReason, inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens });
        } else if (ev.type === 'error') {
          trace.note(`model error${ev.code ? ` (${ev.code})` : ''}: ${ev.error}`);
        }
        yield ev;
      }
      trace.toolCalls(calls);
    },
  };
}

/** Delete traces past retention. Called from the daily cleanup. */
export async function cleanupBuildTraces(env: Env): Promise<number> {
  const cut = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const res = await env.DB.prepare('DELETE FROM page_build_traces WHERE created_at < ?').bind(cut).run();
  return res.meta?.changes ?? 0;
}
