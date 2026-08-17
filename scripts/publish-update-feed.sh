#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 6 ]]; then
  echo "Usage: publish-update-feed.sh <artifacts> <distribution> <version> <release-tag> <published-at> <site-directory>" >&2
  exit 1
fi

ARTIFACTS="$1"
DISTRIBUTION="$2"
VERSION="$3"
RELEASE_TAG="$4"
PUBLISHED_AT="$5"
SITE="$6"

rm -rf "$SITE"
if git ls-remote --exit-code --heads origin update-feeds >/dev/null 2>&1; then
  git fetch origin update-feeds
  git worktree add -b update-feeds "$SITE" origin/update-feeds
else
  git worktree add --detach "$SITE" HEAD
  git -C "$SITE" switch --orphan update-feeds
  git -C "$SITE" rm -rf .
fi

node scripts/prepare-update-feed.mjs \
  "$ARTIFACTS" \
  "$SITE" \
  "$DISTRIBUTION" \
  "$VERSION" \
  "$RELEASE_TAG" \
  "$PUBLISHED_AT"

touch "$SITE/.nojekyll"
git -C "$SITE" add .
if git -C "$SITE" diff --cached --quiet; then
  echo "Update feed already points to $DISTRIBUTION $VERSION"
  exit 0
fi

git -C "$SITE" config user.name "github-actions[bot]"
git -C "$SITE" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$SITE" commit -m "Publish $DISTRIBUTION update $VERSION"
git -C "$SITE" push origin update-feeds
