# Serialization Architecture: Rust ↔ TypeScript

## Current State Analysis

### The Problem

The current architecture serializes the **entire glyph snapshot on every mutation**, regardless of operation frequency:

```
movePoints()     → Full GlyphSnapshot JSON (~30KB)  × 60/sec during drag = 1.8MB/sec
applySmartEdits() → Full GlyphSnapshot + Rules JSON
addPoint()       → Full GlyphSnapshot JSON
toggleSmooth()   → Full GlyphSnapshot JSON
```

This is architecturally wrong. The serialization cost should scale with **change size**, not **total state size**.

### Current Patterns

| Pattern | Used For | Overhead |
|---------|----------|----------|
| JSON String returns | All mutations | HIGH - full parse required |
| Native NAPI objects | `getSnapshotData()`, metadata | LOW - direct access |
| Primitives | `hasEditSession()`, counts | NONE |

**The inconsistency**: `getSnapshotData()` returns a native object, but mutations return JSON strings containing the same data.

---

## Recommended Architecture

### Principle 1: Separate Hot Path from Cold Path

**Hot Path** (called during interaction, <16ms budget):
- Point movement during drag
- Handle adjustments
- Selection updates

**Cold Path** (called on user action, <100ms acceptable):
- Adding/removing points
- Undo/redo
- File operations

**Different serialization strategies for each.**

### Principle 2: Return What Changed, Not Everything

Instead of:
```rust
// Current: Returns entire glyph
fn move_points(&mut self, ids: Vec<String>, dx: f64, dy: f64) -> String {
    // ... modify points ...
    serde_json::to_string(&CommandResult {
        snapshot: Some(full_glyph_snapshot),  // ← Problem
        ...
    })
}
```

Do:
```rust
// Better: Returns only what changed
fn move_points(&mut self, ids: Vec<String>, dx: f64, dy: f64) -> PointDelta {
    PointDelta {
        moves: vec![
            PointMove { id: "123", x: 100.0, y: 200.0 },
            PointMove { id: "456", x: 150.0, y: 250.0 },
        ]
    }
}
```

### Principle 3: Native Objects for Structured Data

Use `#[napi(object)]` for all structured returns, not JSON strings:

```rust
#[napi(object)]
pub struct MoveResult {
    pub success: bool,
    pub affected_ids: Vec<String>,
    pub error: Option<String>,
}

#[napi]
fn move_points(&mut self, ids: Vec<String>, dx: f64, dy: f64) -> MoveResult {
    // Direct object return - no serialization
}
```

**Why**: NAPI's native object binding is ~10x faster than JSON.stringify + JSON.parse.

### Principle 4: Lazy Snapshot Fetching

Don't return snapshots with every mutation. Let TS request when needed:

```rust
// Mutation returns minimal info
#[napi]
fn move_points(&mut self, ids: Vec<String>, dx: f64, dy: f64) -> MoveResult

// Separate snapshot access
#[napi]
fn get_snapshot_data(&self) -> JSGlyphSnapshot  // Already exists!
```

TS side:
```typescript
// During drag - no snapshot fetch
native.movePoints(ids, dx, dy);
localGlyph = applyDeltaLocally(localGlyph, ids, dx, dy);

// On drag end - fetch authoritative state
const snapshot = native.getSnapshotData();
```

---

## Proposed API Tiers

### Tier 1: Fire-and-Forget (Hot Path)

For high-frequency operations that don't need confirmation:

```rust
#[napi]
fn set_point_positions(&mut self, moves: Vec<PointMove>) -> bool {
    // Apply moves, return success only
    // No snapshot, no affected IDs, no rules
}

#[napi]
fn apply_delta(&mut self, selected_ids: Vec<String>, dx: f64, dy: f64) -> bool {
    // Move points without rule evaluation
    // TS handles rules locally
}
```

**Use case**: Every drag tick. TS maintains local copy, syncs to Rust, UI updates from local copy.

### Tier 2: Confirmed Mutations (Warm Path)

For operations that need confirmation but not full state:

```rust
#[napi(object)]
pub struct MutationResult {
    pub success: bool,
    pub affected_ids: Vec<String>,
    pub created_ids: Vec<String>,
    pub error: Option<String>,
}

#[napi]
fn add_point(&mut self, x: f64, y: f64, point_type: PointType) -> MutationResult {
    // Returns confirmation + new ID
    // Caller fetches snapshot if needed
}
```

**Use case**: Click to add point, delete points, toggle smooth.

### Tier 3: Full State (Cold Path)

For operations that fundamentally change state:

```rust
#[napi]
fn restore_snapshot(&mut self, snapshot_json: String) -> JSGlyphSnapshot {
    // Undo/redo - returns full new state as native object
}

#[napi]
fn paste_contours(&mut self, json: String) -> PasteResult {
    // Paste - returns created IDs + full snapshot
}
```

**Use case**: Undo, redo, paste, load glyph.

---

## Implementation Patterns

### Pattern A: Local-First with Sync

