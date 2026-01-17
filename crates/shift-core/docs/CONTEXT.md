# shift-core - LLM Context

## Quick Facts
- **Purpose**: Core Rust library for font data structures and editing logic
- **Language**: Rust
- **Key Files**: `edit_session.rs`, `snapshot.rs`, `pattern/rules.rs`, `entity.rs`, `edit_ops.rs`
- **Dependencies**: ts-rs, serde, skrifa, norad
- **Dependents**: shift-node (NAPI bridge)

## File Structure
```
src/
├── lib.rs              # Crate root, module exports
├── entity.rs           # PointId, ContourId with atomic counter
├── point.rs            # Point struct (x, y, type, smooth)
├── contour.rs          # Contour (Vec<Point>, closed flag)
├── glyph.rs            # Glyph (HashMap<ContourId, Contour>)
├── font.rs             # Font (HashMap<u32, Glyph>, metrics)
├── edit_session.rs     # EditSession for mutable glyph editing
├── snapshot.rs         # Serializable state (GlyphSnapshot, CommandResult)
├── edit_ops.rs         # apply_edits() combining moves + rules
├── pattern/
│   ├── mod.rs          # Pattern module exports
│   ├── rules.rs        # RuleId enum, rule definitions
│   ├── matcher.rs      # PatternMatcher, rule table lookup
│   ├── parser.rs       # Template expansion ([CS]H → CH, SH)
│   └── actions.rs      # maintain_tangency() implementation
├── vec2.rs             # Vec2 math utilities
├── binary.rs           # TTF/OTF loading via skrifa
├── ufo.rs              # UFO loading via norad
├── font_loader.rs      # FontAdaptor trait, FontLoader
└── constants.rs        # PIXEL, DEFAULT_X_ADVANCE
```

## Core Abstractions

### EntityId (entity.rs:15-30)
```rust
struct Id(u64)                    // Atomic counter value
struct EntityId { id: Id, parent: Id }
macro entity_id!(ContourId, PointId)  // Generates wrapper types
```

### Point (point.rs:10-20)
```rust
pub struct Point {
    _id: PointId,
    x: f64, y: f64,
    point_type: PointType,  // OnCurve | OffCurve
    smooth: bool,
}
```

### EditSession (edit_session.rs:10-15)
```rust
pub struct EditSession {
    glyph: Glyph,
    active_contour_id: Option<ContourId>,
}
```

### GlyphSnapshot (snapshot.rs:30-40)
```rust
#[derive(Serialize, TS)]
pub struct GlyphSnapshot {
    pub unicode: u32,
    pub name: String,
    pub x_advance: f64,
    pub contours: Vec<ContourSnapshot>,
    pub active_contour_id: Option<String>,
}
```

### PatternMatcher (pattern/matcher.rs:15-25)
```rust
pub struct PatternMatcher {
    rule_table: HashMap<String, Rule>,
}
impl PatternMatcher {
    pub fn match_rule(&self, contour: &Contour, point_id: PointId, selected: &HashSet<PointId>) -> Option<MatchedRule>
}
```

## Key Patterns

### Glyph Ownership Transfer
```rust
// Font owns glyphs; take/put for editing
let glyph = font.take_glyph(unicode);  // Removes from font
let session = EditSession::new(glyph);
// ... edit ...
let glyph = session.into_glyph();
font.put_glyph(glyph);                  // Returns to font
```

### Pattern Template Expansion
```rust
// Pattern templates expand to concrete patterns
"[CS]H" → ["CH", "SH"]
"X@"    → ["N@", "C@", "S@", "H@"]
"H[CS]H" → ["HCH", "HSH"]
```

### Rule Application Flow
```rust
apply_edits(session, selected, dx, dy)
  → move_points(selected, dx, dy)
  → for each selected point:
      match_rule(contour, point_id, selected)
        → build_pattern() [3pt, 5pt windows]
        → rule_table.get(pattern)
      apply_rule(matched_rule)
        → move handles or maintain_tangency()
  → GlyphSnapshot::from_edit_session()
```

## API Surface

| Function/Method | File | Signature |
|----------------|------|-----------|
| `EditSession::new` | edit_session.rs | `fn new(glyph: Glyph) -> Self` |
| `EditSession::add_point` | edit_session.rs | `fn add_point(&mut self, x, y, type, smooth) -> PointId` |
| `EditSession::move_point` | edit_session.rs | `fn move_point(&mut self, id, dx, dy)` |
| `EditSession::into_glyph` | edit_session.rs | `fn into_glyph(self) -> Glyph` |
| `apply_edits` | edit_ops.rs | `fn apply_edits(session, selected, dx, dy) -> EditResult` |
| `PatternMatcher::match_rule` | pattern/matcher.rs | `fn match_rule(&self, contour, point_id, selected) -> Option<MatchedRule>` |
| `GlyphSnapshot::from_edit_session` | snapshot.rs | `fn from_edit_session(session: &EditSession) -> Self` |
| `Font::take_glyph` | font.rs | `fn take_glyph(&mut self, unicode: u32) -> Option<Glyph>` |
| `Font::put_glyph` | font.rs | `fn put_glyph(&mut self, glyph: Glyph)` |
| `FontLoader::read_font` | font_loader.rs | `fn read_font(&self, path: &str) -> Result<Font>` |

## Common Operations

### Create and populate contour
```rust
let mut session = EditSession::new(glyph);
let cid = session.add_empty_contour();
let p1 = session.add_point(0.0, 0.0, OnCurve, false);
let p2 = session.add_point(50.0, 100.0, OffCurve, false);
let p3 = session.add_point(100.0, 0.0, OnCurve, true); // smooth
session.close_contour(cid);
```

### Move with automatic rule application
```rust
let selected: HashSet<PointId> = [p3].into_iter().collect();
let result = apply_edits(&mut session, &selected, 10.0, 5.0);
// result.affected_point_ids includes p2 (handle) if p3 is smooth
```

### Serialize for TypeScript
```rust
let snapshot = GlyphSnapshot::from_edit_session(&session);
let json = serde_json::to_string(&snapshot)?;
```

## Constraints and Invariants

1. **ID Uniqueness**: All PointId/ContourId values are globally unique (atomic counter)
2. **Session Exclusivity**: Only one EditSession per glyph at a time (ownership transfer)
3. **Contour Membership**: Each point belongs to exactly one contour
4. **Smooth Tangency**: Smooth points with two handles maintain 180° alignment when moved
5. **Pattern Windows**: 3-point patterns for basic rules, 5-point for tangency rules
6. **ID Reconstruction**: JS-originated IDs (parent=0) equal original IDs in comparisons
