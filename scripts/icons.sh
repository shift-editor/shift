#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
icons_dir="$repo_root/icons"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/shift-icons.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT

for command in magick xcrun; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [[ $(uname -s) != "Darwin" ]]; then
  echo "Icon Composer assets require macOS and Xcode 26 or newer." >&2
  exit 1
fi

developer_dir=$(xcode-select -p)
icon_tool="$(dirname "$developer_dir")/Applications/Icon Composer.app/Contents/Executables/ictool"
if [[ ! -x $icon_tool ]]; then
  echo "Icon Composer command-line tool not found: $icon_tool" >&2
  exit 1
fi

compile_icon() {
  local name=$1
  local bundle="$icons_dir/$name.icon"
  local output="$work_dir/$name"
  local preview="$output/preview.png"

  if [[ ! -d $bundle ]]; then
    echo "Icon Composer source not found: $bundle" >&2
    exit 1
  fi

  mkdir -p "$output/compiled"
  cp -R "$bundle" "$output/Icon.icon"

  xcrun actool "$output/Icon.icon" \
    --compile "$output/compiled" \
    --output-format human-readable-text \
    --notices \
    --warnings \
    --output-partial-info-plist "$output/compiled/assetcatalog_generated_info.plist" \
    --app-icon Icon \
    --include-all-app-icons \
    --accent-color AccentColor \
    --enable-on-demand-resources NO \
    --development-region en \
    --target-device mac \
    --minimum-deployment-target 26.0 \
    --platform macosx >/dev/null

  cp "$output/compiled/Icon.icns" "$icons_dir/$name.icns"

  "$icon_tool" "$bundle" \
    --export-image \
    --output-file "$preview" \
    --platform macOS \
    --rendition Default \
    --width 824 \
    --height 824 \
    --scale 1 >/dev/null

  # Icon Composer exports edge-to-edge; macOS app icons occupy an 824px region
  # centered on the standard 1024px canvas.
  magick "$preview" \
    -background none \
    -gravity center \
    -extent 1024x1024 \
    -strip \
    -depth 8 \
    "PNG32:$icons_dir/$name-macos.png"
}

resize_png() {
  local source=$1
  local size=$2
  local destination=$3

  magick "$source" -resize "${size}x${size}" -strip -depth 8 "PNG32:$destination"
}

generate_ico() {
  local source=$1
  local destination=$2
  local output="$work_dir/$(basename "$destination" .ico)-ico"
  local sizes=(16 32 48 64 128 256)
  local images=()

  mkdir -p "$output"
  for size in "${sizes[@]}"; do
    local image="$output/$size.png"
    resize_png "$source" "$size" "$image"
    images+=("$image")
  done

  magick "${images[@]}" "$destination"
}

generate_release_icons() {
  local source="$icons_dir/icon-macos.png"
  local sizes=(16 32 48 64 96 128 192 256 512 1024)

  for size in "${sizes[@]}"; do
    resize_png "$source" "$size" "$icons_dir/icon-${size}x${size}.png"
  done

  cp "$icons_dir/icon-512x512.png" "$icons_dir/icon.png"
  for size in 16 32 48; do
    cp "$icons_dir/icon-${size}x${size}.png" "$icons_dir/favicon-${size}x${size}.png"
  done

  generate_ico "$source" "$icons_dir/icon.ico"
}

generate_nightly_icons() {
  local source="$icons_dir/nightly-macos.png"

  cp "$source" "$icons_dir/nightly.png"
  generate_ico "$source" "$icons_dir/nightly.ico"
}

compile_icon icon
compile_icon nightly
generate_release_icons
generate_nightly_icons

echo "Generated release and nightly icons from icons/*.icon"
