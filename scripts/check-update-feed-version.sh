#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: check-update-feed-version.sh <distribution> <proposed-version>" >&2
  exit 1
fi

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRIBUTION="$1"
VERSION="$2"
if [[ "$DISTRIBUTION" != "release" && "$DISTRIBUTION" != "nightly" ]]; then
  echo "Expected release or nightly distribution, received: $DISTRIBUTION" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9A-Za-z.-]+$ ]]; then
  echo "Unsafe update version: $VERSION" >&2
  exit 1
fi

if ! REMOTE_REFS="$(git ls-remote --heads origin update-feeds)"; then
  echo "Could not inspect the remote update-feeds branch" >&2
  exit 1
fi
if [[ -z "$REMOTE_REFS" ]]; then
  echo "No existing update-feeds branch"
  exit 0
fi

git fetch --no-tags origin update-feeds
REVISION="origin/update-feeds"
VERSION_PATH="updates/$DISTRIBUTION/$VERSION"
if git cat-file -e "$REVISION:$VERSION_PATH" 2>/dev/null; then
  echo "Update feed version already exists: $DISTRIBUTION $VERSION" >&2
  exit 1
fi

CHANNEL_PATH="updates/$DISTRIBUTION/channel.json"
if ! git cat-file -e "$REVISION:$CHANNEL_PATH" 2>/dev/null; then
  echo "No existing $DISTRIBUTION update channel"
  exit 0
fi

CHANNEL_FILE="$(mktemp)"
trap 'rm -f "$CHANNEL_FILE"' EXIT
git show "$REVISION:$CHANNEL_PATH" > "$CHANNEL_FILE"
node "$REPOSITORY_ROOT/scripts/check-update-channel.mjs" \
  "$CHANNEL_FILE" \
  "$DISTRIBUTION" \
  "$VERSION"
