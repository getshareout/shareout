# Maintaining ShareOut (public repo)

Short operator notes for the person with write access to
[getshareout/shareout](https://github.com/getshareout/shareout).

## `main` has no branch protection

**Only the main maintainer merges to `main`.** Outside contributors open PRs from forks;
they never push to `main` directly. Agents push feature branches and open PRs; they merge
only when the maintainer says so.

That is a convention, not a GitHub setting: `main` has no branch protection and no
rulesets, and there is no hosted CI whose checks could be required. The gate is local —
see [CI truth](#ci-truth). Nothing on GitHub blocks a force-push to `main` or deleting
it either: never do either. Re-check the setting with
`gh api repos/getshareout/shareout/branches/main --jq .protected` (`false` as of
2026-10-25).

Also enable **Security → Code security → Private vulnerability reporting**
(see [SECURITY.md](SECURITY.md)) if not already on.

## Who merges

| Actor | Access |
|-------|--------|
| **@leorfer23** (you) | Admin; the only collaborator with write access, so the only one who can push or merge to `main` |
| Outside contributors | Fork → PR only; no write access |
| Future co-maintainers | Add as org collaborator **and** to CODEOWNERS |

Do not grant write on this repo casually. Triage/read is enough for helpers who only comment.

## Merge style

Squash-merge (`gh pr merge <n> --squash`): one commit per PR on `main`. An
`integrate.sh` PR that carries other open PRs can land as a merge commit instead
(`--merge`); that keeps their commits, so GitHub marks those PRs merged too.

## Dependabot

Config: `.github/dependabot.yml` — low open-PR limits and grouped production/dev updates
so the PR list stays manageable. Dependabot PRs get no hosted checks: run
`./tooling/scripts/ci-check.sh` on the branch before merging one.

## Releases

See [RELEASING.md](RELEASING.md). Pre-release tag: `v0.1.0-pre` after Deploy-button verification.

## Worktrees

Product work uses git worktrees so agents do not stomp each other:

```bash
./tooling/scripts/new-worktree.sh <branch>   # → ../shareout-wt/<last part of the branch>, off origin/main
```

It clones `node_modules` from the primary checkout (copy-on-write) and installs the
shared pre-push hook.

## CI truth

There is no hosted CI (no GitHub Actions), by design. Checks run on the machine that
pushes; [AGENTS.md → Gate contract](AGENTS.md#gate-contract) is the contract.

- Pre-push hook (`./tooling/scripts/install-hooks.sh`, once per machine): light checks
  (no tests) on feature branches; tests on pushes to `main` and `integration/*`
- Full suite, once per landing: `./tooling/scripts/integrate.sh -n <name> <branch>…`
- Everything, including audit and the docs build: `./tooling/scripts/ci-check.sh`
  (add `SHAREOUT_COVERAGE=1` for coverage floors)
