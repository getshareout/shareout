# Schema conventions

Rules for new tables and columns. `scripts/check-migrations.mjs` enforces the
mechanical ones on every migration, `0000_init.sql` included; the rest are review
notes. The schema follows them — the v2 redesign that made it so is recorded in
[REDESIGN.md](REDESIGN.md), which is history now rather than a plan.

## Files

- `0000_init.sql` is the whole schema. Changes to a table that has not shipped yet are
  made **in that file** — this repo owes nothing to
  a deployed database, so there is no history to preserve.
- Once a table is shipped and self-hosters are running it, changes go in
  `NNNN_lower_snake_case.sql` with a unique 4-digit prefix, applied in filename order.
  Wrangler records applied migrations by exact filename: never rename one.
- One concern per file. Name it after what it does, not the ticket.
- Lead with a comment saying *why*. The `CREATE TABLE` already says what.

## Naming

| Thing | Rule | Example |
|---|---|---|
| Table | `lower_snake_case`, plural for entities | `artifacts`, `workspace_members` |
| Table (config/log/state) | singular is correct for mass nouns | `platform_config`, `audit_log` |
| Column | `lower_snake_case` | `owner_id`, `created_at` |
| Primary key | `id TEXT PRIMARY KEY`, prefixed opaque id | `job_a1b2c3` |
| Foreign key | `<singular_table>_id` | `artifact_id`, `workspace_id` |
| Actor column | `<verb>_by`, referencing `users(id)` | `created_by`, `invited_by` |
| Index | `idx_<table>_<columns>` | `idx_artifacts_owner_visibility` |
| Unique index | `ux_<table>_<columns>` | `ux_grants_dedup` |

## Types

SQLite has five storage classes; this schema uses three.

- **Timestamps → `TEXT`**, in exactly one format — see below.
- **Booleans → `INTEGER`** holding 0 or 1, `NOT NULL DEFAULT 0`. Name them `is_*`,
  `has_*`, or `*_enabled`.
- **Money → `INTEGER`** in the smallest unit, with the unit in the name
  (`price_cents`, `default_run_budget_micro_usd`). Never `REAL`.
- **JSON → `TEXT`.** Validate on the way in; the database will not.
- Everything else is `TEXT`.

## Timestamps: one type, one format, one vocabulary

Every timestamp in the schema is `TEXT` holding **`YYYY-MM-DDTHH:MM:SS.sssZ`** — the
exact output of JavaScript's `new Date().toISOString()`. In SQL:

```sql
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
```

That expression is verbose on purpose. `datetime('now')` returns
`YYYY-MM-DD HH:MM:SS`, and **JavaScript parses that space-separated form as local
time** — `new Date('2026-07-26 14:22:55')` is four hours off in New York. Workers run
UTC so it looks fine in production and silently corrupts anywhere else. The `Z` form
is unambiguous, roundtrips through `Date` byte-for-byte, sorts lexicographically in
chronological order, and every SQLite date function (`date()`, `julianday()`,
modifiers) accepts it.

Consequences, all of them load-bearing:

- **Writing from TypeScript:** `new Date().toISOString()`. No helper, no formatting —
  the obvious call is the correct one, which is the point.
- **Comparing:** compare the strings. `WHERE created_at > ?` bound with an ISO string;
  `a.created_at < b.created_at` in JS. No parsing needed to order two timestamps.
- **Windows:** `strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')` in SQL, or bind
  `new Date(Date.now() - 7 * 86400_000).toISOString()`.
- **Arithmetic:** `Date.parse(row.created_at)` for epoch ms. Never `* 1000`.
- Never store epoch integers. `unixepoch()` appears nowhere in this repo, and
  `check-migrations.mjs` rejects a non-TEXT `*_at` column.
- **`datetime("now")` — with double quotes — is the same bug wearing a disguise.**
  SQLite falls back to treating an unknown double-quoted identifier as a string
  literal, so it runs, and writes the space-separated form. It is banned for the same
  reason as `datetime('now')`; PR-2's grep missed 21 of them precisely because of the
  quoting.

**One exception, and it is not a timestamp.** The scheduler cursors —
`scheduled_jobs.next_run_at`, `scheduled_jobs.last_run_at`, `crew_triggers.next_run_at`,
`metric_alert_rules.next_run_at`, and `job_runs.created_at` — hold **unix seconds** as
TEXT. They are queue keys: the dispatch loop compares and advances them numerically, and
`crew_triggers` does a compare-and-swap claim on the exact stored value. They are
internally consistent, every reader treats them as epoch, and converting them is a
dispatch-correctness change, not a formatting one. If you convert one, convert all five
in the same commit, or the loop silently stops firing.

Names are as fixed as the format:

| Name | Means |
|---|---|
| `created_at` | when the row came into existence — **every** table |
| `updated_at` | last in-place modification |
| `*_at` | a specific domain moment: `expires_at`, `revoked_at`, `viewed_at`, `deleted_at`, `last_run_at` |
| `*_date` | a date-only value, `YYYY-MM-DD` |

Banned: `ts`, `timestamp`, `*_time`, and any name for row-creation other than
`created_at`. If the row is born when the thing happened, the column is `created_at` —
a log row written at execution time does not get `executed_at`.

