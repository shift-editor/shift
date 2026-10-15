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

## Adding Binary Fonts

To add TTF/OTF test files, you can build them from the UFO sources using fontmake:

```bash
pip install fontmake
fontmake -u MutatorSansLightCondensed.ufo -o ttf
fontmake -u MutatorSansLightCondensed.ufo -o otf
```

Or download pre-built binaries from font distribution sources.

## LightDefault.glyphs

Hand-written. The default master is the lightest, its design values (stem
widths, 62 to 158) sit below the user default (300), and the user-to-design
mapping comes from the instances' weight classes, as in FiraCode. Covers axis
mapping and interpolation when the default is at one end of the axis.
