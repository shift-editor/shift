# Test Fonts

This directory contains font files used for integration testing.

## MutatorSans

Source: https://github.com/googlefonts/fontmake/tree/main/tests/data/MutatorSans

MutatorSans is a variable font test family created by Erik van Blokland. It's widely used
in font tooling projects for testing font loading, editing, and round-trip operations.

### Files

| File                             | Format       | Purpose                                         |
| -------------------------------- | ------------ | ----------------------------------------------- |
| `MutatorSansLightCondensed.ufo/` | UFO 3        | Primary test font for UFO read/write operations |
| `MutatorSans.ttf`                | TrueType     | Binary font loading tests (add manually)        |
| `MutatorSans.otf`                | OpenType/CFF | Binary font loading tests (add manually)        |

### Key Metrics

- **UPM**: 1000
- **Glyph count**: ~54 glyphs
- **Notable glyphs**: Standard Latin alphabet plus special test glyphs

### License

MutatorSans is licensed under the SIL Open Font License. See `LICENSE` in the mutatorsans directory.

## AnchorDragBench

`AnchorDragBench.glyphs` is a generated one-master font for text-run redraw and anchor-drag
performance measurements. It has `a`–`z` (two rings and a stem each, with `top`/`bottom`
anchors), five combining marks with `_top` and `top` anchors, and the composites `ǖ ǘ ǚ ü ú ù ū`
built on `u` with their marks placed on anchors (`ǖ ǘ ǚ` stack a second mark on the first).
Regenerate it with:

```bash
python3 generate_anchor_drag_bench.py AnchorDragBench.glyphs
```

Used by `apps/desktop/src/renderer/src/perf/textRunDraw.bench.ts` and the desktop `perf`
Playwright project.

## Adding Binary Fonts

To add TTF/OTF test files, you can build them from the UFO sources using fontmake:

```bash
pip install fontmake
fontmake -u MutatorSansLightCondensed.ufo -o ttf
fontmake -u MutatorSansLightCondensed.ufo -o otf
```

Or download pre-built binaries from font distribution sources.
