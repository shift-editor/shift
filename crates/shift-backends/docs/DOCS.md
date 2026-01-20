# shift-backends

Font format backends for reading and writing various font formats.

## Overview

shift-backends provides a trait-based abstraction for font I/O operations. It decouples shift-core from specific file formats, allowing the editor to work with UFO, TTF, OTF, and potentially other formats through a unified interface.

Currently implements:
- **UFO**: Full read/write support via `norad`

Planned:
- **TTF/OTF**: Read via `skrifa`, compile via `fontc`

## Architecture

```
Traits
├── FontReader - Load font from path
├── FontWriter - Save font to path
└── FontBackend - Combined reader + writer

UFO Backend
├── UfoBackend - Convenience struct implementing FontBackend
├── UfoReader - norad::Font → shift_ir::Font
└── UfoWriter - shift_ir::Font → norad::Font
```

### Key Design Decisions

1. **Trait-Based**: Backends implement traits, enabling polymorphism
2. **Format-Agnostic IR**: Backends convert to/from shift-ir types
3. **Send + Sync**: All backends must be thread-safe
4. **String Errors**: Simple error handling via Result<_, String>
5. **Stateless**: Reader/Writer structs have no internal state

## Key Concepts

### FontReader Trait

The primary interface for loading fonts:

```rust
pub trait FontReader: Send + Sync {
    fn load(&self, path: &str) -> Result<Font, String>;

    // Default implementations
    fn get_glyph(&self, font: &Font, name: &GlyphName) -> Option<Glyph>;
    fn get_kerning(&self, font: &Font) -> KerningData;
    fn get_features(&self, font: &Font) -> FeatureData;
}
```

### FontWriter Trait

The primary interface for saving fonts:

```rust
pub trait FontWriter: Send + Sync {
    fn save(&self, font: &Font, path: &str) -> Result<(), String>;
}
```

### FontBackend Trait

Combines reader and writer for formats that support both:

```rust
pub trait FontBackend: FontReader + FontWriter {}

// Auto-implemented for any type with both traits
impl<T: FontReader + FontWriter> FontBackend for T {}
```

## UFO Backend

### UfoReader

Converts from norad's representation to shift-ir:

```rust
use shift_backends::ufo::UfoReader;
use shift_backends::FontReader;

let reader = UfoReader::new();
let font = reader.load("/path/to/font.ufo")?;
```

The reader handles:
- Font metadata (family name, style, version, etc.)
- Font metrics (UPM, ascender, descender, etc.)
- All layers (default and named layers)
- Glyphs with all layer data
- Contours, components, anchors, guidelines
- Kerning groups and pairs
- OpenType features (features.fea)
- Lib data (arbitrary plist storage)

### UfoWriter

Converts from shift-ir to norad and saves:

```rust
use shift_backends::ufo::UfoWriter;
use shift_backends::FontWriter;

let writer = UfoWriter::new();
writer.save(&font, "/path/to/output.ufo")?;
```

The writer handles the same data in reverse, ensuring round-trip fidelity.

### UfoBackend

Convenience struct combining both:

```rust
use shift_backends::ufo::UfoBackend;
use shift_backends::FontBackend;

let backend = UfoBackend;
let font = backend.load("/path/to/font.ufo")?;
// ... modify font ...
backend.save(&font, "/path/to/font.ufo")?;
```

## Type Conversions

### Point Types

| norad | shift-ir | Notes |
|-------|----------|-------|
| `Move` | `OnCurve` | First point of open contour |
| `Line` | `OnCurve` | Straight line segment |
| `Curve` | `OnCurve` | End of cubic bezier |
| `OffCurve` | `OffCurve` | Cubic bezier handle |
| `QCurve` | `QCurve` | Quadratic curve point |

When writing, the OnCurve type is disambiguated based on context:
- First point of open contour → `Move`
- Point following OffCurve → `Curve`
- Otherwise → `Line`

### Kerning

Groups are identified by naming convention:
- `public.kern1.*` → First side (left) kerning groups
- `public.kern2.*` → Second side (right) kerning groups

```rust
// Reading
for (key, members) in norad_font.groups.iter() {
    if key.starts_with("public.kern1.") {
        kerning.set_group1(key, members);
    } else if key.starts_with("public.kern2.") {
        kerning.set_group2(key, members);
    }
}

// Writing
for (group_name, members) in font.kerning().groups1() {
    norad_font.groups.insert(group_name, members);
}
```

### Lib Data

Arbitrary plist data is preserved through `LibData` and `LibValue`:

```rust
pub enum LibValue {
    String(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Array(Vec<LibValue>),
    Dict(HashMap<String, LibValue>),
    Data(Vec<u8>),
}
```

## Usage Examples

### Basic Load/Save

```rust
use shift_backends::ufo::{UfoReader, UfoWriter};
use shift_backends::{FontReader, FontWriter};

// Load
let reader = UfoReader::new();
let font = reader.load("input.ufo")?;

// Modify
font.metadata_mut().style_name = Some("Bold".to_string());

// Save
let writer = UfoWriter::new();
writer.save(&font, "output.ufo")?;
```

### Round-Trip Test

```rust
let original = create_test_font();
let writer = UfoWriter::new();
writer.save(&original, "/tmp/test.ufo")?;

let reader = UfoReader::new();
let loaded = reader.load("/tmp/test.ufo")?;

assert_eq!(loaded.metadata().family_name, original.metadata().family_name);
assert_eq!(loaded.glyph_count(), original.glyph_count());
```

### Using Trait Objects

```rust
fn process_font(reader: &dyn FontReader, writer: &dyn FontWriter, input: &str, output: &str) -> Result<(), String> {
    let font = reader.load(input)?;
    // ... process font ...
    writer.save(&font, output)?;
    Ok(())
}

let reader = UfoReader::new();
let writer = UfoWriter::new();
process_font(&reader, &writer, "in.ufo", "out.ufo")?;
```

## Adding New Backends

To add support for a new format:

1. Create a new module (e.g., `src/otf/`)
2. Implement `FontReader` for loading
3. Implement `FontWriter` for saving (if applicable)
4. Add conversion functions between format types and shift-ir types
5. Export from `lib.rs`

Example skeleton:

```rust
// src/otf/mod.rs
mod reader;
pub use reader::OtfReader;

// src/otf/reader.rs
use crate::traits::FontReader;
use shift_ir::Font;

pub struct OtfReader;

impl FontReader for OtfReader {
    fn load(&self, path: &str) -> Result<Font, String> {
        // Use skrifa to read, convert to shift-ir types
        todo!()
    }
}
```

## Data Flow

```
UFO File System
├── metainfo.plist
├── fontinfo.plist
├── kerning.plist
├── groups.plist
├── features.fea
├── lib.plist
└── glyphs/
    └── *.glif
        ↓
    norad::Font::load()
        ↓
    UfoReader (conversion)
        ↓
    shift_ir::Font
        ↓
    UfoWriter (conversion)
        ↓
    norad::Font::save()
        ↓
UFO File System
```

## Related Systems

- [shift-ir](../../shift-ir/docs/DOCS.md) - The IR types this crate converts to/from
- [shift-core](../../shift-core/docs/DOCS.md) - Uses backends for font loading
- [shift-node](../../shift-node/docs/DOCS.md) - Exposes backend functionality to JS