## Every table records when its row happened

Usually that is `created_at`. Sometimes the domain has a better word for the same
moment — `linked_at` on a chat link, `dismissed_at` on a dismissal, `viewed_at` on a
view, `window_start` on a rate-limit bucket, `period`/`date` on a rollup — and adding
`created_at` beside it would only be a second timestamp nobody reads. Either satisfies
`check-migrations.mjs`; a table with neither fails the build.

Add `updated_at` when rows are mutated in place.

> SQLite rejects a non-constant `DEFAULT` in `ALTER TABLE ADD COLUMN`, so the
> `strftime(...)` default can only be set at `CREATE TABLE` time. Get it right when the
> table is born.

## Every table has an owner and a page

`scripts/check-migrations.mjs` holds a `TABLE_OWNERS` map from table prefix to the module
that owns it, and fails on a prefix that is not in it — so adding a table forces you to
say where it belongs. It also fails on a table that never appears in `SCHEMA.md`.

Neither check cares about the string; they care that somebody decided. A table nobody
documented implies a feature that does not exist, and the next person spends an afternoon
working out which.

## Foreign keys

- Reference the parent explicitly: `REFERENCES artifacts(id)`.
- **Ownership → `ON DELETE CASCADE`.** If the row is meaningless without its parent
  (a comment without its artifact), cascade it.
- **Attribution → no action.** `created_by`, `invited_by`, `decided_by` point at the
  actor, not the owner. Deleting a user must not delete the audit trail.
- Say which one you meant in a comment when it is not obvious.

## Constraints belong in the application

Do not add `CHECK` constraints or `BEFORE INSERT` triggers to validate an enum.

This schema tried it. Eight triggers policed four `scheduled_jobs` columns, and every
new allowed value cost a migration to drop and recreate the trigger pair — six of the
pre-open-source migrations existed for no other reason. They still drifted out of sync
with the TypeScript that writes the column: the trigger allowed a `report_daily`
action the `JobAction` union did not, and nothing caught it. The triggers are gone.

The pattern that replaced them, in `src/scheduling/jobs/types.ts`:

```ts
export const JOB_ACTIONS = ['email', 'webhook', /* … */] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];
export const isJobAction = oneOf(JOB_ACTIONS);
```

One list. The type is derived from it, the runtime guard reads it, and adding a value
is a one-line change with no migration. Enforce it at the write path.

Genuine invariants — `PRIMARY KEY`, `UNIQUE`, `NOT NULL`, `FOREIGN KEY` — stay in the
database. Those are structure, not policy.

## Indexes

- Add one when a query needs it, not in anticipation. `PRIMARY KEY` and `UNIQUE`
  already build one.
- Composite index column order follows the query's `WHERE` then `ORDER BY`.
- Partial indexes for filtered lookups: `... WHERE deleted_at IS NULL`.
- Name the query it serves in a comment if the shape is not obvious.

## Destructive migrations

`DROP TABLE`, `DROP COLUMN`, `DELETE FROM` and `UPDATE … SET` in a migration can lose data
that no `git revert` brings back — reverting restores files, but `d1_migrations` records
what ran by filename, so an applied drop stays applied.

`npm run deploy` runs `check:destructive` first. It looks at the migrations Wrangler
reports as **pending** against the remote database, and refuses if any of them are
destructive:

```
SHAREOUT_CONFIRM_DESTRUCTIVE=1 npm run deploy
```

The variable is not a formality to paste past. It means you took a
`wrangler d1 export` backup and checked what the statements actually touch — "that table
should be empty" is not the same as having counted the rows.

The guard only fires on pending migrations, so it stops nagging once the destructive
migration has been applied.

## Changing an existing table

**While the redesign is in flight, edit `0000_init.sql` directly.** No deployed
database depends on this repo's schema history, so a table that needs a different
shape gets the different shape — no `ALTER`, no rebuild, no migration. Change the
code that queries it in the same PR.

Once self-hosters are running a table, that stops being true and the SQLite rules
apply: `ALTER TABLE` only adds columns, renames, and drops columns. Any other change
means the 12-step rebuild — create the new table, copy, drop, rename — with
`PRAGMA defer_foreign_keys = ON;` at the top of the file, since Wrangler wraps each
migration in a transaction where `PRAGMA foreign_keys` cannot be changed.

Prefer additive changes. A nullable column costs nothing; a rebuild costs a
maintenance window.

## Former exceptions

`0000_init.sql` used to carry inconsistencies inherited from the schema as it grew
before the open-source release, and the checker skipped it. It no longer does, because
there is nothing left to skip.

| Was | Now |
|---|---|
| 60 tables with no `created_at` | every table records a moment — `created_at` or the domain word for it |
| 13 with `created_at` and no default | the canonical `strftime` default throughout |
| FKs declared on a minority of `*_id` columns | 100% of `artifact_id`, `workspace_id`, `user_id`, `owner_id` |
| Timestamps in three types and two formats | one TEXT format, with one documented exception (the scheduler cursors) |

They were closed by moving the schema and the code that queries it together, in phases.
That is the part worth copying: a half-converted timestamp column is worse than a
consistently wrong one.
