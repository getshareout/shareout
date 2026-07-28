# QA.md — Quality methodology for ShareOut

**Purpose:** ship features fast without quality regressions. Every new feature or UI/behavior change is verified by an **AI agent first**, then a **human (final sign-off)**. The agent does the repetitive verification; the human keeps the judgment work.

**Read first for any QA work:** this file, then [AGENTS.md](AGENTS.md) for repo routing and [Design/README.md](Design/README.md) for design truth.

---

## The four dimensions

Every change is reviewed across these four. Each is grounded in a file that already exists — the agent reads it, doesn't invent criteria.

| # | Dimension | Question | Grounded in | Automatable? |
|---|-----------|----------|-------------|--------------|
| 1 | **Design / aesthetic** | Does it follow our patterns and look on-brand? | `Design/visual/`, `Design/system/components.md`, `Design/principles/anti_patterns.md` | Partial — `check:design-tokens` covers token values; *visual* judgment is agent + human |
| 2 | **Functional** | Do endpoints, clicks, and actions work as specified? | The PR diff + linked issue's acceptance criteria | Yes — Playwright against preview URL + Vitest |
| 3 | **Edge cases** | What breaks on bad/empty/hostile input? | Changed endpoints + `test/` patterns | Yes — agent-generated adversarial cases |
| 4 | **UX flow** | Is the user journey good and on-philosophy? | `Design/principles/design_principles.md`, `Design/brand/voice.md` | Partial — agent flags friction; human owns the call |

North star (from AGENTS.md): *Ideas deserve to exist* — one clear action per screen, warm not clinical, blue used sparingly.

---

## QA states (GitHub Issues + Projects)

QA state lives on the **issue**, never in someone's head or a spreadsheet. A feature cannot reach `Done` without passing through QA.

Labels:

| Label | Meaning | Set by |
|-------|---------|--------|
| `ready-for-qa` | PR merged or preview ready; charter can run | automation (on PR) or human |
| `in-qa` | Agent QA run in progress | automation |
| `qa-passed` | Agent + human checks passed | automation → human confirms |
| `qa-failed` | One or more dimensions failed | automation, assigned back to author |

The `todo.md` backlog migrates into Issues so each item carries a QA state and is **API-addressable** (a labeled issue can dispatch an agent run).

---

## The agentic QA loop

Per PR / feature branch:

1. **Charter** — agent reads the PR diff + linked issue, emits 5–15 concrete scenarios across the four dimensions (happy path, edge cases, adjacent-feature regressions). Posted as a PR/issue comment.
2. **Execute** — agent runs the charter against **`wrangler dev`** (real data, read-only). Functional/UX via Playwright (use existing `data-e2e` markers); design via screenshots compared against `Design/`.
3. **Report** — pass/fail per scenario, screenshots/traces for failures, severity guess. Human skims in ~5 min instead of 45 min of clicking. Flips the label.
4. **Triage failures** — agent classifies each: real bug / flaky / intentional-change-needs-test-update. Files a bug issue or proposes the fix.
5. **Human sign-off** — UX review, novel-feature exploration, and final approval on risky paths (auth, data deletion, publish/delete, payments).

### Running the loop

The loop is encoded as a slash command: **`.claude/commands/qa.md`**.

- **Locally / in Claude Code:** `/qa <PR# | branch>` (empty = current branch vs `main`).
- **From an automation / cloud agent:** the same prompt runs headless — `claude -p "/qa <PR#>"` — so a GitHub Action (on `ready-for-qa` label or PR event) or any agent runner triggers an identical pass.

Calibrate `/qa` locally on a few real changes first; once it's trustworthy, wire it to fire automatically. Same prompt, two runners — no divergence.

### Environment (no public URL required)

The agent exercises changes via **`npm run dev`** (local D1/R2/KV at `localhost:55162`) or **`npm run dev:prod`** when real prod data is required — see [CONTRIBUTING.md](CONTRIBUTING.md). Per-PR public preview was attempted and parked (Cloudflare `workers.dev` previews don't serve while the production workers.dev subdomain is disabled). Optional: **Cloudflare Workers Builds** on feature branches → preview URLs (see CONTRIBUTING.md).

Use **`http://localhost:55162`** for browser QA, not `127.0.0.1`. Local artifact iframes deliberately resolve through the localhost origin so private artifacts render normally while production keeps the isolated `shareoutcdn.site` content domain.

### Internal agent access smoke

Before a QA agent runs a broader charter, it can prove that auth + private artifact rendering works:

```bash
cd shareout-app
npm run test:e2e:agent
```

This Playwright spec starts `wrangler dev`, publishes a private throwaway artifact, grants a test viewer, logs in through `/auth/dev`, verifies the private iframe content, writes `test-results/agent-qa-private-artifact.png`, then deletes the artifact. If `~/.shareout/credentials` is missing, the spec skips instead of failing.

### Data-safety rule (read-only)

Default **`npm run dev`** uses **local** D1/R2/KV. **`npm run dev:prod`** binds to real prod D1/R2/KV. Therefore:

- Agent QA does **read / navigation / visual** checks freely.
- **Destructive flows** (publish, delete, edit) run **only** through scripted E2E that creates throwaway artifacts (the `e2e-live/flows/` pattern) — never ad-hoc agent clicking.

---

## Promotion to committed tests

Exploratory scenarios are throwaway. When a scenario proves valuable and stable, promote it into a committed spec:

- **Critical journeys, money paths, auth** → `e2e/*.spec.ts` (runs in CI on every PR). Keep these **few and high-value**.
- **Endpoint/edge logic** → `test/*.test.ts` (Vitest). Push detail *down* the pyramid.

If CI gets slow or flaky, you've promoted too much to E2E.

---

## What already exists (don't rebuild)

- Vitest suite + coverage thresholds enforced in CI (`npm run coverage`)
- Local mirrors: `./tooling/scripts/ci-check.sh` (full) and `ci-check-fast.sh`
  (pre-push via `./tooling/scripts/install-hooks.sh`)
- 15 scripted E2E agent flows + smoke suite (`e2e-live/`) — not yet required in public CI
- Design-token CI check (`check:design-tokens`)
- Public CI on every push and PR (`.github/workflows/ci.yml`): static gates (boundaries,
  design tokens, domains, migrations, UI conventions, access seams, file size), fresh D1
  migrate, typecheck, **`test:critical`** (auth/access/publish/error contract — fail-fast),
  unit tests **with coverage floors**, workspace tests, bundles, production
  `npm audit --omit=dev --audit-level=high`, docs-site build, and gitleaks

The gaps this methodology closes: **Cloudflare Workers Builds preview URLs**, **QA state on work**, **visual/UX judgment**, **agent-triggered QA runs**.

---

## Rollout (sequential — one phase at a time, sign-off between)

| Phase | What | Output |
|-------|------|--------|
| 0 | Methodology | this doc |
| 1 | Backlog state | GitHub labels + Project; migrate `todo.md` |
| 2 | Preview env | Cloudflare Workers Builds → preview URL on feature branches |
| 3 | Charter prompt | diff + issue → 5–15 scenarios across 4 dimensions |
| 4 | Local loop | run charter vs `npm run dev` / `dev:prod` → findings report (calibrate) |
| 5 | Cloud trigger | Workers Builds or manual `/qa` on `ready-for-qa` label |
| 6 | Promote | proven scenarios → committed `e2e/` specs |

**Agent triggering:** calibrate the charter **local-first**, then wire the same prompt to whatever runner you prefer — GitHub Actions, Cloudflare Workers Builds, or a scheduled agent.
