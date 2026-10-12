#!/usr/bin/env bash
# Installs a Shift DEB on clean Debian-family systems and fails if any packaged
# executable, shared library, or native module links a library the DEB's
# declared dependencies do not install, or a glibc symbol version the system
# lacks. CI runners preinstall many desktop libraries, so a smoke test on the
# runner itself cannot catch a missing one.
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: check-deb-libraries.sh <package.deb>" >&2
  exit 2
fi

DEB_DIRECTORY="$(cd "$(dirname "$1")" && pwd)"
DEB_NAME="$(basename "$1")"
# Ubuntu 18.04 (glibc 2.27) is the oldest supported system. Ubuntu 24.04 names
# ALSA libasound2t64; Debian 12 still names it libasound2.
IMAGES=(ubuntu:18.04 ubuntu:24.04 debian:12)

for image in "${IMAGES[@]}"; do
  echo "Checking $DEB_NAME on $image"
  docker run --rm \
    --volume "$DEB_DIRECTORY:/packages:ro" \
    --env DEB_NAME="$DEB_NAME" \
    "$image" \
    bash -euo pipefail -c '
      export DEBIAN_FRONTEND=noninteractive DEBCONF_NOWARNINGS=yes
      apt-get update -qq >/dev/null
      apt-get install --yes --quiet=2 "/packages/$DEB_NAME" >/dev/null
      PACKAGE="$(dpkg-deb --field "/packages/$DEB_NAME" Package)"
      MISSING="$(
        dpkg --listfiles "$PACKAGE" \
          | while IFS= read -r file; do
              [[ -f "$file" && ( -x "$file" || "$file" == *.so* || "$file" == *.node ) ]] || continue
              ldd "$file" 2>&1 \
                | sed -n -e "s|^\s*\(\S*\) => not found|$file: \1|p" -e "s|^.*\(version .* not found\).*|$file: \1|p" \
                || true
            done
      )"
      if [[ -n "$MISSING" ]]; then
        echo "Unresolved shared libraries after installing $PACKAGE:" >&2
        echo "$MISSING" >&2
        exit 1
      fi
    '
done
