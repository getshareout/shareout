# Schema v2 — what changed, and what the plan got wrong

Done, 2026-07-26, in ten PRs. This is the record, not a plan: read
[SCHEMA.md](SCHEMA.md) for what the schema *is* and [CONVENTIONS.md](CONVENTIONS.md) for
the rules new tables follow. Keep this file for one reason — **six of the planned folds
were wrong, and the reasons they were wrong are the reusable part.**

## Result

| | Before | After |
|---|---|---|
| Tables | 151 | **135** |
| Indexes | 242 | **203** |
| `artifacts` columns | 42 | **22** |
| Migration files | 151 | **1** (`0000_init.sql`) |
| FKs on `artifact_id` / `workspace_id` / `user_id` / `owner_id` | ~40% | **100%** |
| Quoted table names | 5 | **0** |
| Timestamps | 3 types, 2 formats | 1 TEXT format + 1 documented exception |

The original target was ~95 tables. It landed at 135 because six planned folds turned out
to be wrong — each documented below. **The count was never the goal**; one grammar was. A
fold that merges two things which are not the same thing makes the schema worse while
making the number better.

## What the plan got wrong

Every one of these was written in the plan as verified. None survived reading the DDL.

| Planned | Reality | Phase |
|---|---|---|
| `workspace_context_files` is identical to the other two file tables | Different key (`name`, not `path`), plus a sharee scope the others have no concept of | PR-3 |
| `agent_rate_limits` is a counter table | Counters *and* per-artifact config columns nothing had ever written | PR-3 |
| `google_sheets_connections` is a connection | A sync definition: no credentials, a schedule, and a log table hanging off it | PR-4 |
| `editor_chat_contexts` is not chat | It was chat history — a whole exchange crammed into one JSON blob | PR-5 |
| `metric_alert_events` is a notification | An evaluation ledger: a row per run, matched or not | PR-6 |
| `home_event_dismissals` becomes a `dismissed_at` column | It dismisses *any* feed row — comments, runs, alerts — not just the four being folded | PR-6 |
| `ai_usage_events` is a subset of `agent_usage_events` | Three columns shared, five with no counterpart, different units entirely | PR-8 |
| Split `artifacts` four ways, including access | `visibility` is in the list `WHERE` and in two composite indexes a satellite cannot carry; the serve query would go 4 tables → 7 | PR-7 |

**The rule that came out of it:** a table's *name* tells you what someone once meant. Its
*DDL and its writers* tell you what it is. Diff those before believing any claim that two
tables are the same — including a claim in this file.

## Bugs found by reading the code that touched each table

None of these were the point of the work. All of them were live.

- **Two ciphertexts stored against one AES-GCM iv** (`artifact_sheets_tokens`,
  `google_oauth_tokens`). The refresh token was never decryptable, so Google/Sheets
  tokens could not refresh — swallowed as "reconnect" on one path, an unhandled 500 on
  the other. *(PR-4)*
- **A foreign key to a dropped table, and a column that never existed.**
  `artifact_pending_edits` referenced `agent_conversations` and wrote `applied_at`; every
  applied edit threw `no such column`. *(PR-5)*
- **The "Needs you" list did not sort.** Half its sources returned a TEXT timestamp, half
  an integer; `y.ts - x.ts` is `NaN` for a mixed pair, which `Array.sort` treats as
  equal — so rows came back grouped by source and the newest could be sliced off. *(PR-6)*
- **The activity feed ignored its time window** for chat: epoch milliseconds compared
  against epoch seconds *as text* is true for every row. *(PR-5)*
- **Superadmin insights queried columns that no longer existed** — `e.timestamp` and
  `l.executed_at`, renamed two phases earlier. *(PR-9)*
- **Rate-limit rows were never pruned**, and the agent fold multiplied them per artifact
  per minute. *(PR-3)*

## How it was done

One PR per phase, each independently green and deployable. Schema and the code that
queries it move together — always. Four gates per PR, all mechanical:

1. `npm test` green.
2. `0000_init.sql` applies to an empty sqlite3 with zero errors, and
   `PRAGMA foreign_key_check` is clean. *(That second check was added in PR-5, after a
   dangling key reached main.)*
3. A grep receipt in the PR body: for every table renamed or removed,
   `grep -rEn "(FROM|INTO|UPDATE|JOIN|DELETE FROM) <old_name>\b" src/ tests/` returns
   nothing.
4. `node scripts/check-migrations.mjs` and `npx tsc --noEmit` clean.

**Tests were consistently the larger half of the work** — not `src/`, the fixtures.
Inline `CREATE TABLE` statements that duplicate the real schema, and
`sql.includes('<table>')` matchers in DB mocks that stop discriminating the moment two
tables become one. `tsc` cannot see inside a SQL string; budget accordingly.

## What is still true and worth guarding

- **`scripts/check-migrations.mjs` runs on `0000_init.sql` too** — the exemption came off
  with the last phase. It enforces naming, types, one-moment-per-table, an owning module
  per table prefix, and presence in SCHEMA.md.
- **Two tests pin the timestamp convention**, one on the schema
  (`tests/unit/schema-timestamps.test.ts`), one on the source
  (`tests/unit/source-timestamps.test.ts`). The second exists because the first passed
  happily while 22 bad call sites lived in `src/`: a schema-only check is half a check.
- **The schema parser scans to a balanced paren, not to a `\n);` line.** Fifteen tables
  close on the same line as their last column, and a line-based parser skips them *and*
  swallows whatever follows — so the guard silently checked 120 of 135 tables until
  PR-10. `tests/unit/check-migrations-rules.test.ts` restates every rule and would fail
  on a violation planted in one of those fifteen.
- **The scheduler cursors are unix seconds on purpose** — `next_run_at`, `last_run_at`,
  `job_runs.created_at`. They are queue keys compared and advanced numerically, and
  `crew_triggers` compare-and-swaps on the exact stored value. Convert one and you must
  convert all five, in a PR of its own, or dispatch stops silently.
- **`artifact_access` was measured and rejected, not forgotten** (PR-7). If you revive
  it, re-measure first; the numbers are in that PR.
- **Greenfield still applies.** This repo owes nothing to any deployed database: change
  `0000_init.sql` and the code together rather than adding a migration, until the day
  someone other than us is running an instance they cannot rebuild.

## Repo gotchas that cost real time

- Merging needs `gh pr merge <n> --merge --admin` — branch protection blocks a plain
  merge and auto-merge is off. Delete branches with
  `gh api -X DELETE repos/getshareout/shareout/git/refs/heads/<branch>`; `git push
  --delete` hangs on the pre-push hook.
- The pre-push hook runs ~4 minutes. Push once per PR; use `gh pr update-branch` for
  merge-queue catch-ups, never a local rebase.
- Editing anything under `skills/ShareOutSkill/` makes `public/_bundles/skill.zip` stale
  and CI fails on it. The pre-push hook does not catch this — run `npm run build:skill`.
- `git checkout -- <path>` reverts *all* unstaged work in that path. It cost a round of
  work twice. To prove a new test catches a bug, reintroduce the bug with a scripted edit
  you can undo the same way, never with git.
- A deletion guard blocks `rm -rf` and `git worktree remove` from agent shells. Use unique
  scratch filenames; ask a human to remove worktrees.
- `zsh` does not word-split unquoted variables: `for f in $FILES` iterates once with the
  whole blob. Use `… | while read -r f; do`.
