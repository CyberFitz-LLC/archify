#!/usr/bin/env bash
# CyberFitz fork: bring an upstream Archify release into the fork.
#
#   fork/sync-upstream.sh                 # merge the newest upstream release tag not yet synced
#   fork/sync-upstream.sh --tag v2.18.0   # merge a specific upstream tag
#   fork/sync-upstream.sh --pick <sha>... # cherry-pick selected upstream commits only
#   fork/sync-upstream.sh --list          # show what upstream has that the fork does not
#   fork/sync-upstream.sh --continue      # after resolving conflicts on a sync/* branch: regenerate and commit
#
# The script never pushes and never touches the default branch. It leaves a
# sync/* branch for review. Exit codes: 0 synced clean, 10 nothing to do,
# 20 synced with conflicts left for a human or Claude to resolve.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/tt-a1i/archify.git}"
BASE_BRANCH="${BASE_BRANCH:-main}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

mode="release"; tag=""; picks=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) tag="$2"; shift 2 ;;
    --pick) mode="pick"; shift; while [[ $# -gt 0 && "$1" != --* ]]; do picks+=("$1"); shift; done ;;
    --list) mode="list"; shift ;;
    --continue) mode="continue"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$mode" == "continue" ]]; then
  branch="$(git branch --show-current)"
  [[ "$branch" == sync/* ]] || { echo "--continue runs on a sync/* branch (current: $branch)" >&2; exit 2; }
  if git diff --name-only --diff-filter=U | grep -q .; then
    echo "still unresolved:" >&2; git diff --name-only --diff-filter=U >&2; exit 20
  fi
  if git grep -nE '^(<<<<<<<|>>>>>>>) ' -- . ':!fork/sync-upstream.sh' >/dev/null; then
    echo "conflict markers remain:" >&2; git grep -nE '^(<<<<<<<|>>>>>>>) ' -- . ':!fork/sync-upstream.sh' >&2; exit 20
  fi
  ( cd archify && npm ci --no-audit --no-fund >/dev/null )
  node fork/regenerate.mjs --showcase
  [[ "$branch" == sync/upstream-* ]] && echo "${branch#sync/upstream-}" > fork/UPSTREAM_VERSION
  git add -A
  git commit --quiet -m "chore(sync): resolve conflicts and regenerate for ${branch#sync/}"
  echo "resolved on $branch — now run: (cd archify && npm test)"
  exit 0
fi

git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
# Upstream tags live under refs/upstream-tags/* so they can never collide with
# the fork's own release tags.
git fetch --quiet --no-tags upstream "+refs/heads/*:refs/remotes/upstream/*" "+refs/tags/*:refs/upstream-tags/*"

last_synced="$(tr -d '[:space:]' < fork/UPSTREAM_VERSION)"   # tag name or commit sha
resolve() { git rev-parse -q --verify "refs/upstream-tags/$1^{commit}" 2>/dev/null || git rev-parse -q --verify "$1^{commit}"; }
last_commit="$(resolve "$last_synced")"

latest_release() {
  git for-each-ref --format='%(refname:strip=2)' refs/upstream-tags \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}

if [[ "$mode" == "list" ]]; then
  target="${tag:-$(latest_release)}"
  echo "last synced: $last_synced ($last_commit)"
  echo "newest upstream release: $target"
  echo "--- upstream commits not in the fork (skill + viewer only) ---"
  git log --oneline --no-merges "$last_commit..$(resolve "$target")" -- archify viewer scripts
  exit 0
fi

if [[ "$mode" == "pick" ]]; then
  [[ ${#picks[@]} -gt 0 ]] || { echo "--pick needs at least one commit" >&2; exit 2; }
  branch="sync/pick-$(date -u +%Y%m%d-%H%M)"
  git switch --quiet -c "$branch" "$BASE_BRANCH"
  status=0
  for sha in "${picks[@]}"; do
    git cherry-pick -x "$sha" || { status=20; break; }
  done
else
  target="${tag:-$(latest_release)}"
  target_commit="$(resolve "$target")"
  if git merge-base --is-ancestor "$target_commit" "$BASE_BRANCH"; then
    echo "fork already contains upstream $target"; exit 10
  fi
  branch="sync/upstream-$target"
  git switch --quiet -c "$branch" "$BASE_BRANCH"
  status=0
  git merge --no-ff --no-commit "$target_commit" || status=20
fi

# Generated files are rebuilt, never merged: take either side, regenerate below.
generated=(
  archify/assets/template.html
  archify/renderers/shared/generated-validators.mjs
  archify.zip
)
for path in "${generated[@]}" examples/*.html archify/examples/*.html; do
  if git ls-files -u -- "$path" | grep -q .; then
    git checkout --theirs -- "$path" 2>/dev/null || git rm -q --cached "$path" || true
    git add -- "$path" 2>/dev/null || true
  fi
done

remaining="$(git diff --name-only --diff-filter=U)"
if [[ -z "$remaining" ]]; then
  ( cd archify && npm ci --no-audit --no-fund >/dev/null )
  node fork/regenerate.mjs --showcase
  if [[ "$mode" != "pick" ]]; then echo "$target" > fork/UPSTREAM_VERSION; fi
  git add -A
  if [[ "$mode" == "pick" ]]; then
    git commit --quiet -m "chore(sync): regenerate after cherry-pick" || true
  else
    git commit --quiet -m "chore(sync): merge upstream $target into the CyberFitz fork"
  fi
  echo "synced on $branch"
  exit 0
fi

echo "conflicts left on $branch:" >&2
echo "$remaining" >&2
echo "Resolve per fork/FORK.md (keep the fork's intent), then: node fork/regenerate.mjs && (cd archify && npm test)" >&2
exit 20
