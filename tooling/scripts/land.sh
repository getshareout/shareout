#!/usr/bin/env bash
# Land ONE pull request on main so that what merges is exactly what was tested.
#
#   ./tooling/scripts/land.sh [--dry-run] <pr-number>
#
# Feature branches push with light checks only (no tests) and may be far behind main.
# This script, one PR at a time under a machine-wide lock:
#   1. checks out the PR head in a throwaway worktree and rebases it onto origin/main,
#   2. regenerates the committed bundles (check:bundles rewrites them) and commits them
#      if they changed,
#   3. runs the light checks, then test:affected (affected root tests + the suites of
#      any touched sdk/ editor-client/ chat-core/ workspace) against origin/main,
#   4. pushes the rebased branch with --force-with-lease (the pre-push hook runs, as
#      always — hooks are never bypassed),
#   5. squash-merges with --match-head-commit <tested sha>, refusing if main moved.
# Because the PR head then sits directly on main, the squash commit's tree is the tree
# that was tested. Batches of branches still go through integrate.sh.
#
# --dry-run prints the plan (and whether the rebase is likely to conflict) and changes
# nothing: no lock, no worktree, no push, no merge.
#
# Env: SHAREOUT_LAND_LOCK (lock dir, default /tmp/shareout-land.lock),
#      SHAREOUT_LAND_WAIT (seconds to wait for the lock, default 3600).
set -euo pipefail

export TZ="${TZ:-UTC}"
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
PR="${1:-}"
if ! [[ "$PR" =~ ^[0-9]+$ ]] || [ "$#" -ne 1 ]; then
  echo "usage: $0 [--dry-run] <pr-number>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS="$REPO_ROOT/tooling/scripts"
REPO="$(cd "$REPO_ROOT" && gh repo view --json nameWithOwner -q .nameWithOwner)"
LOCK="${SHAREOUT_LAND_LOCK:-/tmp/shareout-land.lock}"
WAIT="${SHAREOUT_LAND_WAIT:-3600}"
DIR="${TMPDIR:-/tmp}"
DIR="${DIR%/}/shareout-land-$PR"
GENERATED=(shareout-app/public shareout-app/src/discovery shareout-app/src/official-skills
  shareout-app/src/data/agent/sdk-reference.generated.ts)

die() { echo "✗ $*" >&2; exit 1; }

# ── PR facts ────────────────────────────────────────────────────────────────────────
INFO="$(gh pr view "$PR" --repo "$REPO" \
  --json state,isDraft,isCrossRepository,baseRefName,headRefName,headRefOid,title \
  --jq '[.state, .isDraft, .isCrossRepository, .baseRefName, .headRefName, .headRefOid, .title] | @tsv')" ||
  die "cannot read PR #$PR in $REPO"
IFS=$'\t' read -r STATE DRAFT FORK BASE_REF HEAD_REF HEAD_SHA TITLE <<< "$INFO"
[ "$STATE" = "OPEN" ] || die "#$PR is $STATE"
[ "$DRAFT" = "false" ] || die "#$PR is a draft"
[ "$FORK" = "false" ] || die "#$PR comes from a fork; land.sh pushes the rebased head, so it needs a branch in $REPO"
[ "$BASE_REF" = "main" ] || die "#$PR targets $BASE_REF, not main"

git -C "$REPO_ROOT" fetch -q origin main "+refs/heads/$HEAD_REF:refs/remotes/origin/$HEAD_REF"
MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"
REMOTE_HEAD="$(git -C "$REPO_ROOT" rev-parse "origin/$HEAD_REF")"
[ "$REMOTE_HEAD" = "$HEAD_SHA" ] || die "origin/$HEAD_REF is $REMOTE_HEAD but GitHub reports $HEAD_SHA for #$PR; retry in a moment"
BEHIND="$(git -C "$REPO_ROOT" rev-list --count "$HEAD_SHA..$MAIN_SHA")"
AHEAD="$(git -C "$REPO_ROOT" rev-list --count "$MAIN_SHA..$HEAD_SHA")"

predict() {
  local out
  if out="$(git -C "$REPO_ROOT" merge-tree --write-tree --name-only "$MAIN_SHA" "$HEAD_SHA" 2>&1)"; then
    echo "clean"
  else
    echo "likely conflicts in: $(printf '%s\n' "$out" | sed -n '2,/^$/p' | grep -v '^$' | tr '\n' ' ')"
  fi
}

cat <<PLAN
Landing #$PR "$TITLE" ($REPO)
  head   $HEAD_REF @ ${HEAD_SHA:0:10} ($AHEAD commit(s), $BEHIND behind main)
  main   ${MAIN_SHA:0:10}
  rebase $(predict)

Plan:
  1. take lock $LOCK (waits up to ${WAIT}s; a lock whose pid is gone is stale)
  2. git worktree add --detach $DIR ${HEAD_SHA:0:10}; git rebase origin/main
  3. tooling/scripts/install-deps.sh shareout-app
  4. npm run check:bundles; commit regenerated ${GENERATED[*]} if changed
  5. SHAREOUT_CHECK_MODE=light SHAREOUT_TEST_BASE=origin/main tooling/scripts/ci-check-fast.sh
  6. SHAREOUT_TEST_BASE=origin/main npm run test:affected   (root tests + touched workspace suites)
  7. git push --force-with-lease=refs/heads/$HEAD_REF:${HEAD_SHA:0:10} origin HEAD:refs/heads/$HEAD_REF   (pre-push hook runs)
  8. refuse if origin/main moved from ${MAIN_SHA:0:10}
  9. gh pr merge $PR --repo $REPO --squash --match-head-commit <rebased sha> --delete-branch
 10. remove $DIR, release the lock
