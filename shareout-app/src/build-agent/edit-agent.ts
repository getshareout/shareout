/**
 * The page editor behind the assistant's edit_page: changes an existing page in pieces with
 * the build agent's file tools (the op semantics of POST /v1/artifacts/{id}/edits), checks
 * the result, and hands back the changed files. It never publishes: the caller stages them
 * as a pending edit the user confirms. Runs on the shared agent engine, so a big change is
 * many small tool calls instead of one reply that has to fit in a single completion.
 *
 * The check blocks only what the change made worse: problems the page already had stay the
 * owner's business, not a reason to refuse an unrelated edit.
 */
import type { Env } from '../types';
import type { AiMeter } from '../data/ai-usage';
import { BUDGET_CODE } from '../data/ai-budget';
import type { CrewProvider, NativeHarness, ProviderTool } from '../crew/provider';
import { newStats, runEngine, type EngineLimits, type StopStep, type ToolStep } from '../agent-runtime/engine';
import { createLogger } from '../logging';
import { rewriteSkillOrigin } from '../skill-origin';
import { SDK_REFERENCE } from '../data/agent/sdk-reference.generated';
import { CAPABILITIES_PROMPT } from '../data/agent/build-page';
import { agentLanguageRule } from '../i18n/agent-language';
import { t, type Locale } from '../i18n';
import { AGENT_PROGRESS_COPY } from './copy';
import { PageFiles } from './page-files';
import { checkPage, errorsOf, formatIssues, type CheckIssue } from './static-check';
import { BUILD_TOOLS, TOOL, runFileTool } from './tools';

export const PROPOSE_TOOL = 'propose_edit';

export interface EditAgentLimits extends EngineLimits {
  /** Refused checks (check_page or propose_edit) before giving up. */
  checkRounds: number;
  /** Times the model may stop with changes it has not proposed. */
  nudges: number;
}

export const DEFAULT_EDIT_LIMITS: EditAgentLimits = {
  maxTurns: 30,
  wallMs: 4 * 60_000,
  maxOutputTokens: 100_000,
  turnTokens: 12_000,
  checkRounds: 3,
  nudges: 1,
};

/** Direct Anthropic: same thresholds as a build. */
const NATIVE: NativeHarness = {
  compactAtTokens: 100_000,
  clearToolUses: { triggerTokens: 60_000, keep: 8, clearInputs: true },
};

export interface EditAgentDeps {
  env: Env;
  provider: CrewProvider;
  /** Every model call is metered under it (kind artifact_ai_edit). */
  meter: AiMeter;
  /** The summary is written in this language. */
  locale: Locale;
  isPublic: boolean;
  onProgress?(label: string): void;
  limits?: Partial<EditAgentLimits>;
}

export interface EditAgentInput {
  instruction: string;
  /** The page's main file. */
  entrypoint: string;
  /** Its text files, as they are now. Only these can change. */
  files: Array<{ path: string; content: string; mime: string }>;
  /** Files that exist but cannot be edited here (images, fonts, very large files). */
  readOnly: Array<{ path: string; mime: string }>;
  /** The folder's guide, when the page lives in a folder that has one. */
  guide?: string | null;
}

export interface ChangedFile {
  path: string;
  mime: string;
  before: string;
  after: string;
}

export type EditGiveUp = 'check_failed' | 'no_proposal' | 'turns' | 'time' | 'tokens';

export type EditAgentResult =
  /** `changed` empty: the model answered (a question, a refusal, nothing to do) instead of editing. */
  | { ok: true; changed: ChangedFile[]; summary: string; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; reason: EditGiveUp | 'provider_error' | 'budget'; detail: string; usage: { inputTokens: number; outputTokens: number } };

const FILE_TOOLS = new Set<string>([TOOL.write, TOOL.append, TOOL.edit, TOOL.read, TOOL.list, TOOL.check]);

const EDIT_TOOLS: ProviderTool[] = [
  ...BUILD_TOOLS.filter((tool) => FILE_TOOLS.has(tool.name)),
  {
    name: PROPOSE_TOOL,
    description: 'Hand the change back to the user to confirm (nothing is published until they do). It re-runs the checks first and refuses while your change leaves errors. You are done when it accepts.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'One or two sentences for the user: what you changed, in plain words.' } },
      required: ['summary'],
    },
  },
];

