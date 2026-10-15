#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools>=4.50"]
# ///
"""Fetch the web-platform-tests MathML fonts and store them as OpenType.

Each WPT math font gives one or two MATH values a distinct, large number
(e.g. FractionNumeratorGapMin = 9000) and leaves the rest at zero, so a
layout test can tell exactly which constant moved a box. WPT ships them as
WOFF; read-fonts reads plain sfnt, so they are unwrapped here.

Usage: uv run crates/rumil/scripts/fetch-wpt-fonts.py
"""

from __future__ import annotations

import io
import json
import pathlib
import urllib.request

from fontTools.ttLib import TTFont

WPT_COMMIT = "8834c3701b4dd272e778c8d16759c1229ad56bce"
LISTING_URL = f"https://api.github.com/repos/web-platform-tests/wpt/contents/fonts/math?ref={WPT_COMMIT}"
RAW_URL = f"https://raw.githubusercontent.com/web-platform-tests/wpt/{WPT_COMMIT}/fonts/math"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fonts" / "wpt"


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    listing = json.loads(fetch(LISTING_URL))
    names = sorted(entry["name"] for entry in listing if entry["name"].endswith(".woff"))
    for name in names:
        font = TTFont(io.BytesIO(fetch(f"{RAW_URL}/{name}")))
        font.flavor = None
        out_path = OUT_DIR / pathlib.Path(name).with_suffix(".otf")
        font.save(out_path)
        print(out_path.relative_to(OUT_DIR.parent.parent.parent))
    print(f"{len(names)} fonts from WPT {WPT_COMMIT[:12]}")


if __name__ == "__main__":
    main()
