#!/usr/bin/env bash
# Deletes main's Rust build caches that a newer cache of the same family has
# replaced. Swatinem/rust-cache ends each key with a hash of Cargo.lock and the
# manifests, so every dependency change saves a new cache beside the old one,
# and nothing deletes the old one. Once the repository passes GitHub's 10 GB,
# GitHub evicts the least recently used caches first, and those were the
# Nightly's, which are read once a day: every Nightly compiled from scratch.
#
# A family is a key without that last part, so each job keeps its newest cache.
# Usage: prune-superseded-caches.sh [ref], with GH_TOKEN allowed to write actions.
set -euo pipefail

REF="${1:-refs/heads/main}"
declare -A newest=()

while IFS=$'\t' read -r id key; do
  family="${key%-*}"
  if [[ -z "${newest[$family]:-}" ]]; then
    newest[$family]="$key"
    continue
  fi

  echo "Deleting $key, replaced by ${newest[$family]}"
  # Another run pruning at the same time may have deleted it already.
  gh cache delete "$id" || echo "Could not delete $key"
done < <(
  gh cache list --ref "$REF" --key v0-rust- --sort created_at --order desc --limit 1000 \
    --json id,key --jq '.[] | [.id, .key] | @tsv'
)
