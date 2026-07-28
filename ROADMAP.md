# Roadmap

Honest direction for the open-source tree. This is **not** a commitment calendar —
single-maintainer project; items move when capacity and real users need them.

## Done (OSS soft-launch foundation)

- [x] Apache-2.0 public tree with self-host path (`BILLING_MODE=none`, Deploy button)
- [x] Community files: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, SUPPORT, NOTICE
- [x] Public CI: critical-path suite on PR; full suite on main/nightly; gitleaks
- [x] Canonical API error envelope + artifact/publish/workspace/router helpers
- [x] Dependabot (grouped) + RELEASING.md
- [x] Billing/payments removed from OSS tree (unlocked self-host by construction)
- [x] Tag + GitHub prerelease `v0.1.0-pre`

## Near term

- [x] Agent deploy skill + skill **source of truth** (`skills/README.md`; monorepo canonical)
- [x] One-shot skill mirror to `getshareout/shareout-skill` + `mirror-skill-repo.sh`
- [x] Branch protection on `main` (`Checks`, `Gitleaks`, strict, require PR)
- [x] OSS skill: no paywall language (billing hosted-only stub; workspace admin without plans)
- [x] Official primer `official-skills/shareout.md` origin-aware + points at full `$ORIGIN/v1/skill`
- [ ] Verify Deploy-to-Cloudflare on a **fresh** Workers Paid account (then promote to `v0.1.0`)
      — only remaining hard gate before release; inventory T6 code/docs polish is caught up
- [x] Local e2e without product secrets (#91) — specs mint a token via `/auth/dev` on a
      loopback host. Uncovered two first-run bugs on the way: an empty `SESSION_SECRET`
      500ing every auth route, and a localhost `ARTIFACT_ORIGIN` routing the whole app into
      the content-only dispatcher
- [x] Real-time collab e2e — local token mint, editor bundles `@shareout/*` (no bare
      imports), specs assert Yjs live text + presence/cursors/locks/reconnect
      (`tests/e2e/collab-two-users.spec.ts`)
- [x] Re-mirror skill → `shareout-skill` (`getshareout/shareout-skill#4`, from `49389a2`)

## Later

- [ ] Raise coverage floors as critical paths harden
- [ ] npm publish path for `@shareout/sdk` if demand appears (today: monorepo private)
- [ ] Broader mutation rate-limit inventory (threat model open items)
- [ ] Independent sandbox / capability-token review

## Explicit non-goals (public tree)

- Hosted multi-tenant billing product surface as the default self-host path
- Founder deploy scripts (`ship.sh` / staging secrets) in this repo
- Guaranteed response SLA for issues (see SUPPORT.md)

Suggestions and PRs welcome — open an issue before large work ([CONTRIBUTING.md](CONTRIBUTING.md)).
