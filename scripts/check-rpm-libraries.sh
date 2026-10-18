#!/usr/bin/env bash
# Installs a Shift RPM on clean Rocky Linux 8 (glibc 2.28, the oldest supported
# RPM system) and Rocky Linux 9 systems, and fails if any packaged executable, shared library, or
# native module links a missing library or a newer glibc symbol version. It then
# loads the native bridge with the distribution's Node.js (packaged builds disable
# Electron's RunAsNode fuse) and runs shift-cli, since ldd alone does not prove
# that every symbol resolves.
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: check-rpm-libraries.sh <package.rpm>" >&2
  exit 2
fi

RPM_DIRECTORY="$(cd "$(dirname "$1")" && pwd)"
RPM_NAME="$(basename "$1")"
IMAGES=(rockylinux:8 rockylinux:9)

for image in "${IMAGES[@]}"; do
  echo "Checking $RPM_NAME on $image"
  docker run --rm \
    --volume "$RPM_DIRECTORY:/packages:ro" \
    --env RPM_NAME="$RPM_NAME" \
    "$image" \
    bash -euo pipefail -c '
      dnf install --assumeyes --quiet "/packages/$RPM_NAME" >/dev/null
      PACKAGE="$(rpm --query --package --queryformat "%{NAME}" "/packages/$RPM_NAME")"
      UNRESOLVED="$(
        rpm --query --list "$PACKAGE" \
          | while IFS= read -r file; do
              [[ -f "$file" && ! -L "$file" && ( -x "$file" || "$file" == *.so* || "$file" == *.node ) ]] || continue
              ldd "$file" 2>&1 \
                | sed -n -e "s|^\s*\(\S*\) => not found|$file: \1|p" -e "s|^.*\(version .* not found\).*|$file: \1|p" \
                || true
            done
      )"
      if [[ -n "$UNRESOLVED" ]]; then
        echo "Unresolved libraries or symbol versions after installing $PACKAGE:" >&2
        echo "$UNRESOLVED" >&2
        exit 1
      fi

      BRIDGE="$(rpm --query --list "$PACKAGE" | grep -m1 "shift-bridge\..*\.node$")"
      CLI="$(rpm --query --list "$PACKAGE" | grep -m1 "/bin/shift-cli[^/]*$")"
      dnf install --assumeyes --quiet nodejs >/dev/null
      node --eval "require(process.argv[1])" "$BRIDGE"
      "$CLI" --version
    '
done
