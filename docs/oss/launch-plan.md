# OSS launch plan

What has to be true before ShareOut is worth a stranger's afternoon. Five tracks,
in dependency order. Track 6 is the long tail — see
[feature-inventory.md](feature-inventory.md) for the per-surface queue.

**Status: T1, T3, T4, T5 are done. T2 is blocked on one thing only — a rehearsal on a
real Cloudflare account (T2.1, T2.5), which cannot be done from a code read. T6 is
ongoing.** Fifteen polish PRs landed after the tracks: #51–#74.

The recurring defect, across every track, was the same shape: **something that works on
the hosted instance because it has something configured that a stranger's does not** —
an email binding, an OAuth client, an AI key, wildcard DNS, a paid tier, a verification
key. Assume that shape when reviewing anything not yet verified.

The tracks are sequenced deliberately: T1 gates everything (an instance that
publishes to someone else's server is worse than no instance), T2 is what a
first-time visitor actually measures, and T6 is only worth spending on once
T1–T5 make the product reachable.

---

## T1 — The instance must be *theirs* ✅ #42, #44

Right now a self-hosted instance quietly points its agents back at the founder's
server. Nothing else matters until this is fixed.

| # | Work | Where | Why |
|---|------|-------|-----|
| T1.1 | Rewrite `shareout.site` → instance origin when serving `/v1/skill` | `src/skill.ts`, `src/discovery/agent-skill.generated.ts` | 58 skill files hardcode the founder host. An agent that loads the skill from a self-hosted instance is told to `POST https://shareout.site/v1/publish` — **their content lands on someone else's server.** |
| T1.2 | Same rewrite for `/sdk/shareout.js` guidance and artifact HTML templates | `src/sdk-serve.ts`, `skills/ShareOutSkill/SKILL.md` | Published artifacts load the SDK cross-origin from the founder host. |
| T1.3 | Add a `check:origins` static gate | `tooling/scripts/` | Fails CI on any new hardcoded `shareout.site` outside `Design/` and marketing copy. Keeps T1.1 fixed. |
| T1.4 | Make `SHAREOUT_BASE_URL` unset **loud**, not silently founder-hosted | `src/config/origins.ts` | Today the fallback is `https://shareout.site`. A missing var should surface on `/setup` and in `/health`, not silently misroute. |
| T1.5 | Delete plan/tier vocabulary | `skills/ShareOutSkill/SKILL.md`, `team/billing.md`, `docs-site/**/teams/billing.md` (EN+ES), `/v1/account/tier`, `/v1/account/upgrade`, `resolveEffectiveTier` | Billing left the code in #30; it did not leave the narrative. Agents still ask users "are you on the Teams plan?" on an instance where every feature is on. |

Doing T1.5 turned up four **live** paywalls, not just stale words — every account
on a self-hosted instance reads as free tier, so it hit the free-tier limits:
public artifacts auto-paused over 5 GB/day, a forced "Made with ShareOut"
watermark, and 402s on custom subdomains and session policy. Fixed in #44.

**Done when:** a fresh instance's agent, given only `{ORIGIN}/v1/skill`, publishes
an artifact to that instance and never contacts `shareout.site`.

---

## T2 — Deploy to first artifact, fast

The number that decides whether anyone stays. Target: **Deploy click → live
artifact URL in under 10 minutes**, agent-driven, no repo knowledge needed.

| # | Work | Where |
|---|------|-------|
| T2.1 | Verify Deploy-to-Cloudflare on a genuinely fresh Workers Paid account, end to end, and write down every place it stalls | `README.md`, `wrangler.toml` |
| ✅ T2.2 | Missing schema is reported by `/setup`, `/health` and the register endpoint, and documented in README / self-host / deploy skill (#46) | `migrations/`, `src/pages/setup.ts` |
| T2.3 | Make `/setup` a live checklist — re-check on load, show migration state, show what each unset var disables | `src/pages/setup.ts` |
| ✅ T2.4 | `npm run smoke:hello` already exists | `shareout-app/scripts/hello-publish-smoke.sh` |
| T2.5 | Rehearse the deploy skill against a clean account and fix every step where the agent has to guess | `skills/ShareOutSkill/deploy/` |
| T2.6 | Point the starter kit at a first-run instance owner, not a hosted signup | `src/starter-kit/`, `src/onboarding/` |

**Done when:** an agent handed nothing but the repo URL and a Cloudflare login
produces a live artifact URL, and the transcript has no human troubleshooting in it.

---

## T3 — Configuration is agent-driven ✅ T3.1, T3.4, T3.5 in #48

A self-hoster should describe what they want in a sentence; the agent configures it.
The pieces mostly exist (28 feature flags, 98 REST paths) — they aren't reachable as
one coherent surface.

| # | Work | Where |
|---|------|-------|
| T3.1 | `GET /v1/instance/config` — one document: origin, auth providers, email, LLM, storage caps, flags, what's unset and what that disables | new, `src/router/api/` |
| ~~T3.2~~ | **Dropped, deliberately.** Only feature flags are runtime-mutable, and they already had a write API and UI. Secrets, vars and bindings cannot be written by a Worker, so a `PATCH` would have accepted a key, returned 200 and changed nothing. Closed by #72 documenting the real split instead | — |
| T3.3 ✅ | `deploy/configure.md` (#72): read gaps → apply each fix → **verify by reading back**. `/v1/admin/*` now accepts a personal token so an agent can do it; `sot_` workspace tokens are refused as privilege escalation | `skills/ShareOutSkill/deploy/configure.md` |
| T3.4 | One documented BYO-LLM-key path, and a clean degraded state without it — **S72, the biggest unknown for self-hosters** | `src/crew/provider.ts`, `src/router/api/workspace-llm.ts` |
| T3.5 | One documented email-provider path (Cloudflare Email / any SMTP-ish worker binding) | `src/email/gateway.ts`, `docs-site/self-host/` |

**Done when:** "turn off Slack delivery, cap storage at 5 GB, use my Anthropic key"
is three agent tool calls, and every AI/email surface either works or says exactly
what it needs.

---

## T4 — Private by default, auth that works out of the box ✅ T4.1–T4.3 in #45

The pitch is *private artifacts on your own infrastructure*. The first-run login
has to work with zero external services.

| # | Work | Where |
|---|------|-------|
| T4.1 | **Username + password auth** (S06) — Argon2id/scrypt via WebCrypto, per-user salt, rate-limited, forced change on the seeded admin | new `src/auth/password.ts`, `migrations/` |
| T4.2 | Make password the documented default; keep OTP as the invite path and Google as opt-in | `src/pages/setup.ts`, `src/config/auth-providers.ts` |
| T4.3 | Fix OTP-without-email (S04) — codes in worker logs must be an explicit dev mode, never a silent default | `src/auth-otp.ts` |
| T4.4 | One page: "add Google SSO" — console screenshots, redirect URI, the two secrets | `docs-site/self-host/` |
| T4.5 | Document the private-by-default posture: what `OPEN_VISIBILITY_DISABLED` does, sandbox origin isolation, where an artifact can leak | `docs-site/self-host/threat-model.md` |

**Done when:** a fresh instance with only `SESSION_SECRET` set has a working
login, and no artifact is public unless someone chose that.

---

## T5 — Instance owner controls ✅ T5.1–T5.3, T5.6 in #47

The `/admin` portal has 15 views and is almost entirely read-only. The owner of an
instance can't create a workspace or appoint an admin without editing source.

| # | Work | Where |
|---|------|-------|
| T5.1 | Move the superadmin roster out of `superadmin-recipients.json` into D1 + env seed | `src/superadmin/recipients.ts`, `migrations/` |
| T5.2 | `POST /v1/admin/workspaces` — create a workspace, name its owner | `src/router/api/admin.ts`, `src/workspaces/crud.ts` |
| T5.3 | `POST /v1/admin/workspaces/{id}/members` — appoint owner/admin/member | `src/workspaces/members.ts` |
| T5.4 ✅ | Workspace-level member management was **already complete** (invite, role change, remove, pending invites with resend/revoke) — verified before building anything. The "no UI for instance-wide deactivate" note was itself stale: `rows.ts` renders an Enable/Disable toggle and a `disabled` badge, wired to `/v1/admin/users/{id}/revoke` | `src/superadmin/users.ts`, `views/rows.ts` |
| T5.5 ✅ | New Instance view (#70): gaps table, create-workspace and appoint-admin forms, full config. Settings links instance admins to it — `/admin` was previously linked from nowhere | `src/superadmin/views/bodies/instance.ts` |
| T5.6 | Rename the leftover `profit` view key to `costs` | `src/superadmin/views/config.ts` |

**Done when:** the instance owner can stand up a workspace and hand it to a team
lead without touching the repo.

---

## T6 — Polish every surface

102 surfaces catalogued in [feature-inventory.md](feature-inventory.md), each with a
code entry point, a state judgement, and a six-point definition of done. One agent
per row, one PR per row.

**105 surfaces** after the July 26 re-verification (plus later polish). Counts move as
rows are re-judged — see [feature-inventory.md](feature-inventory.md).

**Already closed that the list used to claim were open:**

| Item | Landed |
|------|--------|
| Credential cluster (LLM + email) | `self-host/ai.md`, `self-host/email.md`, #48/#80 |
| S50 BigQuery + Snowflake docs | #78 |
| S71 WhatsApp stub | **removed** #77 |
| S66 bespoke moderation pipeline | **removed** (not product) |
| S32/S61/S67/S68 “needs LLM” ⚠️ | same documented path as S23 — marked ✅ |
| S34 / S70 default-off flags | **deliberate opt-in** (cost / Slack app setup), documented |

What is actually left, in order:

1. **Verify on a real account** — S01, S02, S36. Not code reads; someone has to deploy on a
   fresh Workers Paid account, then promote to `v0.1.0`.
2. **S40 moderation policy** — code is instance-origin-aware; decide whether private
   instances should leave the classifier off by default.
3. **Optional product bets** — turn `ai.create` or `ai.slack_bot` on by default only if
   operators want the token/Slack cost without an Admin → Features step.

A method note, because it mattered more than the list: **grepping `src/` for
`shareout.site` and asking per hit "does this reach an outsider or gate something
functional?" found roughly one real bug per file.** Reading this table row by row did
not. Prefer the grep.

---

## Track ownership

Tracks are independent enough to run in parallel worktrees, with one ordering
constraint: **T1 lands before T2 is worth verifying** (no point timing a deploy
that ends up pointed at the wrong host).

```bash
git worktree add -b feat/T1-instance-origin ../shareout-wt/T1 origin/main
```

One PR per numbered item where it stands alone; one PR per track where the items
only make sense together.
