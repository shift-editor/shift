# shift-core

The core Rust library providing data structures and editing logic for the Shift font editor.

## Overview

shift-core implements the foundational data model for font editing using a direct ownership pattern (no Rc<RefCell>). It provides entity management, glyph editing sessions, pattern-based constraint propagation, and serialization to TypeScript via ts-rs.

## Architecture

```
Font
├── FontMetadata (family, style, version)
├── Metrics (upm, ascender, descender, cap_height, x_height)
└── HashMap<u32, Glyph>
    └── Glyph
        ├── GlyphMetadata (name, unicode, x_advance)
        └── HashMap<ContourId, Contour>
            └── Contour
                ├── ContourId
                ├── Vec<Point>
                └── closed: bool
                    └── Point
                        ├── PointId
                        ├── x, y: f64
                        ├── PointType (OnCurve/OffCurve)
                        └── smooth: bool
```

### Key Design Decisions

1. **Direct Ownership**: Font → Glyph → Contour → Point ownership is linear with no reference counting
2. **Edit Session Pattern**: Glyphs are temporarily extracted from fonts for mutation via `take_glyph()`/`put_glyph()`
3. **Global Atomic IDs**: Entity IDs use atomic counters ensuring uniqueness across the application
4. **Pattern-Driven Constraints**: Rules encode topological relationships (smooth handles, tangency)

## Key Concepts

### Entity IDs

All entities (points, contours) have unique IDs generated via atomic counters:

```rust
struct PointId(EntityId)   // Unique point identifier
struct ContourId(EntityId) // Unique contour identifier
```

IDs serialize to strings for JavaScript interop and reconstruct via `from_raw()`.

### EditSession

Provides mutable access to a single glyph during editing:

```rust
let glyph = font.take_glyph(unicode);        // Extract glyph
let mut session = EditSession::new(glyph);   // Create session
session.add_point(100.0, 200.0, OnCurve, false);
let glyph = session.into_glyph();            // Consume session
font.put_glyph(glyph);                       // Return glyph
```

### Pattern Matching System

Rules detect point topology and apply constraints automatically:

| Pattern | Rule | Action |
|---------|------|--------|
| `[X@][CS]H` | MoveRightHandle | Right handle moves with anchor |
| `H[CS][X@]` | MoveLeftHandle | Left handle moves with anchor |
| `H[CS]H` | MoveBothHandles | Both handles move together |
| `HS[HC][@X][@X]` | MaintainTangencyRight | Opposite handle maintains 180° alignment |

Pattern tokens: `N`=boundary, `C`=corner, `S`=smooth, `H`=handle, `@`=selected, `X`=any

### Snapshots

Serializable state representations for TypeScript:

```rust
GlyphSnapshot {
    unicode: u32,
    name: String,
    x_advance: f64,
    contours: Vec<ContourSnapshot>,
    active_contour_id: Option<String>,
}
```

## API Reference

### Core Types
- `Font` - Container for glyphs with metadata and metrics
- `Glyph` - Single glyph with contours
- `Contour` - Closed/open path of points
- `Point` - Position with type and smooth flag
- `PointId`, `ContourId` - Unique entity identifiers

### Edit Operations
- `EditSession` - Mutable glyph editing context
- `apply_edits()` - Move points with automatic rule application
- `PatternMatcher` - Rule detection and matching

### Font Loading
- `FontLoader` - Pluggable format adapter system
- `BytesFontAdaptor` - TTF/OTF loading via skrifa
- `UfoFontAdaptor` - UFO format loading via norad

## Usage Examples

### Loading a Font
```rust
let loader = FontLoader::new();
let font = loader.read_font("path/to/font.ufo")?;
```

### Editing a Glyph
```rust
let glyph = font.take_glyph(0x0041); // 'A'
let mut session = EditSession::new(glyph);

// Add points
let contour_id = session.add_empty_contour();
let p1 = session.add_point(0.0, 0.0, OnCurve, false);
let p2 = session.add_point(100.0, 200.0, OnCurve, true);

// Move with rule application
let result = apply_edits(&mut session, &selected_ids, dx, dy);
```

## Data Flow

```
User Action (move point)
    ↓
apply_edits(session, selected, dx, dy)
    ├── Move selected points
    ├── PatternMatcher::match_rule() for each point
    │   ├── Build 3-point and 5-point windows
    │   └── Lookup in rule_table
    ├── Apply matched rules
    │   ├── move_anchor_handles()
    │   └── maintain_tangency()
    └── Create GlyphSnapshot
        ↓
    EditResult { snapshot, affected_point_ids, matched_rules }
```

## Related Systems

- [shift-node](../../shift-node/docs/DOCS.md) - NAPI bindings exposing this crate to JavaScript
- [packages/types](../../../packages/types/docs/DOCS.md) - Generated TypeScript types from this crate