```
┌─────────────────────────────────────────────────────────────┐
│                      TypeScript                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐ │
│  │ Local Glyph  │ ←── │ Rules Engine │ ←── │ User Input  │ │
│  │   (Copy)     │     │    (TS)      │     │             │ │
│  └──────┬───────┘     └──────────────┘     └─────────────┘ │
│         │ immediate                                         │
│         ▼                                                   │
│  ┌──────────────┐                                          │
│  │   Renderer   │  ← UI updates from local copy            │
│  └──────────────┘                                          │
│         │                                                   │
│         │ async sync (batched)                              │
└─────────┼───────────────────────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────────────────────┐
│                        Rust                                  │
│  ┌──────────────┐     ┌──────────────┐                     │
│  │ EditSession  │ ←── │ set_points() │  fire-and-forget    │
│  │   (Truth)    │     │              │                     │
│  └──────────────┘     └──────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: TS doesn't wait for Rust during drag. It updates locally, syncs asynchronously.

### Pattern B: Batched Updates

Instead of one NAPI call per drag tick, batch:

```typescript
class DragBatcher {
    private pending: PointMove[] = [];
    private frameId: number | null = null;

    queueMove(id: PointId, x: number, y: number) {
        this.pending.push({ id, x, y });

        if (!this.frameId) {
            this.frameId = requestAnimationFrame(() => this.flush());
        }
    }

    private flush() {
        if (this.pending.length > 0) {
            native.setPointPositions(this.pending);
            this.pending = [];
        }
        this.frameId = null;
    }
}
```

**Result**: Max 60 NAPI calls/sec regardless of event frequency.

### Pattern C: Optimistic Updates with Reconciliation

```typescript
// During drag
function onDragMove(delta: Vec2) {
    // 1. Apply locally (immediate)
    const newPositions = rulesEngine.apply(localGlyph, selected, delta);
    localGlyph = applyMoves(localGlyph, newPositions);
    emit(localGlyph);  // UI updates

    // 2. Queue sync to Rust (async)
    syncQueue.push(newPositions);
}

// On drag end
async function onDragEnd() {
    // 3. Commit and reconcile
    await syncQueue.flush();
    const authoritative = native.getSnapshotData();

    // 4. Check for drift (should be none)
    if (!glyphsEqual(localGlyph, authoritative)) {
        console.warn('Drift detected, reconciling');
        localGlyph = authoritative;
        emit(localGlyph);
    }

    // 5. Record for undo
    history.push(snapshotBefore, authoritative);
}
```

---

## Data Structure Recommendations

### Point IDs: Use Numbers, Not Strings

Current:
```typescript
applyEditsUnified(pointIds: string[], dx: number, dy: number): string
```

Every call does `id.parse::<u128>()` in Rust and `id.toString()` when returning.

Better:
```rust
#[napi]
fn move_points(&mut self, ids: Vec<u32>, dx: f64, dy: f64) -> MoveResult
// Use index-based IDs during editing session
// Map to persistent IDs only on save
```

Or use BigInt for true 64-bit IDs:
```typescript
// NAPI supports BigInt natively
movePoints(ids: bigint[], dx: number, dy: number): MoveResult
```

### Snapshot Deltas

For large glyphs, return what changed:

```rust
#[napi(object)]
pub struct SnapshotDelta {
    pub modified_points: Vec<PointSnapshot>,
    pub added_points: Vec<PointSnapshot>,
    pub removed_point_ids: Vec<String>,
    pub modified_contours: Vec<ContourMeta>,  // just id + closed, not points
}
```

TS applies delta to local copy instead of replacing entire snapshot.

---

## Migration Path

### Phase 1: Add Lightweight APIs (Non-Breaking)

```rust
// New: fire-and-forget position update
#[napi]
fn set_point_positions(&mut self, moves: Vec<PointMove>) -> bool

// New: delta-based move without snapshot return
#[napi]
fn move_points_fast(&mut self, ids: Vec<String>, dx: f64, dy: f64) -> MoveResult
```

### Phase 2: TS-Side Rules Engine

Move pattern matching and tangency math to TypeScript. Rust becomes persistence-only during drag.

### Phase 3: Refactor Drag Flow

```typescript
// Before: Every tick crosses NAPI with full snapshot
executeIntent → applySmartEdits → NAPI → full JSON → parse → emit

// After: Local updates with async sync
executeIntent → localRules → localUpdate → emit → queueSync
```

### Phase 4: Deprecate Heavy APIs

Mark old APIs as deprecated, migrate callers:
```rust
#[napi]
#[deprecated(note = "Use move_points_fast instead")]
fn apply_edits_unified(...) -> String
```

### Phase 5: Native Objects Everywhere

Replace all JSON string returns with native NAPI objects.

---

## Performance Targets

| Operation | Current | Target | Improvement |
|-----------|---------|--------|-------------|
| Drag tick | ~5-10ms | <0.5ms | 10-20x |
| Point add | ~3-5ms | <1ms | 3-5x |
| Undo/redo | ~5-10ms | <3ms | 2-3x |
| Paste | ~10-20ms | <5ms | 2-4x |

---

## Summary

The core architectural changes:

1. **Tier the API** by operation frequency
2. **Return deltas**, not full state
3. **Use native objects**, not JSON strings
4. **Local-first** with async sync during interactions
5. **Batch** high-frequency operations
6. **Lazy fetch** snapshots only when needed

This transforms serialization from O(total_state × operation_count) to O(delta_size × operation_count) — a fundamental improvement for large glyphs.
