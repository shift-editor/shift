# shift-ir

The intermediate representation crate providing a rich, format-agnostic font model for Shift.

## Overview

shift-ir defines the core data structures that represent font data throughout the Shift editor. It serves as the canonical in-memory representation, decoupled from any specific file format (UFO, TTF, etc.). All font manipulation happens through these types.

## Architecture

```
Font
├── FontMetadata (family_name, style_name, version, copyright, etc.)
├── FontMetrics (units_per_em, ascender, descender, cap_height, x_height)
├── Vec<Axis> (variable font design axes)
├── Vec<Source> (design space sources)
├── HashMap<LayerId, Layer>
│   └── Layer (id, name, color)
├── HashMap<GlyphName, Glyph>
│   └── Glyph
│       ├── id: GlyphId
│       ├── name: GlyphName
│       ├── unicodes: Vec<u32>
│       └── HashMap<LayerId, GlyphLayer>
│           └── GlyphLayer
│               ├── width, height
│               ├── HashMap<ContourId, Contour>
│               │   └── Contour
│               │       ├── id: ContourId
│               │       ├── points: Vec<Point>
│               │       └── closed: bool
│               ├── HashMap<ComponentId, Component>
│               ├── HashMap<AnchorId, Anchor>
│               └── Vec<Guideline>
├── KerningData (groups, pairs)
├── FeatureData (.fea source)
├── Vec<Guideline> (font-level guidelines)
└── LibData (arbitrary plist data)
```

### Key Design Decisions

1. **Format Agnostic**: No UFO or binary-specific details leak into IR types
2. **Layer-Centric**: Glyphs have per-layer data, supporting masters and background layers
3. **Typed IDs**: Each entity type (Point, Contour, Glyph, etc.) has its own ID type
4. **HashMap Storage**: Contours and components indexed by ID for O(1) lookup
5. **Serializable**: All types derive Serde traits for persistence and IPC

## Key Concepts

### Typed Entity IDs

Every entity has a unique ID generated via atomic counter:

```rust
typed_id!(PointId);
typed_id!(ContourId);
typed_id!(ComponentId);
typed_id!(AnchorId);
typed_id!(GuidelineId);
typed_id!(LayerId);
typed_id!(GlyphId);
typed_id!(SourceId);
```

IDs are type-safe - you cannot accidentally use a PointId where a ContourId is expected.

### Font and Layers

Fonts organize glyphs across multiple layers (masters, backgrounds):

```rust
let font = Font::new();
let default_layer_id = font.default_layer_id();

// Access layer info
let layer = font.layer(default_layer_id)?;
println!("Layer name: {}", layer.name());
```

### Glyphs and GlyphLayers

Each glyph has data for each layer it exists in:

```rust
let mut glyph = Glyph::with_unicode("A".to_string(), 65);

// Create layer data
let mut layer = GlyphLayer::with_width(600.0);
let mut contour = Contour::new();
contour.add_point(0.0, 0.0, PointType::OnCurve, false);
contour.add_point(300.0, 700.0, PointType::OnCurve, false);
contour.add_point(600.0, 0.0, PointType::OnCurve, false);
contour.close();
layer.add_contour(contour);

glyph.set_layer(default_layer_id, layer);
font.insert_glyph(glyph);
```

### Points and Point Types

Points have a type indicating their role in the curve:

```rust
pub enum PointType {
    OnCurve,   // Anchor point on the curve
    OffCurve,  // Bezier control point (handle)
    QCurve,    // Quadratic curve point (TrueType)
}
```

Points can be smooth (tangent handles constrained to 180 degrees):

```rust
let mut p = Point::on_curve(100.0, 200.0);
p.set_smooth(true);
```

### Components

Glyphs can reference other glyphs via components:

```rust
let component = Component::with_transform(
    "a".to_string(),
    Transform::translate(100.0, 0.0),
);
layer.add_component(component);
```

