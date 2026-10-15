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

## AnchorPropagation

`AnchorPropagation.glyphs` is a two-master Glyphs source written for anchor
propagation tests. Its composites cover stacked marks, a nested composite, a
vertically flipped and a rotated component, an own anchor overriding a copied
one, `*origin`, a ligature built from components (`f_i`), numbered anchors on a
non-ligature, cursive `entry`/`exit` with a mark on a joining body, marks with
and without their own anchors, and a composite present in one master only.
`AnchorPropagation.test.ts` compares the editor's anchors for every glyph at
every master with what export compiles.

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

## MultiFamily.glyphs

Hand-written. One source that also builds a second family (`Multi Family UI`)
whose instances repeat the main family's locations, a main-family instance at
the same location as another (`Bold Copy`), and a non-exported component part
(`_part`, `export = 0`) used by `A`. Covers family-scoped instance import,
repeated-instance handling, and skipped export.

## LightDefault.glyphs

Hand-written. The default master is the lightest, its design values (stem
widths, 62 to 158) sit below the user default (300), and the user-to-design
mapping comes from the instances' weight classes, as in FiraCode. Covers axis
mapping and interpolation when the default is at one end of the axis.