const CONTRACT = `You are ShareOut's page editor. You change an existing, published page exactly as the user asked, working on its FILES with tools, then hand the change back for the user to confirm. Nothing goes live until they do.

How to work:
1. Find what to change: ${TOOL.list}, then ${TOOL.read} only the sections you need (at most 150 lines per call; pass start_line/end_line). Never paste file contents into your text.
2. Change it with ${TOOL.edit}: copy \`old\` exactly from the file so it matches once. Prefer several small edits to one big one, and keep every tool call under about 5000 tokens. Rewrite a whole file (${TOOL.write}, then ${TOOL.append} for the rest) only when most of it changes.
3. Change only what was asked; keep the rest of the page (structure, style, data, wording) as it is. You can change the page's existing text files only: no new files, no deletions, no images.
4. When the change is complete, run ${TOOL.check} and fix every error your change caused. Problems the page already had are listed separately: leave them unless the user asked.
5. Call ${PROPOSE_TOOL} with a one or two sentence summary for the user. It re-checks and refuses while your change leaves errors.
If the request is unclear, impossible, or needs no change, edit nothing and answer in one or two sentences instead; that ends the task.

Page rules:
- References between the page's own files stay RELATIVE ("styles.css", "./app.js"), never "/styles.css". Only /sdk/, /vendor/ and /lib/ are root-relative.
- Third-party libraries load from /vendor/<npm package>@<version>/<file>, never a public CDN. Never use localStorage, sessionStorage, alert, confirm or prompt: viewers run the page sandboxed.
- A table used with sdk.table(name) must be declared in the <script type="shareout/manifest"> JSON block of the main file. Keep that block valid JSON.
`;

let cachedReference: string | null = null;

function systemPrompt(deps: EditAgentDeps, input: EditAgentInput): string {
  if (!cachedReference) cachedReference = rewriteSkillOrigin(`${CAPABILITIES_PROMPT}\n${SDK_REFERENCE}`, deps.env);
  return [
    CONTRACT,
    `The page's main file is ${input.entrypoint}.`,
    agentLanguageRule(deps.locale),
    ...(input.guide ? [`The page lives in a folder whose guide sets these conventions; follow them:\n${input.guide}`] : []),
    cachedReference,
  ].join('\n\n');
}

/** An issue's identity across edits: line numbers and counts move, the problem does not. */
const issueKey = (i: CheckIssue) => `${i.rule}|${i.message.replace(/\d+/g, '#')}|${(i.where ?? '').replace(/:\d+/g, '')}`;

/** The errors in `now` the page did not already have (as a multiset: a second copy of an old error is new). */
function newErrors(baseline: CheckIssue[], now: CheckIssue[]): { added: CheckIssue[]; preexisting: CheckIssue[] } {
  const left = new Map<string, number>();
  for (const i of errorsOf(baseline)) left.set(issueKey(i), (left.get(issueKey(i)) ?? 0) + 1);
  const added: CheckIssue[] = [];
  const preexisting: CheckIssue[] = [];
  for (const i of errorsOf(now)) {
    const n = left.get(issueKey(i)) ?? 0;
    if (n > 0) {
      left.set(issueKey(i), n - 1);
      preexisting.push(i);
    } else added.push(i);
  }
  return { added, preexisting };
}

