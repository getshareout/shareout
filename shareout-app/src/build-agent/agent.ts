/**
 * The page-build agent loop. The model writes the page as files through tools, runs the
 * static check, fixes what it reports, publishes, and (when the instance has a browser)
 * has the published page tested and fixes that too, each in bounded rounds. A page is
 * only ever reported done when it passed; anything else comes back as a give-up the
 * caller tells the user about. Every model turn goes through the metered crew provider.
 */
import type { Env, FileEntry } from '../types';
import type { AiMeter } from '../data/ai-usage';
import { BUDGET_CODE } from '../data/ai-budget';
import { createLogger } from '../logging';
import { alertOps } from '../support/alert';
import type { CrewProvider, NativeHarness, NeutralToolCall, NeutralTurn, ProviderEvent } from '../crew/provider';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { AGENT_PROGRESS_COPY } from './copy';
import { PageFiles } from './page-files';
import { buildAgentSystemPrompt } from './prompt';
import { checkPage, errorsOf, formatIssues } from './static-check';
import { BUILD_TOOLS, TOOL, runFileTool } from './tools';

export interface BuildAgentLimits {
  /** Model calls in one build. */
  maxTurns: number;
  wallMs: number;
  /** Output tokens summed over every call. */
  maxOutputTokens: number;
  /** max_tokens of one call: small on purpose, so a file is written in steps. */
  turnTokens: number;
  /** Failed static checks (check_page or a refused publish) before giving up. */
  checkRounds: number;
  /** Failed tests of the published page before giving up. */
  verifyRounds: number;
  /** Times the model may stop without publishing before giving up. */
  nudges: number;
}

export const DEFAULT_BUILD_LIMITS: BuildAgentLimits = {
  maxTurns: 40,
  wallMs: 8 * 60_000,
  maxOutputTokens: 160_000,
  turnTokens: 12_000,
  checkRounds: 5,
  verifyRounds: 2,
  nudges: 2,
};

export interface PublishedPage {
  url: string;
  slug: string;
  artifactId: string;
  /** Whatever the integration needs back (visibility, moderation, …). */
  extra?: unknown;
}

export type PublishOutcome = { ok: true; page: PublishedPage } | { ok: false; error: string; code?: string };

/** A tested page: what the model gets to fix. */
export interface TestReport {
  status: 'pass' | 'warn' | 'fail' | 'partial';
  errors: number;
  /** The findings, as text the model reads. */
  text: string;
}

export interface BuildAgentDeps {
  env: Env;
  provider: CrewProvider;
  /** kind page_build; every model turn is recorded under it. */
  meter: AiMeter;
  locale: Locale;
  isPublic: boolean;
  /**
   * Publish the files. `draft`: keep it private until it has been tested (the agent publishes
   * it again, same files, as `draft: false` once it passed). `slug`: the page published so far.
   */
  publish(files: FileEntry[], opts: { draft: boolean; slug?: string }): Promise<PublishOutcome>;
  /** Test the published page. Absent when the instance has no browser: the page is then published once, on its static check. */
  verify?(page: PublishedPage): Promise<TestReport | null>;
  onProgress?(label: string): void;
  limits?: Partial<BuildAgentLimits>;
}

export type GiveUpReason = 'check_failed' | 'verify_failed' | 'no_publish' | 'turns' | 'time' | 'tokens';

export type BuildAgentResult =
  | { ok: true; page: PublishedPage; files: FileEntry[]; tested: boolean }
  | { ok: false; reason: GiveUpReason; detail: string; /** A private draft left behind by a failed test. */ draft?: PublishedPage }
  | { ok: false; reason: 'provider_error'; detail: string }
  | { ok: false; reason: 'budget'; detail: string }
  | { ok: false; reason: 'publish_failed'; detail: string; code?: string };

export interface BuildAgentInput {
  prompt: string;
  /** An existing page to change instead of starting over. */
  previousFiles?: Array<{ path: string; content: string; mime?: string }>;
}

