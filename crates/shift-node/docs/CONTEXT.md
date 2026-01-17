# shift-node - LLM Context

## Quick Facts
- **Purpose**: NAPI bindings exposing shift-core to Node.js/Electron
- **Language**: Rust (NAPI-RS)
- **Key Files**: `font_engine.rs`, `types.rs`, `index.d.ts`
- **Dependencies**: napi, napi-derive, shift-core, serde_json
- **Dependents**: Preload script, renderer engine layer

## File Structure
```
crates/shift-node/
├── Cargo.toml          # Dependencies, cdylib target
├── package.json        # Node.js package, multi-platform binaries
├── build.rs            # NAPI build setup
├── index.js            # Platform-specific binary loader
├── index.d.ts          # Auto-generated TypeScript definitions
└── src/
    ├── lib.rs          # Module declarations
    ├── font_engine.rs  # FontEngine NAPI class (604 lines)
    └── types.rs        # NAPI bridge types
```

## Core Abstractions

### FontEngine (font_engine.rs:23-30)
```rust
#[napi]
pub struct FontEngine {
    font_loader: FontLoader,
    current_edit_session: Option<EditSession>,
    editing_unicode: Option<u32>,
    font: Font,
}
```

### JS Native Types (types.rs)
```rust
#[napi(object)]
pub struct JSFontMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    pub descender: f64,
    pub cap_height: f64,
    pub x_height: f64,
}

#[napi(object)]
pub struct JSGlyphSnapshot {
    pub unicode: u32,
    pub name: String,
    pub x_advance: f64,
    pub contours: Vec<JSContourSnapshot>,
    pub active_contour_id: Option<String>,
}
```

### PointTypeJS (types.rs)
```rust
#[napi]
pub enum PointTypeJS {
    OnCurve = 0,
    OffCurve = 1,
}
```

## Key Patterns

### JSON Result Pattern
```rust
// All mutations return JSON CommandResult
pub fn add_point(&mut self, x: f64, y: f64, point_type: String, smooth: bool) -> String {
    let session = self.current_edit_session.as_mut().unwrap();
    let point_id = session.add_point(x, y, parse_point_type(&point_type), smooth);
    let snapshot = GlyphSnapshot::from_edit_session(session);
    serde_json::to_string(&CommandResult::success(snapshot, vec![point_id.to_string()])).unwrap()
}
```

### Native Object Pattern
```rust
// Efficient reads via native NAPI objects
#[napi]
pub fn get_snapshot_data(&self) -> Result<JSGlyphSnapshot> {
    let session = self.current_edit_session.as_ref()
        .ok_or_else(|| Error::new(Status::GenericFailure, "No edit session"))?;
    Ok(JSGlyphSnapshot::from_edit_session(session))
}
```

### ID String Conversion
```rust
// Rust → JS: ID to string
point_id.raw().to_string()

// JS → Rust: String to ID
let raw: u128 = id_str.parse()?;
let point_id = PointId::from_raw(raw);
```

## API Surface

| Method | Return | Purpose |
|--------|--------|---------|
| `new()` | `FontEngine` | Create instance |
| `loadFont(path)` | `void` | Load font file |
| `startEditSession(unicode)` | `void` | Begin editing |
| `endEditSession()` | `void` | End editing |
| `hasEditSession()` | `boolean` | Check session |
| `getSnapshot()` | `string \| null` | JSON snapshot |
| `getSnapshotData()` | `JSGlyphSnapshot` | Native snapshot |
| `addPoint(x, y, type, smooth)` | `string` | JSON result |
| `movePoints(ids, dx, dy)` | `string` | JSON result |
| `applyEditsUnified(ids, dx, dy)` | `string` | JSON with rules |

## Common Operations

### Session workflow
```typescript
const engine = new FontEngine();
engine.loadFont('/path/to/font.ufo');
engine.startEditSession(65);

// Get native snapshot (efficient)
const snapshot = engine.getSnapshotData();

// Mutate and get JSON result
const result = JSON.parse(engine.addPoint(100, 200, 'onCurve', false));

engine.endEditSession();
```

### Parse CommandResult
```typescript
interface CommandResult {
  success: boolean;
  snapshot: GlyphSnapshot | null;
  error: string | null;
  affectedPointIds: string[];
  canUndo: boolean;
  canRedo: boolean;
}

const result: CommandResult = JSON.parse(engine.movePoints(['id1'], 10, 5));
if (!result.success) throw new Error(result.error);
```

### Unified edit with rules
```typescript
const result = JSON.parse(engine.applyEditsUnified(['point-id'], 50, 0));
// result.matchedRules contains applied pattern rules
// result.affectedPointIds includes handle points moved by rules
```

## Constraints and Invariants

1. **Session Required**: Most operations require `hasEditSession() === true`
2. **Single Session**: Only one glyph can be edited at a time
3. **ID Format**: IDs are u64 as strings, e.g., "12345"
4. **Point Type Strings**: Must be "onCurve" or "offCurve"
5. **JSON Parse Required**: Most return values need `JSON.parse()`
6. **Error Handling**: NAPI errors throw JavaScript exceptions
