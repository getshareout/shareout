/**
 * Runs the eval set against one instance through its public API: ask the workspace
 * assistant for the page, confirm the build it proposes, read the published files back,
 * score them. No model is called from here; the instance spends its own AI budget.
 */
import type { EvalClient } from './client';
import { aggregate } from './report';
import { runPassed, scoreExpectations, scoreStatic, scoreVerify } from './scorers';
import { EVAL_SET, SET_VERSION } from './set';
import type { EvalItem, EvalResults, RunRecord, Usage } from './types';

/** Every page the eval creates carries this tag, so a stray one is easy to find and delete. */
export const EVAL_TAG = 'eval-page-build';

export interface RunOptions {
  client: EvalClient;
  origin: string;
  workspace: string;
  items?: EvalItem[];
  repeat?: number;
  /** Run the browser verify on each page (needs a browser on the instance). Default true. */
  verify?: boolean;
  /** Delete every created page when done. */
  cleanup?: boolean;
  log?: (line: string) => void;
  now?: () => number;
}

const delta = (a: Usage | null, b: Usage | null): Usage | null =>
  a && b ? { tokens: Math.max(0, b.tokens - a.tokens), costUsd: Math.max(0, +(b.costUsd - a.costUsd).toFixed(6)) } : null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The set, optionally narrowed to `ids`; an unknown id is an error, not a silent skip. */
export function selectItems(ids: string[] | undefined, set: EvalItem[] = EVAL_SET): EvalItem[] {
  if (!ids?.length) return set;
  const unknown = ids.filter((id) => !set.some((i) => i.id === id));
  if (unknown.length) throw new Error(`Unknown eval item(s): ${unknown.join(', ')}`);
  return set.filter((i) => ids.includes(i.id));
}

async function runOne(opts: RunOptions & { items: EvalItem[] }, item: EvalItem, run: number, created: string[]): Promise<RunRecord> {
  const { client, workspace, log = () => {}, now = Date.now } = opts;
  const started = now();
  const rec: RunRecord = { itemId: item.id, run, built: false, wallMs: 0, steps: [], static: null, verify: null, checks: [], usage: null, passed: false };
  const fail = (error: string) => { rec.error = error; };

  try {
    let seedId: string | undefined;
    if (item.kind === 'edit') {
      const seeded = await client.publish(workspace, `[eval] seed ${item.id}`, item.seed ?? []);
      seedId = seeded.artifactId;
      created.push(seedId);
      await client.tag(seedId, EVAL_TAG).catch(() => {});
    }

    const before = await client.usageTotals(workspace);
    const text = seedId ? `${item.prompt}\n\n(Page id: ${seedId})` : item.prompt;
    const chat = await client.chat(workspace, text);
    if (chat.error) fail(`assistant error: ${chat.error}`);
    else if (!chat.confirm) fail(`the assistant proposed no ${item.kind === 'edit' ? 'edit' : 'build'}: ${chat.text.slice(0, 200)}`);
    else {
      const done = await client.confirm(workspace, chat.confirm.token);
      rec.steps = done.steps;
      rec.buildText = done.text.slice(0, 500);
      const artifactId = item.kind === 'edit' ? seedId : done.artifactId;
      if (item.kind === 'build' && done.artifactId) {
        created.push(done.artifactId);
        await client.tag(done.artifactId, EVAL_TAG).catch(() => {});
      }
      if (!done.ok || !artifactId) fail(`the build did not finish: ${done.text.slice(0, 200)}`);
      else {
        const page = await client.files(artifactId);
        rec.artifactId = artifactId;
        rec.version = page.versionNo;
        const unchanged = item.kind === 'edit' && JSON.stringify(page.files.map((f) => [f.path, f.content])) === JSON.stringify((item.seed ?? []).map((f) => [f.path, f.content]));
        if (unchanged) fail('the edit left the page unchanged');
        else {
          rec.built = true;
          rec.static = scoreStatic(page.files);
          rec.checks = scoreExpectations(page.files, item.expect);
          if (opts.verify === false) rec.verifyNote = 'skipped (--no-verify)';
          else {
            try {
              rec.verify = scoreVerify(await client.verify(artifactId, page.versionNo));
              if (!rec.verify) rec.verifyNote = 'unreadable verify response';
              else if (rec.verify.status === 'partial') rec.verifyNote = 'partial: the instance could not render the page (no browser?)';
            } catch (e) {
              rec.verifyNote = `verify failed: ${message(e)}`;
            }
          }
        }
      }
    }
    rec.usage = delta(before, await client.usageTotals(workspace));
  } catch (e) {
    fail(message(e));
  }

  rec.wallMs = now() - started;
  // A partial verify never ran a browser: it neither passes nor fails the page.
  const verifyForPass = rec.verify?.status === 'partial' ? null : rec.verify;
  rec.passed = runPassed(rec.built, rec.static, verifyForPass, rec.checks);
  log(`${rec.passed ? 'PASS' : 'FAIL'} ${item.id}#${run} ${Math.round(rec.wallMs / 1000)}s${rec.error ? ` — ${rec.error}` : ''}`);
  return rec;
}

/** Deletes pages by id (soft delete, recoverable on the instance for its retention window). Returns the ones that failed. */
export async function deletePages(client: EvalClient, ids: string[], log: (line: string) => void = () => {}): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await client.remove(id);
      log(`deleted ${id}`);
    } catch (e) {
      failed.push(id);
      log(`could not delete ${id}: ${message(e)}`);
    }
  }
  return failed;
}

export async function runEval(opts: RunOptions): Promise<EvalResults> {
  const items = opts.items ?? EVAL_SET;
  const repeat = Math.max(1, opts.repeat ?? 1);
  const startedAt = new Date().toISOString();
  const created: string[] = [];
  const runs: RunRecord[] = [];
  for (const item of items) {
    for (let r = 1; r <= repeat; r++) runs.push(await runOne({ ...opts, items }, item, r, created));
  }
  const results: EvalResults = {
    schema: 1,
    setVersion: SET_VERSION,
    startedAt,
    finishedAt: new Date().toISOString(),
    origin: opts.origin,
    workspace: opts.workspace,
    repeat,
    verify: opts.verify !== false,
    runs,
    aggregate: aggregate(runs),
    created,
  };
  if (opts.cleanup) await deletePages(opts.client, created, opts.log);
  return results;
}
