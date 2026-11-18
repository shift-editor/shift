#!/usr/bin/env bash
# Builds Solenoid.shift, a small font with glyph axes, through shift-cli.
# Usage: generate_solenoid.sh [shift-cli] [output]
set -euo pipefail

cli=${1:-shift-cli}
out=${2:-"$(dirname "$0")/Solenoid.shift"}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

rm -f "$out"
"$cli" font create "$out"
"$cli" axis add "$out" --tag BLED --name Bleed --min 0 --default 0 --max 100
"$cli" source add "$out" --name Bled --location BLED=100
"$cli" glyph add "$out" dot
"$cli" glyph add "$out" H
"$cli" glyph axis add "$out" dot --name Spread --tag SPRD --min 0 --default 0 --max 100
"$cli" glyph axis add "$out" dot --name Strike --tag STRK --min 0 --default 0 --max 100

cat > "$work/glyphs.json" <<'JSON'
{"format": 1, "glyphs": [
  {"name": "dot", "source": "Regular", "layer": {"advance": 200, "svgPath": "M0 0 L100 0 L100 100 L0 100 Z"}},
  {"name": "dot", "source": "Bled", "layer": {"advance": 200, "svgPath": "M-20 -20 L120 -20 L120 120 L-20 120 Z"}},
  {"name": "dot", "source": "Regular", "location": {"SPRD": 100}, "layer": {"advance": 200, "svgPath": "M0 0 L300 0 L300 100 L0 100 Z"}},
  {"name": "dot", "source": "Regular", "location": {"STRK": 100}, "layer": {"advance": 200, "svgPath": "M0 0 L100 0 L100 300 L0 300 Z"}},
  {"name": "H", "source": "Regular", "layer": {"advance": 720, "components": [{"base": "dot", "location": {"SPRD": 60}}, {"base": "dot", "transform": [1, 0, 0, 1, 500, 0]}]}},
  {"name": "H", "source": "Bled", "layer": {"advance": 720, "components": [{"base": "dot", "location": {"SPRD": 60}}, {"base": "dot", "transform": [1, 0, 0, 1, 500, 0]}]}},
  {"name": "H", "location": {"BLED": 50}, "layer": {"advance": 720, "components": [{"base": "dot", "location": {"SPRD": 80}}, {"base": "dot", "transform": [1, 0, 0, 1, 500, 0]}]}}
]}
JSON
"$cli" glyph set "$out" --input "$work/glyphs.json"
