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

## FontTools VARC fixtures

Source: [FontTools `Tests/ttLib/data`](https://github.com/fonttools/fonttools/tree/6b407ba72a81af6f41830c096b777646d635364d/Tests/ttLib/data)

The three small fonts in `varc/` cover basic variable components, conditional
component participation, and component axis variation. They verify that editable
binary import rejects compiled VARC semantics explicitly until native conversion
exists, while the retained source boundary reports its separate unsupported
projection capability. See `varc/README.md` for pinned hashes and provenance.

### License

The VARC fixtures are distributed under the FontTools MIT license. See
`varc/LICENSE`.

## Adding Binary Fonts

To add TTF/OTF test files, you can build them from the UFO sources using fontmake:

```bash
pip install fontmake
fontmake -u MutatorSansLightCondensed.ufo -o ttf
fontmake -u MutatorSansLightCondensed.ufo -o otf
```

Or download pre-built binaries from font distribution sources.
