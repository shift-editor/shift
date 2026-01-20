# shift-backends - LLM Context

## Quick Facts
- **Purpose**: Font format backends for reading and writing various font formats
- **Language**: Rust
- **Key Files**: `traits.rs`, `ufo/mod.rs`, `ufo/reader.rs`, `ufo/writer.rs`
- **Dependencies**: shift-ir, norad, skrifa, fontc, plist
- **Dependents**: shift-core, shift-node

## File Structure
```
src/
├── lib.rs              # Crate root, exports traits and ufo module
├── traits.rs           # FontReader, FontWriter, FontBackend traits
└── ufo/
    ├── mod.rs          # UfoBackend implementing both traits
    ├── reader.rs       # UfoReader - norad → shift-ir conversion
    └── writer.rs       # UfoWriter - shift-ir → norad conversion
```

## Core Abstractions

### FontReader Trait (traits.rs:3-17)
```rust
pub trait FontReader: Send + Sync {
    fn load(&self, path: &str) -> Result<Font, String>;

    // Default implementations using Font methods
    fn get_glyph(&self, font: &Font, name: &GlyphName) -> Option<Glyph>;
    fn get_kerning(&self, font: &Font) -> KerningData;
    fn get_features(&self, font: &Font) -> FeatureData;
}
```

### FontWriter Trait (traits.rs:19-21)
```rust
pub trait FontWriter: Send + Sync {
    fn save(&self, font: &Font, path: &str) -> Result<(), String>;
}
```

### FontBackend Trait (traits.rs:23-25)
```rust
// Combines reader and writer
pub trait FontBackend: FontReader + FontWriter {}
impl<T: FontReader + FontWriter> FontBackend for T {}
```

### UfoBackend (ufo/mod.rs:10-22)
```rust
pub struct UfoBackend;

impl FontReader for UfoBackend {
    fn load(&self, path: &str) -> Result<Font, String> {
        UfoReader::new().load(path)
    }
}

impl FontWriter for UfoBackend {
    fn save(&self, font: &Font, path: &str) -> Result<(), String> {
        UfoWriter::new().save(font, path)
    }
}
```

### UfoReader (ufo/reader.rs:10-15)
```rust
pub struct UfoReader;

impl FontReader for UfoReader {
    fn load(&self, path: &str) -> Result<Font, String> {
        // norad::Font::load(path) → shift_ir::Font
    }
}
```

### UfoWriter (ufo/writer.rs:9-14)
```rust
pub struct UfoWriter;

impl FontWriter for UfoWriter {
    fn save(&self, font: &Font, path: &str) -> Result<(), String> {
        // shift_ir::Font → norad::Font → norad::Font::save(path)
    }
}
```

## Key Patterns

### Trait-Based Backend System
```rust
// Any backend can be used through trait objects
fn process_font<B: FontBackend>(backend: &B, path: &str) -> Result<Font, String> {
    let font = backend.load(path)?;
    // ... modify font ...
    backend.save(&font, path)?;
    Ok(font)
}
```

### Norad Conversion (reader)
```rust
// Convert norad types to shift-ir types
fn convert_point_type(typ: &norad::PointType) -> PointType {
    match typ {
        norad::PointType::Line => PointType::OnCurve,
        norad::PointType::Curve => PointType::OnCurve,
        norad::PointType::OffCurve => PointType::OffCurve,
        norad::PointType::QCurve => PointType::QCurve,
        norad::PointType::Move => PointType::OnCurve,
    }
}
```

### Norad Conversion (writer)
```rust
// Convert shift-ir types to norad types
fn convert_point_type(point: &Point, index: usize, points: &[Point], closed: bool) -> norad::PointType {
    match point.point_type() {
        PointType::OffCurve => norad::PointType::OffCurve,
        PointType::QCurve => norad::PointType::QCurve,
        PointType::OnCurve => {
            // Determine Line vs Curve based on previous point
            if prev_is_offcurve { norad::PointType::Curve }
            else { norad::PointType::Line }
        }
    }
}
```

### Layer Handling
```rust
// Reader: norad layers → shift-ir layers
for layer in norad_font.layers.iter() {
    let layer_id = if layer.name() == "public.default" {
        default_layer_id
    } else {
        font.add_layer(Layer::new(layer.name().to_string()))
    };
    // ... convert glyphs ...
}

// Writer: shift-ir layers → norad layers
for (layer_id, layer) in font.layers() {
    if *layer_id == default_layer_id { continue; }
    let norad_layer = norad_font.layers.new_layer(layer.name())?;
    // ... convert glyphs ...
}
```

## API Surface

| Function/Method | File | Signature |
|----------------|------|-----------|
| `FontReader::load` | traits.rs | `fn load(&self, path: &str) -> Result<Font, String>` |
| `FontWriter::save` | traits.rs | `fn save(&self, font: &Font, path: &str) -> Result<(), String>` |
| `UfoReader::new` | ufo/reader.rs | `fn new() -> Self` |
| `UfoWriter::new` | ufo/writer.rs | `fn new() -> Self` |
| `UfoBackend` | ufo/mod.rs | Unit struct implementing FontBackend |

## Conversion Tables

### norad → shift-ir
| norad Type | shift-ir Type |
|------------|---------------|
| `norad::Font` | `Font` |
| `norad::Glyph` | `Glyph` + `GlyphLayer` |
| `norad::Contour` | `Contour` |
| `norad::ContourPoint` | `Point` |
| `norad::Component` | `Component` |
| `norad::Anchor` | `Anchor` |
| `norad::Guideline` | `Guideline` |
| `plist::Dictionary` | `LibData` |
| `plist::Value` | `LibValue` |

### Kerning Handling
| norad | shift-ir |
|-------|----------|
| `norad::Groups["public.kern1.*"]` | `KerningData::groups1` |
| `norad::Groups["public.kern2.*"]` | `KerningData::groups2` |
| `norad::Kerning` | `Vec<KerningPair>` |

## Constraints and Invariants

1. **Thread Safety**: All traits require `Send + Sync`
2. **Path Strings**: Paths are `&str`, not `Path` (caller handles path logic)
3. **Error Strings**: Errors are strings for simplicity (no custom error types)
4. **Layer Preservation**: All layers round-trip correctly
5. **Lib Data**: Arbitrary plist data preserved through read/write
6. **Features**: features.fea read/written separately from norad