const KEEP_RECENT_TURNS = 8;
const TRIM_AT_CHARS = 120_000;
/** Direct-Anthropic harness: the server compacts and clears old tool use, the loop only sets the thresholds. */
const NATIVE: NativeHarness = {
  compactAtTokens: 100_000,
  clearToolUses: { triggerTokens: 60_000, keep: KEEP_RECENT_TURNS, clearInputs: true },
  taskBudgetTokens: 120_000,
};

const weight = (turn: NeutralTurn): number =>
  turn.role === 'user' ? turn.text.length
    : turn.role === 'assistant' ? turn.text.length + JSON.stringify(turn.toolCalls).length
      : turn.results.reduce((n, r) => n + r.content.length, 0);

/**
 * Provider-neutral stand-in for the Anthropic harness's context editing: once the transcript
 * is big, older file contents and tool results are replaced by a stub (the model can read_file
 * again). The first message and the newest turns stay as they are.
 */
export function trimTranscript(transcript: NeutralTurn[]): NeutralTurn[] {
  if (transcript.reduce((n, turn) => n + weight(turn), 0) < TRIM_AT_CHARS) return transcript;
  const assistantIdx = transcript.flatMap((turn, i) => (turn.role === 'assistant' ? [i] : []));
  const cut = assistantIdx[assistantIdx.length - KEEP_RECENT_TURNS];
  if (cut === undefined) return transcript;
  return transcript.map((turn, i) => {
    if (i === 0 || i >= cut) return turn;
    if (turn.role === 'assistant') {
      return {
        ...turn,
        toolCalls: turn.toolCalls.map((tc) =>
          typeof tc.input.content === 'string' && tc.input.content.length > 300
            ? { ...tc, input: { ...tc.input, content: `[${tc.input.content.length} chars written; read_file to see them]` } }
            : typeof tc.input.old === 'string' && tc.input.old.length + String(tc.input.new ?? '').length > 600
              ? { ...tc, input: { ...tc.input, old: '[trimmed]', new: '[trimmed]' } }
              : tc),
      };
    }
    if (turn.role === 'tool') return { ...turn, results: turn.results.map((r) => (r.content.length > 200 ? { ...r, content: `${r.content.slice(0, 120)}… [trimmed]` } : r)) };
    return turn;
  });
}

interface TurnOutcome {
  text: string;
  toolCalls: NeutralToolCall[];
  compaction?: string;
  stopReason: string;
  outputTokens: number;
  error?: Extract<ProviderEvent, { type: 'error' }>;
}

async function takeTurn(deps: BuildAgentDeps, system: string, transcript: NeutralTurn[], maxTokens: number): Promise<TurnOutcome> {
  const out: TurnOutcome = { text: '', toolCalls: [], stopReason: 'end_turn', outputTokens: 0 };
  for await (const ev of deps.provider.streamTurn({ system, transcript, tools: BUILD_TOOLS, maxTokens, meter: deps.meter, native: NATIVE })) {
    if (ev.type === 'text_delta') out.text += ev.text;
    else if (ev.type === 'compaction') out.compaction = ev.content;
    else if (ev.type === 'tool_use') out.toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
    else if (ev.type === 'message_stop') {
      out.stopReason = ev.stopReason;
      out.outputTokens = ev.usage.outputTokens;
    } else if (ev.type === 'error') {
      out.error = ev;
      return out;
    }
  }
  return out;
}

function initialMessage(input: BuildAgentInput): string {
  if (!input.previousFiles?.length) return input.prompt;
  return `${input.prompt}\n\nThe page already exists with these files: ${input.previousFiles.map((f) => f.path).join(', ')}. Read what you need and edit it.`;
}

