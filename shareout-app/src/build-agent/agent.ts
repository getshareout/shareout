/**
 * The page-build agent. The model writes the page as files through tools, runs the
 * static check, fixes what it reports, publishes, and (when the instance has a browser)
 * has the published page tested and fixes that too, each in bounded rounds. A page is
 * only ever reported done when it passed; anything else comes back as a give-up the
 * caller tells the user about. The loop itself (metered calls, budgets, cut-off replies,
 * context management) is the shared agent engine.
 */
import type { Env, FileEntry } from '../types';
import type { AiMeter } from '../data/ai-usage';
import { BUDGET_CODE } from '../data/ai-budget';
import { createLogger } from '../logging';
import { alertOps } from '../support/alert';
import type { CrewProvider, NativeHarness } from '../crew/provider';
import { newStats, runEngine, type StopStep, type ToolStep } from '../agent-runtime/engine';
import { DEFAULT_TRIM } from '../agent-runtime/transcript';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { AGENT_PROGRESS_COPY } from './copy';
import { PageFiles } from './page-files';
import { parseBuildEffort } from '../data/agent/models';
import type { WorkspaceBrief } from '../data/agent/workspace-brief';
import { readGuide } from './guide';
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
  /** The workspace's brand, language and house style, put in front of the model. */
  brief?: WorkspaceBrief | null;
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

const KEEP_RECENT_TURNS = DEFAULT_TRIM.keepRecent;
/** Direct-Anthropic harness: the server compacts and clears old tool use, the loop only sets the thresholds. */
const NATIVE: NativeHarness = {
  compactAtTokens: 100_000,
  clearToolUses: { triggerTokens: 60_000, keep: KEEP_RECENT_TURNS, clearInputs: true },
  taskBudgetTokens: 120_000,
};

/** Moved to the agent engine; re-exported for existing callers. */
export { trimTranscript } from '../agent-runtime/transcript';

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
  const system = buildAgentSystemPrompt(deps.env, deps.brief);
  const files = PageFiles.from(input.previousFiles ?? []);
  const stats = newStats();

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

  const runTool = async (call: { name: string; input: Record<string, unknown> }): Promise<ToolStep<BuildAgentResult>> => {
    if (call.name === TOOL.check) {
      progress(copy.checking);
      const round = staticRound();
      if (round.errors) {
        progress(copy.fixing(round.errors));
        if (round.exhausted) return { end: await giveUp('check_failed', `${round.errors} static errors after ${checkFails} rounds:\n${round.text}`) };
      }
      return { content: round.errors ? `${round.errors} error${round.errors === 1 ? '' : 's'} to fix:\n${round.text}` : `No errors.${round.text ? `\nWarnings (fix if cheap):\n${round.text}` : ''}` };
    }
    if (call.name === TOOL.publish) {
      const res = await publishRound();
      if (typeof res === 'string') return { content: res };
      return res.ok ? { content: 'Published.', finish: res } : { end: res };
    }
    const reply = call.name === TOOL.guide ? readGuide(deps.env, call.input) : runFileTool(files, call.name, call.input);
    if (!reply) return { content: `ERROR: unknown tool "${call.name}". Tools: ${BUILD_TOOLS.map((x) => x.name).join(', ')}.` };
    if (!reply.isError && reply.path) progress(call.name === TOOL.edit ? copy.editing(reply.path) : copy.writing(reply.path));
    return { content: reply.isError ? `ERROR ${reply.content}` : reply.content };
  };

  const onStop = async (): Promise<StopStep<BuildAgentResult>> => {
    if (++nudges > limits.nudges) return { end: await giveUp('no_publish', 'the model stopped without publishing') };
    return { nudge: `You have not published the page yet. Write the files, run ${TOOL.check}, then call ${TOOL.publish}.` };
  };

  progress(copy.planning);
  const run = await runEngine<BuildAgentResult>({
    provider: deps.provider,
    meter: deps.meter,
    system,
    transcript: [{ role: 'user', text: initialMessage(input) }],
    tools: BUILD_TOOLS,
    limits,
    native: NATIVE,
    turnArgs: { effort: parseBuildEffort(deps.env.BUILD_EFFORT) },
    stats,
    runTool,
    onStop,
    cutOff: {
      reply: `Your reply was cut off at the length limit. Use the tools in smaller pieces: ${TOOL.write} the first part of a file, then ${TOOL.append} the rest.`,
      invalidCall: (call) => `ERROR: this ${call.name} call was cut off or was not valid JSON, so it did nothing. Send it again in smaller pieces: ${TOOL.write} the first part of the file, then ${TOOL.append} the rest.`,
      note: '\n(Your last reply hit the length limit: keep each tool call smaller.)',
    },
    skipped: 'Skipped: the page is already published.',
  });

  if (run.kind === 'end') return run.result;
  if (run.kind === 'error') {
    if (run.error.code === BUDGET_CODE) return { ok: false, reason: 'budget', detail: run.error.error };
    await reportGiveUp(deps, input, 'model error', run.error.error);
    return { ok: false, reason: 'provider_error', detail: run.error.error };
  }
  switch (run.limit) {
    case 'time': return giveUp('time', `over ${Math.round(limits.wallMs / 1000)}s`);
    case 'tokens': return giveUp('tokens', `${stats.outputTokens} output tokens`);
    default: return giveUp('turns', `${limits.maxTurns} model calls without a passing page`);
  }
}