### Anchors

Named positions for mark attachment:

```rust
let anchor = Anchor::new("top".to_string(), 300.0, 700.0);
layer.add_anchor(anchor);
```

### Kerning

Kerning data with group support:

```rust
// Define groups
kerning.set_group1("public.kern1.A".to_string(), vec!["A", "Agrave", "Aacute"]);
kerning.set_group2("public.kern2.V".to_string(), vec!["V", "W"]);

// Add pair
kerning.add_pair(KerningPair::new(
    KerningSide::Group("public.kern1.A".to_string()),
    KerningSide::Group("public.kern2.V".to_string()),
    -50.0,
));
```

## API Reference

### Core Types
- `Font` - Root container with metadata, metrics, layers, glyphs
- `FontMetadata` - Name and identification information
- `FontMetrics` - Global font measurements
- `Layer` - Named layer definition
- `Glyph` - Glyph with unicodes and per-layer data
- `GlyphLayer` - Layer-specific glyph data (contours, components, anchors)
- `Contour` - Path with points, open or closed
- `Point` - Position with type and smooth flag
- `Component` - Reference to another glyph with transform
- `Anchor` - Named attachment point
- `Guideline` - Visual alignment guide

### ID Types
- `PointId` - Unique point identifier
- `ContourId` - Unique contour identifier
- `ComponentId` - Unique component identifier
- `AnchorId` - Unique anchor identifier
- `GuidelineId` - Unique guideline identifier
- `LayerId` - Unique layer identifier
- `GlyphId` - Unique glyph identifier
- `SourceId` - Unique source identifier

### Kerning Types
- `KerningData` - Groups and pairs
- `KerningPair` - First/second side with value
- `KerningSide` - Glyph or Group reference

### Variable Font Types
- `Axis` - Design space axis (tag, name, range)
- `Source` - Master at a specific location
- `Location` - Axis coordinates

## Usage Examples

### Creating a Font

```rust
use shift_ir::*;

let mut font = Font::new();
font.metadata_mut().family_name = Some("MyFont".to_string());
font.metadata_mut().style_name = Some("Regular".to_string());
font.metrics_mut().units_per_em = 1000.0;
font.metrics_mut().ascender = 800.0;
font.metrics_mut().descender = -200.0;
```

### Adding a Glyph

```rust
let default_layer_id = font.default_layer_id();

let mut glyph = Glyph::with_unicode("A".to_string(), 65);
let mut layer = GlyphLayer::with_width(600.0);

// Add triangle contour
let mut contour = Contour::new();
contour.add_point(0.0, 0.0, PointType::OnCurve, false);
contour.add_point(300.0, 700.0, PointType::OnCurve, false);
contour.add_point(600.0, 0.0, PointType::OnCurve, false);
contour.close();
layer.add_contour(contour);

glyph.set_layer(default_layer_id, layer);
font.insert_glyph(glyph);
```

### Iterating Contours

```rust
let glyph = font.glyph("A")?;
let layer = glyph.layer(font.default_layer_id())?;

for contour in layer.contours_iter() {
    println!("Contour {} has {} points", contour.id(), contour.len());
    for point in contour.points() {
        println!("  ({}, {}) {:?}", point.x(), point.y(), point.point_type());
    }
}
```

## Data Flow

```
File Format (UFO/TTF)
    ↓
shift-backends (reader)
    ↓
shift-ir::Font (in-memory representation)
    ↓
shift-core (editing logic)
    ↓
shift-ir::Font (modified)
    ↓
shift-backends (writer)
    ↓
File Format (UFO/TTF)
```

## Related Systems

- [shift-core](../../shift-core/docs/DOCS.md) - Editing logic operating on IR types
- [shift-backends](../../shift-backends/docs/DOCS.md) - Format readers/writers
- [shift-node](../../shift-node/docs/DOCS.md) - NAPI bindings for JavaScript
