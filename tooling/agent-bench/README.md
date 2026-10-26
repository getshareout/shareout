# Agent build benchmark

Measures "agents produce top-tier artifacts with the ShareOut skill, fast": a headless
Claude Code agent gets a user-voice brief, builds and publishes on a throwaway local
instance, and the bench scores what got published and what it cost.

```bash
# from the repo root (needs shareout-app/node_modules, `claude` on PATH, Chrome for Testing)
node tooling/agent-bench/src/cli.mjs list
node tooling/agent-bench/src/cli.mjs run --suite smoke                 # 3 briefs, ~15 min
node tooling/agent-bench/src/cli.mjs run --suite core --repeat 3       # 20 briefs × 3 — costs real money
node tooling/agent-bench/src/cli.mjs run --suite smoke --mode mcp      # claude.ai / ChatGPT-style connector only
node tooling/agent-bench/src/cli.mjs run --briefs repair-kanban,changelog --model sonnet --label try-sonnet
node tooling/agent-bench/src/cli.mjs run --suite smoke --skill ../some-branch/skills/ShareOutSkill --label skill-v2
node tooling/agent-bench/src/cli.mjs judge --pairwise results/<a> results/<b>   # blind A/B of two runs
node tooling/agent-bench/src/cli.mjs baseline results/<run>                     # → baselines/<suite>-<date>.json
```

Each run writes `results/<ts>-<label>/report.html` and `summary.json` (gitignored); every
brief keeps its prompt, full agent transcript, screenshots, judge output and `result.json`.
The report compares against the newest `baselines/<suite>-*.json` for the same mode
(`--baseline <file>` to pick one). Only baselines are committed.

## What one brief run does

1. **Instance** (`src/instance.mjs`): fresh D1 via `wrangler d1 migrations apply --local`,
   then `wrangler dev --local --persist-to .state/<run>` on a free port (55400+), from a
   generated copy of `shareout-app/wrangler.toml` that adds a local `send_email` binding
   (Miniflare captures mail; nothing is sent). A counting proxy sits in front and is the
   instance's `SHAREOUT_BASE_URL`, so every call the agent makes is counted (HTTP calls,
   MCP tool calls, publishes). The bench account (`/auth/dev` → `POST /v1/me/tokens`) is
   the instance's `SETUP_ADMIN_EMAIL`. Briefs with `setup:` get pages (and rows) published
   first — the broken page to repair, the v1 to iterate on.
2. **Agent** (`src/run-agent.mjs`): `claude -p --output-format stream-json` in a temp dir
   outside any repo, prompt on stdin. Transcript, cost (`total_cost_usd`), tokens, turns and
   tool calls come from the stream.
   - `--mode cli`: the skill under test (`--skill`, default `skills/ShareOutSkill`) is a
     project skill in the work dir; fixtures are copied in; tools are Bash/Read/Write/Edit/
     Skill/Task. The agent's shell sees a throwaway `HOME` whose `~/.shareout/credentials`
     points at the bench instance (plus `SHAREOUT_ORIGIN`/`SHAREOUT_TOKEN`).
   - `--mode mcp`: no shell, no files, no skill — only the instance's `/mcp` connector with a
     Bearer token (`--strict-mcp-config`); fixtures are pasted into the prompt as attachments.
3. **Render** (`src/render.mjs`): Playwright (from `shareout-app/node_modules`) on **Chrome
   for Testing** at 1280×800 and 390×844, signed in as the owner. Collects uncaught errors,
   console errors, failed requests, axe-core violations (vendored by the instance), horizontal
   overflow, small tap targets, clipped text, LCP and bytes; saves screenshots.
4. **Checks** (`src/checks.mjs`): the brief's `functional:` steps, run like a user would —
   fill the form, add a card, reload, open a second viewer that joins late, change a stored
   number through the API and expect the page to show it — plus REST asserts (rows saved,
   schedule exists, same link updated, email sent, visibility) and "uses the expected data
   store" from the published source.
5. **Judge** (`src/judge.mjs`): `claude -p` with only the Read tool reads the screenshots,
   the brief and `rubric/judge.md` and returns six 1–5 scores (hierarchy, typography, color
   restraint, spacing, craft & states, fidelity). `--judge-model` picks the model.

## Score

```
Quality = gates × (0.35 judge + 0.25 functional + 0.15 runtime + 0.15 a11y + 0.10 layout)
gates   = the agent published · page not blank on both viewports · no uncaught errors
```

All parts are 0–1 (judge: mean of six scores mapped 1→0, 5→1). Without the judge
(`--no-judge`) the remaining weights are renormalised. Per brief the report shows the median
of N repeats and the spread; the suite line is the mean of brief medians, plus $/brief,
minutes/brief (wall clock), tokens, tool calls, HTTP calls and publishes.

Judge scores drift with the judge model and are noisy; for "did this skill change help",
prefer `judge --pairwise` over comparing absolute numbers. See `rubric/calibration/`.

## Isolation and safety

- The agent cannot reach a deployed ShareOut: Bash runs in Claude Code's OS sandbox with
  network limited to `localhost`, WebFetch/WebSearch are off, and the real `~/.shareout` is
  unreadable (`permissions.deny`). `--local` keeps wrangler off remote bindings.
- The operator's Claude setup does not leak in: `--setting-sources project` (no user
  settings, plugins, hooks or user CLAUDE.md), `--strict-mcp-config`, no session
  persistence, auto-memory off. Built-in Claude Code skills stay (every user has them).
  For a fully separate config dir, log one in once
  (`CLAUDE_CONFIG_DIR=~/.shareout-bench/claude claude` → `/login`) and run with
  `CLAUDE_BENCH_CONFIG_DIR=~/.shareout-bench/claude`.
- Browsers: Chrome for Testing only (`BENCH_CHROME` to override; the everyday Chrome app is
  refused). Install with `npx @puppeteer/browsers install chrome@stable`.
- `--replay <page.html>` publishes a hand-written page instead of calling a model — a free
  self-test of the instance/render/checks/report pipeline.

## Briefs

`briefs/*.yaml`: `prompt` (user voice), `lang`, `suites`, `fixtures` (from `fixtures/`),
optional `setup` (pages + rows published before the agent starts), `expect.stores`
(`json|table|realtime|dataset|email`, `|` = any of), `expect.target` (the setup page that
must be updated in place), `budget` (`minutes`, `usd`), and `functional` steps:
`expect_text`, `expect_no_text`, `expect_selector`, `click`, `press`, `fill`, `type`,
`add_item`, `fill_form`, `goto_page`, `reload`, `open_second`, `eval`, `live_update`,
`rest` (`rows`, `json_keys`, `data`, `jobs`, `versions`, `html_pages`, `visibility`,
`pwa_manifest`, `email_sent`, `source`). `{{token}}`/`{{token2}}` expand to unique values
per run; `in: b` runs a step in the second viewer; `optional: true` counts only if it passes.
All fixtures are synthetic.

## Nightly (later)

No hosted CI. To run nightly on a Mac, a LaunchAgent can call the CLI; for example
`~/Library/LaunchAgents/dev.shareout.agent-bench.plist` with `ProgramArguments`
`/bin/zsh -lc "cd <repo> && node tooling/agent-bench/src/cli.mjs run --suite core --label nightly"`,
`StartCalendarInterval` `{ Hour = 3; Minute = 0; }`, `RunAtLoad` false, and stdout/stderr to
a log file. Load it with `launchctl bootstrap gui/$(id -u) <plist>`. Budget first: the core
suite is 20 agent runs plus 20 judge calls per repeat.
