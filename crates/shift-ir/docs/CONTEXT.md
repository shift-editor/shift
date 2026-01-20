# shift-ir - LLM Context

## Quick Facts
- **Purpose**: Rich intermediate representation for font data - a format-agnostic font model
- **Language**: Rust
- **Key Files**: `font.rs`, `glyph.rs`, `contour.rs`, `point.rs`, `entity.rs`, `layer.rs`
- **Dependencies**: serde, ts-rs
- **Dependents**: shift-core, shift-backends, shift-node

## File Structure
```
src/
├── lib.rs              # Crate root, module exports
├── entity.rs           # EntityId with atomic counter, typed ID macros
├── point.rs            # Point struct (id, x, y, type, smooth)
├── contour.rs          # Contour (id, Vec<Point>, closed)
├── glyph.rs            # Glyph and GlyphLayer with contours/components
├── font.rs             # Font with metadata, metrics, layers, glyphs
├── layer.rs            # Layer (id, name, color)
├── component.rs        # Component references and Transform
├── anchor.rs           # Named anchor positions
├── guideline.rs        # Horizontal/vertical/angled guidelines
├── axis.rs             # Variable font axes and locations
├── source.rs           # Design space sources
├── metrics.rs          # FontMetrics (upm, ascender, descender, etc.)
├── kerning.rs          # KerningData, KerningPair, groups
├── features.rs         # OpenType feature data (.fea)
└── lib_data.rs         # Arbitrary plist data storage
```

## Core Abstractions

### Typed Entity IDs (entity.rs:35-80)
```rust
macro_rules! typed_id {
    ($name:ident) => {
        pub struct $name(EntityId);
        impl $name { fn new() -> Self; fn raw() -> u64; fn from_raw(u128) -> Self; }
    }
}

typed_id!(PointId);
typed_id!(ContourId);
typed_id!(ComponentId);
typed_id!(AnchorId);
typed_id!(GuidelineId);
typed_id!(LayerId);
typed_id!(GlyphId);
typed_id!(SourceId);
```

### Font (font.rs:56-90)
```rust
pub struct Font {
    metadata: FontMetadata,
    metrics: FontMetrics,
    axes: Vec<Axis>,
    sources: Vec<Source>,
    layers: HashMap<LayerId, Layer>,
    glyphs: HashMap<GlyphName, Glyph>,
    kerning: KerningData,
    features: FeatureData,
    guidelines: Vec<Guideline>,
    lib: LibData,
    default_layer_id: LayerId,
}
```

### Glyph (glyph.rs:12-18)
```rust
pub struct Glyph {
    id: GlyphId,
    name: GlyphName,
    unicodes: Vec<u32>,
    layers: HashMap<LayerId, GlyphLayer>,
    lib: LibData,
}
```

### GlyphLayer (glyph.rs:20-29)
```rust
pub struct GlyphLayer {
    width: f64,
    height: Option<f64>,
    contours: HashMap<ContourId, Contour>,
    components: HashMap<ComponentId, Component>,
    anchors: HashMap<AnchorId, Anchor>,
    guidelines: Vec<Guideline>,
    lib: LibData,
}
```

### Contour (contour.rs:6-10)
```rust
pub struct Contour {
    id: ContourId,
    points: Vec<Point>,
    closed: bool,
}
```

### Point (point.rs:17-24)
```rust
pub struct Point {
    id: PointId,
    x: f64,
    y: f64,
    point_type: PointType,  // OnCurve | OffCurve | QCurve
    smooth: bool,
}
```

## Key Patterns

### Layer-Based Architecture
```rust
// Font has layers; glyphs have per-layer data
let default_layer_id = font.default_layer_id();
let glyph = font.glyph("A")?;
let layer_data = glyph.layer(default_layer_id)?;
for contour in layer_data.contours_iter() { ... }
```

### Typed Entity IDs
```rust
// Type-safe IDs prevent mixing point/contour/glyph IDs
let point_id: PointId = PointId::new();
let contour_id: ContourId = ContourId::new();
// point_id != contour_id (different types, won't compile)
```

### Glyph Lookup by Name or Unicode
```rust
let glyph = font.glyph("A");             // By name
let glyph = font.glyph_by_unicode(65);   // By codepoint
```

### Take/Put for Editing
```rust
let glyph = font.take_glyph("A")?;  // Remove from font
// ... mutate glyph ...
font.put_glyph(glyph);               // Return to font
```

## API Surface

| Function/Method | File | Signature |
|----------------|------|-----------|
| `Font::new` | font.rs | `fn new() -> Self` |
| `Font::glyph` | font.rs | `fn glyph(&self, name: &str) -> Option<&Glyph>` |
| `Font::glyph_mut` | font.rs | `fn glyph_mut(&mut self, name: &str) -> Option<&mut Glyph>` |
| `Font::glyph_by_unicode` | font.rs | `fn glyph_by_unicode(&self, unicode: u32) -> Option<&Glyph>` |
| `Font::take_glyph` | font.rs | `fn take_glyph(&mut self, name: &str) -> Option<Glyph>` |
| `Font::put_glyph` | font.rs | `fn put_glyph(&mut self, glyph: Glyph)` |
| `Font::default_layer_id` | font.rs | `fn default_layer_id(&self) -> LayerId` |
| `Glyph::new` | glyph.rs | `fn new(name: GlyphName) -> Self` |
| `Glyph::with_unicode` | glyph.rs | `fn with_unicode(name: GlyphName, unicode: u32) -> Self` |
| `Glyph::layer` | glyph.rs | `fn layer(&self, id: LayerId) -> Option<&GlyphLayer>` |
| `GlyphLayer::add_contour` | glyph.rs | `fn add_contour(&mut self, contour: Contour) -> ContourId` |
| `Contour::new` | contour.rs | `fn new() -> Self` |
| `Contour::add_point` | contour.rs | `fn add_point(&mut self, x, y, type, smooth) -> PointId` |
| `Point::on_curve` | point.rs | `fn on_curve(x: f64, y: f64) -> Self` |
| `Point::off_curve` | point.rs | `fn off_curve(x: f64, y: f64) -> Self` |

## Constraints and Invariants

1. **ID Uniqueness**: All typed IDs are globally unique via atomic counter
2. **Layer Membership**: Each GlyphLayer belongs to exactly one layer and one glyph
3. **Default Layer**: Every Font has a default layer (public.default)
4. **Glyph Names**: Glyph names are unique within a font (HashMap keys)
5. **Point Ownership**: Points belong to exactly one contour (stored in Vec)
6. **Serializable**: All types derive Serialize/Deserialize for persistence
