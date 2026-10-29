# Page-build eval

A number for "how good are the pages the AI builds": a versioned set of 24 build requests
(English and rioplatense Spanish), run against a live instance through its **public API**, and
scored. Use it to compare a model, a reasoning effort, a prompt change, or `BUILD_AGENT=on`
against `off` before changing a default.

It is an on-demand tool, not part of `npm test`, CI or the pre-push hook. The unit tests
(`tests/unit/evals/page-build/`) run the scorers and the runner against a mocked HTTP layer and
never touch a network.

## What it costs

**Every item is one real build on the instance's AI budget** (and a long app can take several
minutes of agent turns). 24 items x `--repeat 2` is 48 builds. Run on a workspace whose budget you
mean to spend, start with `--only` on two or three items, and use `--repeat` only once the numbers
are worth the spend. The browser verify of each page also counts against the instance's verify
limits. The CLI prints the number of builds before it starts.

## Run it

From `shareout-app/`:

```bash
export SHAREOUT_TOKEN=...        # a token for a member of the workspace; read from the variable, never printed
npm run eval:builds -- --origin https://your-instance.example --workspace wsp_xxx --token-env SHAREOUT_TOKEN
npm run eval:builds -- ... --only crud-tasks-en,long-crm-en     # a subset
npm run eval:builds -- ... --repeat 2                           # each item twice (pass share per item)
npm run eval:builds -- ... --no-verify                          # skip browser verify (instance without a browser)
npm run eval:builds -- ... --cleanup                            # delete every page the run created, at the end
npm run eval:builds -- list                                     # the set: id, language, kind, tags
```

Results go to `evals/results/<timestamp>.json` plus a `.md` summary next to it (git-ignored); pass
`--out` to name the file. Compare two runs:

```bash
npm run eval:builds -- compare evals/results/before.json evals/results/after.json
```

It prints pass rate, expectation rate, mean static and verify issues, mean wall time, **per-item
regressions** (with the reason) and improvements. Compare runs of the same `setVersion`; the
command warns when they differ.

## How a run works

No model is called from the runner; the instance spends its own budget.

1. `POST /v1/workspace/{ws}/agent/chat` with the item's prompt. The workspace assistant answers
   with a build proposal and a confirmation token.
2. `POST /v1/workspace/{ws}/agent/confirm` streams `build_step` events and ends with `build_done`
   (page id). The page is tagged `eval-page-build`.
3. `GET /v1/artifacts/{id}/files` reads back the published files.
4. `POST /v1/artifacts/{id}/verify` renders the page in the instance's browser.
5. The files are scored. `--cleanup` (or `cleanup --from <results.json>` later) deletes the pages
   (soft delete: they sit in the instance's trash for its retention window).

Edit items first publish a small generic seed page (`seeds.ts`), ask the assistant to change it
(`edit_page`, which confirms with a JSON answer instead of a stream) and score the edited files.
They exercise the page editor, not the build agent.

## Scoring

Most objective first:

1. **Static check**: `src/build-agent/static-check.ts` on the produced files (JS parses, manifest is
   JSON, every `sdk.table` declared, references resolve, the Verify source rules).
2. **Browser verify**: status `pass | warn | fail | partial`. `partial` means the instance had no
   browser; it neither passes nor fails the page.
3. **Expectations** over the files (`set.ts`, `scorers.ts`): declared tables, number of form
   fields, named features (`chart`, `validation`, `formula`, `responsive`, `persistence`: regex
   heuristics that say the mechanism is there, not that it is right), required patterns, sections,
   size, visible-text language, and for edits the strings that must survive.

A run **passes** when the page was built, the static check has no errors, verify did not fail, and
every expectation held. The aggregate is pass rate, mean expectation rate, mean static and verify
issues, wall time (mean, p50, max, total) and tokens/cost.

### Not done

- **No LLM judge.** A rubric judge must go through the metered provider layer inside the Worker, and
  there is no endpoint for it; a runner outside the Worker would be a direct model call. Add one as
  a server-side, off-by-default route if the heuristics prove too coarse.
- **Tokens and cost per page are only what the usage ledger endpoint exposes.** The runner reads
  `GET /v1/workspaces/{ws}/usage` totals before and after each run, but that endpoint lists the
  assistant kinds (`assistant_chat`, `ask_workspace`) and not `page_build`, so the build's own spend
  is not in it today and the figure covers the chat turn only. Read the build spend from the
  instance's AI usage ledger (`ai_usage_events`, kind `page_build`) until `page_build` is exposed.

## Changing the set

Edit `set.ts`. An item has an `id`, `prompt`, `language`, `tags`, `kind` (`build` or `edit`), and
`expect`. Name each expected table in the prompt (`tables` are checked by name). Keep prompts
generic: no customer names. Bump `SET_VERSION` when an item's meaning changes, so old results are
not compared to new ones as if they were the same test.
