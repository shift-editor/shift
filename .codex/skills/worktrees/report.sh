#!/usr/bin/env bash
# Lists every worktree of the repository with what removing it would lose and
# what it costs on disk. Read-only: it deletes nothing.
#
# Usage: report.sh [--prs]
#   --prs  also look up each branch's pull request state with gh (slower)

set -euo pipefail

with_prs=false
[[ "${1:-}" == "--prs" ]] && with_prs=true

git fetch --quiet origin 2>/dev/null || true

size_of() {
  [[ -d "$1" ]] && du -sh "$1" 2>/dev/null | cut -f1 || echo "-"
}

printf '%-70s %-40s %6s %8s %8s %8s %s\n' WORKTREE BRANCH DIRTY UNPUSHED TARGET MODULES PR
path=""
branch=""
prunable=""
report() {
  [[ -z "$path" ]] && return
  local dirty="-" unpushed="-" pr="-"
  if [[ -n "$prunable" ]]; then
    dirty="gone"
  elif [[ -d "$path" ]]; then
    dirty=$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    # Commits no remote branch has: what removing the worktree and its branch would lose.
    unpushed=$(git -C "$path" rev-list --count HEAD --not --remotes 2>/dev/null || echo "?")
  fi
  if $with_prs && [[ "$branch" != "(detached)" ]]; then
    pr=$(gh pr list --head "$branch" --state all --limit 1 --json number,state \
      --jq '.[0] | if . then "#\(.number) \(.state)" else "none" end' 2>/dev/null || echo "?")
  fi
  printf '%-70s %-40s %6s %8s %8s %8s %s\n' "$path" "$branch" "$dirty" "$unpushed" \
    "$(size_of "$path/target")" "$(size_of "$path/node_modules")" "$pr"
}

while IFS= read -r line; do
  case "$line" in
    "worktree "*) report; path=${line#worktree }; branch="(detached)"; prunable="" ;;
    "branch "*) branch=${line#branch refs/heads/} ;;
    "prunable"*) prunable=yes ;;
  esac
done < <(git worktree list --porcelain)
report

echo
df -h / | tail -1 | awk '{print "Disk: " $4 " free of " $2}'
