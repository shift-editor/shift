#!/usr/bin/env bash
# Builds Solenoid.shift, a small font with glyph axes, swaps and component
# conditions, through shift-cli.
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
  {"name": "H", "location": {"BLED": 50}, "layer": {"advance": 720, "components": [{"base": "dot", "location": {"SPRD": 80}}, {"base": "dot", "transform": [1, 0, 0, 1, 500, 0]}]}},
  {"name": "dollar.bled", "source": "Regular", "layer": {"advance": 500, "svgPath": "M50 0 L450 0 L450 600 L50 600 Z"}},
  {"name": "dollar.bled", "source": "Bled", "layer": {"advance": 500, "svgPath": "M30 -20 L470 -20 L470 620 L30 620 Z"}},
  {"name": "dollar.heavy", "source": "Regular", "layer": {"advance": 500, "svgPath": "M0 0 L500 0 L250 700 Z"}},
  {"name": "dollar.heavy", "source": "Bled", "layer": {"advance": 500, "svgPath": "M-20 -20 L520 -20 L250 720 Z"}},
  {"name": "dollar", "unicodes": ["U+0024"], "source": "Regular", "layer": {"advance": 500, "svgPath": "M200 0 L300 0 L300 700 L200 700 Z"}},
  {"name": "dollar", "unicodes": ["U+0024"], "source": "Bled", "layer": {"advance": 500, "svgPath": "M180 -20 L320 -20 L320 720 L180 720 Z"}},
  {"name": "colon", "source": "Regular", "layer": {"advance": 1000, "components": [{"base": "dot"}, {"base": "dot", "transform": [1, 0, 0, 1, 300, 0]}, {"base": "dot", "transform": [1, 0, 0, 1, 600, 0]}]}},
  {"name": "colon", "source": "Bled", "layer": {"advance": 1000, "components": [{"base": "dot"}, {"base": "dot", "transform": [1, 0, 0, 1, 300, 0]}, {"base": "dot", "transform": [1, 0, 0, 1, 600, 0]}]}}
]}
JSON
"$cli" glyph set "$out" --input "$work/glyphs.json"

# dollar swaps to dollar.bled from Bleed 70; dollar.heavy, from 80, is never used.
"$cli" glyph swap add "$out" dollar dollar.bled --when "Bleed >= 70"
"$cli" glyph swap add "$out" dollar dollar.heavy --when "Bleed >= 80"
# colon's second and third dots draw up to Bleed 50, its first everywhere.
"$cli" component condition set "$out" colon 2 --when "Bleed <= 50"
"$cli" component condition set "$out" colon 3 --when "Bleed <= 50"
