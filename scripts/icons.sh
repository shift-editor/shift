#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
icons_dir="$repo_root/icons"
renderer_assets_dir="$repo_root/apps/desktop/src/renderer/src/assets"
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

generate_icns() {
  local source=$1
  local destination=$2
  local iconset="$work_dir/$(basename "$destination" .icns).iconset"

  mkdir -p "$iconset"
  resize_png "$source" 16 "$iconset/icon_16x16.png"
  resize_png "$source" 32 "$iconset/icon_16x16@2x.png"
  resize_png "$source" 32 "$iconset/icon_32x32.png"
  resize_png "$source" 64 "$iconset/icon_32x32@2x.png"
  resize_png "$source" 128 "$iconset/icon_128x128.png"
  resize_png "$source" 256 "$iconset/icon_128x128@2x.png"
  resize_png "$source" 256 "$iconset/icon_256x256.png"
  resize_png "$source" 512 "$iconset/icon_256x256@2x.png"
  resize_png "$source" 512 "$iconset/icon_512x512.png"
  resize_png "$source" 1024 "$iconset/icon_512x512@2x.png"
  iconutil --convert icns --output "$destination" "$iconset"
}

generate_document_icons() {
  local source_svg="$icons_dir/shift-document.svg"
  local source="$work_dir/shift-document-mark.png"
  local asset_catalog="$icons_dir/shift-document.xcassets"
  local badge="$asset_catalog/shift-document-badge-v2.iconset"
  local frame="$work_dir/shift-document-frame.svg"
  local document="$work_dir/shift-document.png"
  local sizes=(16 32 48 64 128 256 512 1024)

  sips -s format png "$source_svg" --out "$source" >/dev/null

  rm -rf "$asset_catalog"
  mkdir -p "$badge"
  cat >"$asset_catalog/Contents.json" <<'JSON'
{"info":{"author":"xcode","version":1}}
JSON
  cat >"$badge/Contents.json" <<'JSON'
{
  "images": [
    {"filename":"icon_16x16.png","idiom":"mac","scale":"1x","size":"16x16"},
    {"filename":"icon_16x16@2x.png","idiom":"mac","scale":"2x","size":"16x16"},
    {"filename":"icon_32x32.png","idiom":"mac","scale":"1x","size":"32x32"},
    {"filename":"icon_32x32@2x.png","idiom":"mac","scale":"2x","size":"32x32"},
    {"filename":"icon_128x128.png","idiom":"mac","scale":"1x","size":"128x128"},
    {"filename":"icon_128x128@2x.png","idiom":"mac","scale":"2x","size":"128x128"},
    {"filename":"icon_256x256.png","idiom":"mac","scale":"1x","size":"256x256"},
    {"filename":"icon_256x256@2x.png","idiom":"mac","scale":"2x","size":"256x256"},
    {"filename":"icon_512x512.png","idiom":"mac","scale":"1x","size":"512x512"},
    {"filename":"icon_512x512@2x.png","idiom":"mac","scale":"2x","size":"512x512"}
  ],
  "info": {"author":"xcode","version":1}
}
JSON
  resize_png "$source" 16 "$badge/icon_16x16.png"
  resize_png "$source" 32 "$badge/icon_16x16@2x.png"
  resize_png "$source" 32 "$badge/icon_32x32.png"
  resize_png "$source" 64 "$badge/icon_32x32@2x.png"
  resize_png "$source" 128 "$badge/icon_128x128.png"
  resize_png "$source" 256 "$badge/icon_128x128@2x.png"
  resize_png "$source" 256 "$badge/icon_256x256.png"
  resize_png "$source" 512 "$badge/icon_256x256@2x.png"
  resize_png "$source" 512 "$badge/icon_512x512.png"
  resize_png "$source" 1024 "$badge/icon_512x512@2x.png"

  cat >"$frame" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#000" flood-opacity="0.22"/>
    </filter>
  </defs>
  <path d="M190 48h478l216 216v644c0 38-30 68-68 68H190c-38 0-68-30-68-68V116c0-38 30-68 68-68z"
        fill="#f8f8fa" stroke="#c8c9ce" stroke-width="12" filter="url(#shadow)"/>
  <path d="M668 48v148c0 38 30 68 68 68h148z" fill="#dedfe4" stroke="#c8c9ce" stroke-width="12" stroke-linejoin="round"/>
</svg>
SVG

  magick -background none "$frame" \
    \( "$source" -resize 620x620 \) \
    -gravity center \
    -geometry +0+105 \
    -composite \
    -strip \
    -depth 8 \
    "PNG32:$document"

  for size in "${sizes[@]}"; do
    resize_png "$document" "$size" "$icons_dir/shift-document-${size}x${size}.png"
  done

  cp "$icons_dir/shift-document-512x512.png" "$icons_dir/shift-document.png"
  generate_ico "$document" "$icons_dir/shift-document.ico"
}

generate_release_icons() {
  local source="$icons_dir/icon-macos.png"
  local sizes=(16 32 48 64 96 128 192 256 512 1024)

  cp "$source" "$renderer_assets_dir/app-icon.png"

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

  cp "$source" "$renderer_assets_dir/app-icon-nightly.png"
  cp "$source" "$icons_dir/nightly.png"
  generate_ico "$source" "$icons_dir/nightly.ico"
}

compile_icon icon
compile_icon nightly
generate_release_icons
generate_nightly_icons
generate_document_icons

echo "Generated release, nightly, and Shift document icons"