PLAN

if [ "$DRY" = "1" ]; then
  if [ -d "$LOCK" ]; then
    echo ""
    echo "(lock currently held: $(tr '\n' ' ' < "$LOCK/owner" 2>/dev/null || echo 'no owner file'))"
  fi
  echo ""
  echo "--dry-run: nothing changed."
  exit 0
fi

# ── Lock ────────────────────────────────────────────────────────────────────────────
OWNED=0
release() { [ "$OWNED" = "1" ] && rm -rf "$LOCK"; OWNED=0; }
lock_stale() {
  local pid host
  pid="$(sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null)"
  host="$(sed -n 's/^host=//p' "$LOCK/owner" 2>/dev/null)"
  if [ -z "$pid" ]; then
    # Owner file not written yet, or the writer died between mkdir and write.
    [ -n "$(find "$LOCK" -maxdepth 0 -mmin +2 2>/dev/null)" ]
    return
  fi
  [ "$host" = "$(hostname)" ] && ! kill -0 "$pid" 2>/dev/null
}
take_lock() {
  local waited=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    if lock_stale; then
      echo "==> removing stale lock ($(tr '\n' ' ' < "$LOCK/owner" 2>/dev/null))"
      # mv is atomic: if two landers both see it stale, only one moves it.
      mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null && rm -rf "$LOCK.stale.$$"
      continue
    fi
    [ "$waited" -ge "$WAIT" ] && die "lock $LOCK still held after ${WAIT}s: $(tr '\n' ' ' < "$LOCK/owner" 2>/dev/null)"
    [ $((waited % 60)) -eq 0 ] && echo "==> waiting for lock: $(tr '\n' ' ' < "$LOCK/owner" 2>/dev/null)"
    sleep 10
    waited=$((waited + 10))
  done
  OWNED=1
  printf 'pid=%s\nhost=%s\npr=%s\nstarted=%s\n' "$$" "$(hostname)" "$PR" "$(date -u +%FT%TZ)" > "$LOCK/owner"
}

LANDED=0
CREATED=0
cleanup() {
  release
  if [ "$CREATED" = "1" ]; then
    if [ "$LANDED" = "1" ]; then
      git -C "$REPO_ROOT" worktree remove --force "$DIR"
    else
      echo "  worktree kept for inspection: $DIR"
      echo "  remove it with: git worktree remove --force $DIR"
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo ""
echo "==> lock"
take_lock

# Main may have moved while we waited.
git -C "$REPO_ROOT" fetch -q origin main "+refs/heads/$HEAD_REF:refs/remotes/origin/$HEAD_REF"
MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"
[ "$(git -C "$REPO_ROOT" rev-parse "origin/$HEAD_REF")" = "$HEAD_SHA" ] || die "$HEAD_REF moved while waiting for the lock; re-run"
[ -e "$DIR" ] && die "$DIR exists (a previous run's worktree?): git worktree remove --force $DIR"

echo "==> worktree $DIR, rebase onto origin/main (${MAIN_SHA:0:10})"
git -C "$REPO_ROOT" worktree add -q --detach "$DIR" "$HEAD_SHA"
CREATED=1
cd "$DIR"
if ! git rebase -q "$MAIN_SHA"; then
  git diff --name-only --diff-filter=U >&2 || true
  git rebase --abort || true
  die "#$PR does not rebase cleanly onto main; rebase $HEAD_REF yourself, push, re-run"
fi

"$SCRIPTS/install-deps.sh" "$DIR/shareout-app" worker

echo "==> regenerate committed bundles"
(cd shareout-app && npm run -s check:bundles >/dev/null 2>&1) || true
if ! git diff --quiet; then
  git add -A -- "${GENERATED[@]}"
  git diff --quiet || die "check:bundles changed files outside the generated paths: $(git diff --name-only | tr '\n' ' ')"
  git commit -q -m "chore(bundles): regenerate after rebase onto main"
  echo "    committed regenerated bundles"
fi
NEW_SHA="$(git rev-parse HEAD)"

echo "==> light checks"
SHAREOUT_CHECK_MODE=light SHAREOUT_TEST_BASE="$MAIN_SHA" "$DIR/tooling/scripts/ci-check-fast.sh"

echo "==> affected tests"
(cd shareout-app && SHAREOUT_TEST_BASE="$MAIN_SHA" npm run test:affected)

echo "==> push ${NEW_SHA:0:10} to $HEAD_REF"
git push --force-with-lease="refs/heads/$HEAD_REF:$HEAD_SHA" origin "HEAD:refs/heads/$HEAD_REF"

git -C "$REPO_ROOT" fetch -q origin main
[ "$(git -C "$REPO_ROOT" rev-parse origin/main)" = "$MAIN_SHA" ] ||
  die "main moved during the run; the tested result is no longer what would merge. Re-run land.sh $PR"

# GitHub may take a moment to see the push as the PR head.
for _ in $(seq 1 30); do
  [ "$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid)" = "$NEW_SHA" ] && break
  sleep 2
done

echo "==> merge #$PR (squash, head must be ${NEW_SHA:0:10})"
# Outside any checkout, so gh only deletes the remote branch: the local one may be
# checked out in the author's worktree.
(cd / && gh pr merge "$PR" --repo "$REPO" --squash --match-head-commit "$NEW_SHA" --delete-branch)
LANDED=1

echo ""
echo "✓ #$PR landed on main (tested ${NEW_SHA:0:10} on ${MAIN_SHA:0:10})"