export async function runEditAgent(deps: EditAgentDeps, input: EditAgentInput): Promise<EditAgentResult> {
  const limits = { ...DEFAULT_EDIT_LIMITS, ...deps.limits };
  const copy = t(deps.locale, AGENT_PROGRESS_COPY);
  const progress = (label: string) => deps.onProgress?.(label);
  const editable = new Map(input.files.map((f) => [f.path, f]));
  const readOnly = new Map(input.readOnly.map((f) => [f.path, f.mime]));
  // Read-only files sit in the set as empty placeholders so references to them resolve in the check.
  const files = PageFiles.from([...input.files, ...input.readOnly.map((f) => ({ path: f.path, content: '', mime: f.mime }))]);
  const check = () => checkPage(files, { env: deps.env, isPublic: deps.isPublic, entrypoint: input.entrypoint });
  const baseline = check();
  const stats = newStats();
  const usage = () => ({ inputTokens: stats.inputTokens, outputTokens: stats.outputTokens });
  let checkFails = 0;
  let nudges = 0;

  const changed = (): ChangedFile[] => [...editable.values()].flatMap((f) => {
    const after = files.text(f.path);
    return after !== undefined && after !== f.content ? [{ path: f.path, mime: f.mime, before: f.content, after }] : [];
  });

  const giveUp = (reason: EditGiveUp, detail: string): EditAgentResult => {
    createLogger(deps.env, { scope: 'page_edit', event: 'edit_agent.gave_up' }).warn('page edit agent gave up', {
      workspaceId: deps.meter.workspaceId, userId: deps.meter.userId, source: deps.meter.source, reason, detail: detail.slice(0, 600),
    });
    return { ok: false, reason, detail, usage: usage() };
  };

  /** The check as the model reads it; counts a refused round. */
  const checkRound = () => {
    const now = check();
    const { added, preexisting } = newErrors(baseline, now);
    if (added.length) checkFails++;
    const warnings = now.filter((i) => i.severity !== 'error');
    const text = [
      added.length ? `${added.length} error${added.length === 1 ? '' : 's'} your change caused, to fix:\n${formatIssues(added)}` : 'Your change caused no errors.',
      ...(preexisting.length ? [`Already on the page before your change (leave unless asked):\n${formatIssues(preexisting)}`] : []),
      ...(warnings.length ? [`Warnings (fix if your change caused them):\n${formatIssues(warnings)}`] : []),
    ].join('\n');
    return { errors: added.length, text, exhausted: checkFails > limits.checkRounds };
  };

  const runTool = async (call: { name: string; input: Record<string, unknown> }): Promise<ToolStep<EditAgentResult>> => {
    const path = typeof call.input.path === 'string' ? call.input.path : '';
    if (call.name === TOOL.check || call.name === PROPOSE_TOOL) {
      progress(copy.checking);
      const round = checkRound();
      if (round.errors) {
        progress(copy.fixing(round.errors));
        if (round.exhausted) return { end: giveUp('check_failed', `${round.errors} errors after ${checkFails} rounds:\n${round.text}`) };
        return { content: call.name === PROPOSE_TOOL ? `NOT PROPOSED: ${round.text}` : round.text };
      }
      if (call.name === TOOL.check) return { content: round.text };
      const summary = typeof call.input.summary === 'string' ? call.input.summary.trim() : '';
      return { content: 'Proposed.', finish: { ok: true, changed: changed(), summary, usage: usage() } };
    }
    if (call.name === TOOL.list) {
      const rows = files.entries().map((f) => (readOnly.has(f.path) ? `${f.path}  (${f.mime}, read-only)` : `${f.path}  ${f.text.length} chars`));
      return { content: rows.join('\n') || 'No files.' };
    }
    if (readOnly.has(path)) return { content: `ERROR NOT_EDITABLE: "${path}" (${readOnly.get(path)}) cannot be read or changed here. Leave it as it is.` };
    if ((call.name === TOOL.write || call.name === TOOL.append) && path && !editable.has(path)) {
      return { content: `ERROR NO_NEW_FILES: "${path}" is not one of the page's files, and this edit can only change existing ones: ${[...editable.keys()].join(', ')}. Put the new code in one of them.` };
    }
    if (!FILE_TOOLS.has(call.name)) return { content: `ERROR: unknown tool "${call.name}". Tools: ${EDIT_TOOLS.map((x) => x.name).join(', ')}.` };
    const reply = runFileTool(files, call.name, call.input);
    if (!reply) return { content: `ERROR: unknown tool "${call.name}".` };
    if (!reply.isError && reply.path && call.name !== TOOL.read) progress(call.name === TOOL.edit ? copy.editing(reply.path) : copy.writing(reply.path));
    return { content: reply.isError ? `ERROR ${reply.content}` : reply.content };
  };

  const onStop = (turn: { text: string }): StopStep<EditAgentResult> => {
    // Nothing touched: the reply is the answer (a question, a refusal, nothing to do).
    if (!changed().length) return { end: { ok: true, changed: [], summary: turn.text.trim(), usage: usage() } };
    if (++nudges > limits.nudges) return { end: giveUp('no_proposal', 'the model stopped with changes it did not propose') };
    return { nudge: `You changed files but did not propose the change. Run ${TOOL.check}, fix what your change caused, then call ${PROPOSE_TOOL}.` };
  };

  const run = await runEngine<EditAgentResult>({
    provider: deps.provider,
    meter: deps.meter,
    system: systemPrompt(deps, input),
    transcript: [{ role: 'user', text: input.instruction }],
    tools: EDIT_TOOLS,
    limits,
    native: NATIVE,
    stats,
    runTool,
    onStop,
    cutOff: {
      reply: `Your reply was cut off at the length limit. Make the change in smaller pieces: several ${TOOL.edit} calls, each under about 5000 tokens.`,
      invalidCall: (call) => `ERROR: this ${call.name} call was cut off or was not valid JSON, so it did nothing. Send it again in smaller pieces.`,
      note: '\n(Your last reply hit the length limit: keep each tool call smaller.)',
    },
    skipped: 'Skipped: the change was already proposed.',
  });

  if (run.kind === 'end') return run.result;
  if (run.kind === 'error') {
    if (run.error.code === BUDGET_CODE) return { ok: false, reason: 'budget', detail: run.error.error, usage: usage() };
    return { ok: false, reason: 'provider_error', detail: run.error.error, usage: usage() };
  }
  switch (run.limit) {
    case 'time': return giveUp('time', `over ${Math.round(limits.wallMs / 1000)}s`);
    case 'tokens': return giveUp('tokens', `${stats.outputTokens} output tokens`);
    default: return giveUp('turns', `${limits.maxTurns} model calls without a proposed change`);
  }
}
