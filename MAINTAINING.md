# Maintaining ShareOut (public repo)

Short operator notes for the person with write access to
[getshareout/shareout](https://github.com/getshareout/shareout).

## Branch protection (`main`)

**Only the main maintainer merges to `main`.** Outside contributors open PRs from forks;
they never push to `main` directly.

| Setting | Value |
|---------|--------|
| Require a pull request before merging | On |
| Required approving reviews | **0** (solo maintainer; you review then merge) |
| Require review from Code Owners | On (`.github/CODEOWNERS` → `@leorfer23`) |
| Required status checks | `Checks`, `Gitleaks` (see `.github/workflows/ci.yml`) |
| Require branches to be up to date | On (**strict**) |
| Restrict who can push / merge | **Only `@leorfer23`** |
| Do not allow force pushes | On |
| Do not allow deletions | On |
| Require conversation resolution | On |
| Enforce for admins | Off (emergency escape hatch only) |

GitHub UI: **Settings → Branches → Branch protection rules** for `main`.
API-applied 2026-07-25; re-check after org/team changes.

Also enable **Security → Code security → Private vulnerability reporting**
(see [SECURITY.md](SECURITY.md)) if not already on.

## Who merges

| Actor | Access |
|-------|--------|
| **@leorfer23** (you) | Admin; sole person allowed to push/merge to `main` under branch restrictions |
| Outside contributors | Fork → PR only; no write on `main` |
| Future co-maintainers | Add as org collaborator **and** to branch restriction users list + CODEOWNERS |

Do not grant write on this repo casually. Triage/read is enough for helpers who only comment.

## Merge style

Prefer **merge commits** for OSS readiness / multi-commit history PRs (same as #1, #3, #22, #23).
Squash is fine for tiny single-commit fixes.

## Dependabot

Config: `.github/dependabot.yml` — low open-PR limits and grouped production/dev updates
so Actions runners are not saturated. Cancel stuck Dependabot runs if they block product CI.

## Releases

See [RELEASING.md](RELEASING.md). Pre-release tag: `v0.1.0-pre` after Deploy-button verification.

## Worktrees

Product work often uses git worktrees so agents do not stomp each other:

```bash
git fetch origin main
git worktree add ../shareout-wt-<topic> -b chore/<topic> origin/main
```

## CI truth

- Public: `.github/workflows/ci.yml`
- Local mirror: `./tooling/scripts/ci-check.sh`
- Fast pre-push: `./tooling/scripts/ci-check-fast.sh` + `install-hooks.sh`