/** Tells the operator a build was given up: the user's own words, who, why. Never throws. */
async function reportGiveUp(deps: BuildAgentDeps, input: BuildAgentInput, reason: string, detail: string): Promise<void> {
  const { env, meter } = deps;
  createLogger(env, { scope: 'page_build', event: 'agent.gave_up' }).warn('page build agent gave up', {
    workspaceId: meter.workspaceId, userId: meter.userId, source: meter.source, reason, detail,
  });
  await alertOps(env, `⚠️ Page build agent gave up: ${reason}`, [
    `From: ${meter.userId ?? 'anonymous'} · workspace ${meter.workspaceId ?? '—'} · via ${meter.source ?? 'build'}`,
    `Detail: ${detail.slice(0, 600)}`,
    `Asked for: ${input.prompt.slice(0, 200)}${input.prompt.length > 200 ? '…' : ''}`,
  ]);
}

export async function runBuildAgent(deps: BuildAgentDeps, input: BuildAgentInput): Promise<BuildAgentResult> {
  const limits = { ...DEFAULT_BUILD_LIMITS, ...deps.limits };
  const copy = t(deps.locale, AGENT_PROGRESS_COPY);
  const progress = (label: string) => deps.onProgress?.(label);
  const system = buildAgentSystemPrompt(deps.env);
  const files = PageFiles.from(input.previousFiles ?? []);
  const startedAt = Date.now();

  let transcript: NeutralTurn[] = [{ role: 'user', text: initialMessage(input) }];
  let outputTokens = 0;
  let checkFails = 0;
  let verifyFails = 0;
  let nudges = 0;
  let draft: PublishedPage | undefined;

  const giveUp = async (reason: GiveUpReason, detail: string): Promise<BuildAgentResult> => {
    await reportGiveUp(deps, input, reason, detail);
    return { ok: false, reason, detail, ...(draft ? { draft } : {}) };
  };

  /** The static check as the model sees it; counts a failed round. Returns null when the round limit is hit. */
  const staticRound = (): { text: string; errors: number; exhausted: boolean } => {
    const issues = checkPage(files, { env: deps.env, isPublic: deps.isPublic });
    const errors = errorsOf(issues);
    if (errors.length) checkFails++;
    return { text: formatIssues(issues), errors: errors.length, exhausted: checkFails > limits.checkRounds };
  };

  /** Publish publish_page's way. A string is a tool result to hand back; an object ends the build. */
  const publishRound = async (): Promise<string | BuildAgentResult> => {
    const gate = staticRound();
    if (gate.errors) {
      progress(copy.fixing(gate.errors));
      if (gate.exhausted) return giveUp('check_failed', `${gate.errors} static errors after ${checkFails} rounds:\n${gate.text}`);
      return `NOT PUBLISHED: ${gate.errors} error${gate.errors === 1 ? '' : 's'} to fix first.\n${gate.text}`;
    }
    const testing = !!deps.verify;
    progress(copy.publishing);
    const outcome = await deps.publish(files.toFileEntries(), { draft: testing, slug: draft?.slug });
    if (!outcome.ok) return { ok: false, reason: 'publish_failed', detail: outcome.error, code: outcome.code };
    let page = outcome.page;
    if (!testing) return { ok: true, page, files: files.toFileEntries(), tested: false };

    progress(copy.testing);
    draft = page;
    const report = await deps.verify!(page).catch((): null => null);
    if (report && report.status === 'fail') {
      verifyFails++;
      if (verifyFails > limits.verifyRounds) {
        return giveUp('verify_failed', `still failing after ${verifyFails} tests:\n${report.text}`);
      }
      progress(copy.fixingLive(report.errors));
      return `PUBLISHED AS A PRIVATE DRAFT, but testing the page found ${report.errors} error${report.errors === 1 ? '' : 's'}. Fix them with ${TOOL.edit}, then call ${TOOL.publish} again.\n${report.text}`;
    }
    // Passed (or no usable test result): make it live as asked, same files.
    progress(copy.finishing);
    const live = await deps.publish(files.toFileEntries(), { draft: false, slug: page.slug });
    if (!live.ok) return { ok: false, reason: 'publish_failed', detail: live.error, code: live.code };
    page = live.page;
    return { ok: true, page, files: files.toFileEntries(), tested: !!report && report.status !== 'partial' };
  };

  progress(copy.planning);
  for (let turn = 0; turn < limits.maxTurns; turn++) {
    if (Date.now() - startedAt > limits.wallMs) return giveUp('time', `over ${Math.round(limits.wallMs / 1000)}s`);
    if (outputTokens > limits.maxOutputTokens) return giveUp('tokens', `${outputTokens} output tokens`);

    // On the direct Anthropic route the server edits the context; everywhere else we do.
    if (deps.provider.provider !== 'anthropic') transcript = trimTranscript(transcript);
    const r = await takeTurn(deps, system, transcript, limits.turnTokens);
    if (r.error) {
      if (r.error.code === BUDGET_CODE) return { ok: false, reason: 'budget', detail: r.error.error };
      await reportGiveUp(deps, input, 'model error', r.error.error);
      return { ok: false, reason: 'provider_error', detail: r.error.error };
    }
    outputTokens += r.outputTokens;
    transcript = [...transcript, { role: 'assistant', text: r.text, toolCalls: r.toolCalls, ...(r.compaction ? { compaction: r.compaction } : {}) }];

    if (!r.toolCalls.length) {
      if (r.stopReason === 'max_tokens') {
        transcript.push({ role: 'user', text: `Your reply was cut off at the length limit. Use the tools in smaller pieces: ${TOOL.write} the first part of a file, then ${TOOL.append} the rest.` });
        continue;
      }
      if (++nudges > limits.nudges) return giveUp('no_publish', 'the model stopped without publishing');
      transcript.push({ role: 'user', text: `You have not published the page yet. Write the files, run ${TOOL.check}, then call ${TOOL.publish}.` });
      continue;
    }

    const results: Array<{ id: string; content: string }> = [];
    let finished: BuildAgentResult | null = null;
    for (const call of r.toolCalls) {
      if (finished) {
        results.push({ id: call.id, content: 'Skipped: the page is already published.' });
        continue;
      }
      if (typeof call.input.__invalid_json === 'string') {
        results.push({
          id: call.id,
          content: `ERROR: this ${call.name} call was cut off or was not valid JSON, so it did nothing. Send it again in smaller pieces: ${TOOL.write} the first part of the file, then ${TOOL.append} the rest.`,
        });
        continue;
      }
      if (call.name === TOOL.check) {
        progress(copy.checking);
        const round = staticRound();
        if (round.errors) {
          progress(copy.fixing(round.errors));
          if (round.exhausted) return giveUp('check_failed', `${round.errors} static errors after ${checkFails} rounds:\n${round.text}`);
        }
        results.push({ id: call.id, content: round.errors ? `${round.errors} error${round.errors === 1 ? '' : 's'} to fix:\n${round.text}` : `No errors.${round.text ? `\nWarnings (fix if cheap):\n${round.text}` : ''}` });
      } else if (call.name === TOOL.publish) {
        const res = await publishRound();
        if (typeof res === 'string') results.push({ id: call.id, content: res });
        else if (res.ok) {
          finished = res;
          results.push({ id: call.id, content: 'Published.' });
        } else return res;
      } else {
        const reply = runFileTool(files, call.name, call.input);
        if (!reply) results.push({ id: call.id, content: `ERROR: unknown tool "${call.name}". Tools: ${BUILD_TOOLS.map((x) => x.name).join(', ')}.` });
        else {
          if (!reply.isError && reply.path) progress(call.name === TOOL.edit ? copy.editing(reply.path) : copy.writing(reply.path));
          results.push({ id: call.id, content: reply.isError ? `ERROR ${reply.content}` : reply.content });
        }
      }
    }
    if (finished) return finished;
    if (r.stopReason === 'max_tokens' && results.length) results[results.length - 1].content += '\n(Your last reply hit the length limit: keep each tool call smaller.)';
    transcript = [...transcript, { role: 'tool', results }];
  }
  return giveUp('turns', `${limits.maxTurns} model calls without a passing page`);
}
