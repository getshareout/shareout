/** Entry point of `npm run eval:builds` (bundled and run by scripts/eval-builds.mjs). The only file here that touches disk or process.env. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, UsageError, USAGE } from './args';
import { createClient } from './client';
import { compareResults, renderComparison } from './compare';
import { renderSummary } from './report';
import { deletePages, runEval, selectItems } from './runner';
import { EVAL_SET, SET_VERSION } from './set';
import type { EvalResults } from './types';

const readResults = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as EvalResults;

function tokenFrom(envName: string): string {
  const token = process.env[envName];
  if (!token) throw new UsageError(`The environment variable ${envName} is empty or not set`);
  return token;
}

async function main(): Promise<void> {
  const cmd = parseArgs(process.argv.slice(2));

  if (cmd.cmd === 'list') {
    console.log(`Set v${SET_VERSION}: ${EVAL_SET.length} items`);
    for (const i of EVAL_SET) console.log(`${i.id.padEnd(22)} ${i.language} ${i.kind.padEnd(5)} ${i.tags.join(',')}`);
    return;
  }

  if (cmd.cmd === 'compare') {
    process.stdout.write(renderComparison(compareResults(readResults(cmd.before), readResults(cmd.after)), { before: path.basename(cmd.before), after: path.basename(cmd.after) }));
    return;
  }

  if (cmd.cmd === 'cleanup') {
    const res = readResults(cmd.from);
    const client = createClient({ origin: cmd.origin, token: tokenFrom(cmd.tokenEnv) });
    const failed = await deletePages(client, res.created, console.log);
    console.log(`${res.created.length - failed.length} of ${res.created.length} pages deleted`);
    if (failed.length) process.exitCode = 1;
    return;
  }

  const items = selectItems(cmd.only);
  const client = createClient({ origin: cmd.origin, token: tokenFrom(cmd.tokenEnv) });
  console.log(`${items.length} item(s) x ${cmd.repeat} on ${cmd.origin}: each is one real build on this instance's AI budget`);
  const results = await runEval({ client, origin: cmd.origin, workspace: cmd.workspace, items, repeat: cmd.repeat, verify: cmd.verify, cleanup: cmd.cleanup, log: console.log });

  const out = path.resolve(cmd.out ?? `evals/results/${results.startedAt.replace(/[:.]/g, '-')}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(out.replace(/\.json$/, '') + '.md', renderSummary(results));
  console.log(`\n${renderSummary(results)}\nResults: ${out}`);
  if (!cmd.cleanup && results.created.length) console.log(`${results.created.length} pages left on the instance (tag eval-page-build). Remove them: npm run eval:builds -- cleanup --from ${out} --origin ${cmd.origin} --token-env ${cmd.tokenEnv}`);
}

main().catch((e) => {
  if (e instanceof UsageError) console.error(`${e.message}\n\n${USAGE}`);
  else console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
