# Architecture Concerns: Data Drift, Complexity, and Beyond

## Executive Summary

The local-first async sync architecture is sound, but the exploration revealed:

1. **Critical bugs** that must be fixed regardless of architecture choice
2. **Data drift risks** that are manageable with proper safeguards
3. **Complexity concerns** that favor a simpler hybrid approach
4. **Other performance bottlenecks** that may dominate the NAPI overhead

---

## Part 1: Critical Bugs Found

These exist in the current architecture and must be fixed first:

### 1.1 Undo Executes During Drag (CRITICAL)

**File**: `views/Editor.tsx:55-58`

```typescript
// Current: Undo handler runs BEFORE canvasActive check
if (e.key === "z" && e.metaKey && !e.shiftKey) {
  e.preventDefault();
  editor.undo();  // ← Executes during drag!
  return;
}
// ...
if (!canvasActive) return;  // ← Too late
```

**Impact**: Pressing Cmd+Z during drag corrupts undo history. The preview system holds a stale snapshot while undo reverts to a previous state.

**Fix**:
```typescript
if (!canvasActive) return;  // Check FIRST

if (e.key === "z" && e.metaKey && !e.shiftKey) {
  e.preventDefault();
  editor.undo();
  return;
}
```

### 1.2 Escape Doesn't Cancel Drag

**File**: `behaviors/EscapeBehavior.ts:6-9`

```typescript
canHandle(state: SelectState, event: ToolEvent): boolean {
  // Only handles "selected" or "ready" - NOT "dragging"!
  return state.type === "selected" || state.type === "ready";
}
```

**Fix**: Add escape handling in `DragBehavior.ts`:
```typescript
if (event.type === "keyDown" && event.key === "Escape") {
  return { type: "selected", intent: { action: "cancelPreview" } };
}
```

### 1.3 Error During Drag Leaves Preview Orphaned

**File**: `intents.ts:209`

```typescript
function executeMovePointsDelta(delta: Point2D, editor: Editor): void {
  editor.edit.applySmartEdits(selectedPoints, delta.x, delta.y);  // No try-catch!
}
```

If Rust throws, preview stays active, next tick corrupts state.

**Fix**:
```typescript
try {
  editor.edit.applySmartEdits(selectedPoints, delta.x, delta.y);
} catch (e) {
  editor.preview.cancelPreview();
  throw e;
}
```

### 1.4 restoreSnapshot Ignores Errors

**File**: `editing.ts:315-319`

```typescript
restoreSnapshot(snapshot: GlyphSnapshot): void {
  this.#ctx.native.restoreSnapshot(JSON.stringify(snapshot));
  this.#ctx.emitGlyph(snapshot);  // ← Called even if Rust failed
}
```

---

## Part 2: Data Drift Analysis

### What Could Cause Drift?

| Scenario | Likelihood | Consequence |
|----------|------------|-------------|
| Floating-point rounding | LOW | Sub-pixel differences, invisible |
| TS rules ≠ Rust rules | MEDIUM | Visible handle position mismatch |
| Async sync fails silently | LOW | Lost edits (if not caught) |
| Race condition on rapid edits | LOW | State confusion |
| Undo during sync | MEDIUM | Conflicting snapshots |

### Mitigations

**1. Reconciliation on Commit**

```typescript
async function onDragEnd() {
  await syncQueue.flush();

  // Fetch authoritative state from Rust
  const authoritative = native.getSnapshotData();

  // Compare with local
  const drift = detectDrift(localGlyph, authoritative);
  if (drift) {
    console.warn('Drift detected:', drift);
    localGlyph = authoritative;  // Rust wins
  }

  // Record for undo using authoritative state
  history.push(snapshotBefore, authoritative);
}
```

**2. Checksum Validation**

```typescript
function glyphChecksum(glyph: GlyphSnapshot): number {
  let sum = 0;
  for (const contour of glyph.contours) {
    for (const point of contour.points) {
      // Quantize to avoid FP issues
      sum ^= Math.round(point.x * 1000) ^ Math.round(point.y * 1000);
    }
  }
  return sum;
}

// After each sync batch
const localSum = glyphChecksum(localGlyph);
const rustSum = native.getGlyphChecksum();  // New lightweight API
if (localSum !== rustSum) {
  // Full reconciliation needed
}
```

**3. Block Conflicting Operations**

```typescript
class SyncQueue {
  private syncing = false;

  async flush() {
    this.syncing = true;
    try {
      await this.sendBatch();
    } finally {
      this.syncing = false;
    }
  }

  // Block undo/redo during sync
  canUndo(): boolean {
    return !this.syncing && history.canUndo();
  }
}
```

### Drift Risk Assessment

**With proper mitigations, drift risk is LOW because:**

1. Reconciliation happens on every drag end (frequent)
2. Rust is always authoritative for undo/redo
3. Drift detection catches issues early
4. The rules math is simple (unlikely to diverge)

**Remaining risk**: If rules are complex or change frequently, keeping TS and Rust in sync becomes a maintenance burden.

---

## Part 3: Complexity Concerns

### The Complexity Spectrum

```
Simple                                                Complex
|-------------------------------------------------------|
Current         Optimized        Local-First      Full CRDT
(Rust owns      NAPI            TS owns rules,   Collaborative
 everything)    (deltas)        async sync       editing
```

### Complexity Cost of Local-First

| Aspect | Added Complexity |
|--------|-----------------|
| Two copies of glyph state | Moderate |
| Sync queue management | Moderate |
| Drift detection/recovery | Low |
| Duplicate rules logic | **High** |
| Testing both implementations | **High** |
| Debugging state mismatches | Moderate |

### Recommendation: Hybrid Approach

Instead of full local-first, consider a **simpler optimization**:

```
Current Flow:
  drag tick → NAPI (full snapshot) → parse → emit → render

Optimized Flow (no local-first):
  drag tick → NAPI (delta only) → apply delta locally → emit → render
                    ↓
              Rust updates internally (no return)
```

**Implementation**:

```rust
// New: lightweight position update, no return
#[napi]
fn set_point_positions(&mut self, moves: Vec<PointMove>) {
    for m in moves {
        self.session.set_point_position(m.id, m.x, m.y);
    }
    // No serialization, no return
}
```

```typescript
function executeMovePointsDelta(delta: Point2D, editor: Editor): void {
  const selected = editor.selection.getSelectedPoints();
  const glyph = editor.$glyph.value;

  // 1. Compute rules locally (TS)
  const moves = RulesEngine.computeMoves(glyph, selected, delta);

  // 2. Apply to local copy (immediate UI)
  const updated = applyMoves(glyph, moves);
  editor.emit(updated);

  // 3. Fire-and-forget to Rust (no await, no return parsing)
  native.setPointPositions(moves);
}
```

**Benefits over full local-first**:
- No sync queue complexity
- No drift detection needed (Rust and TS get same moves)
- No reconciliation logic
- Simpler mental model

**Costs**:
- Still need TS rules engine (but that's simple)
- Still two copies of state (but always in sync)

---

## Part 4: Other Performance Improvements

The exploration found that NAPI serialization may not be the dominant bottleneck.

### Hit Testing: O(n) → O(log n)

**Current**: Every pointer move scans all points/segments.

```typescript
// Current: O(n) for every mouse move
for (const contour of snapshot.contours) {
  for (const point of contour.points) {
    if (Vec2.dist(point, pos) < radius) return point;
  }
}
```

**Improvement**: Spatial indexing with a grid or quadtree.

```typescript
class SpatialIndex {
  private grid: Map<string, Point[]> = new Map();
  private cellSize = 50;  // pixels

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  query(pos: Point2D, radius: number): Point[] {
    // Only check nearby cells
    const candidates: Point[] = [];
    const r = Math.ceil(radius / this.cellSize);

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const key = this.cellKey(pos.x + dx * this.cellSize, pos.y + dy * this.cellSize);
        candidates.push(...(this.grid.get(key) ?? []));
      }
    }
    return candidates;
  }
}
```

**Impact**: 10-100x faster hit testing for large glyphs.

### Segment Parsing: Once, Not Every Frame

**Current**: Segments parsed on every render and every hit test.

```typescript
// Called every frame in #drawSegmentHighlights()
const segments = Segment.parse(contour.points, contour.closed);
```

**Improvement**: Cache parsed segments on the snapshot.

```typescript
interface CachedContour extends ContourSnapshot {
  _segments?: Segment[];  // Lazy cached
}

function getSegments(contour: CachedContour): Segment[] {
  if (!contour._segments) {
    contour._segments = Segment.parse(contour.points, contour.closed);
  }
  return contour._segments;
}
```

**Impact**: Eliminates redundant parsing (currently ~3-5 parses per contour per frame).

### Selection Set: Mutate, Don't Copy

**Current**: Every selection change copies the entire Set.

```typescript
addPointToSelection(pointId: PointId): void {
  const next = new Set(this.$selectedPointIds.peek());  // Full copy!
  next.add(pointId);
  this.$selectedPointIds.set(next);
}
```

**Improvement**: Use a mutable Set with version tracking.

```typescript
class MutableSelection {
  private set = new Set<PointId>();
  private version = 0;

  add(id: PointId) {
    if (!this.set.has(id)) {
      this.set.add(id);
      this.version++;
      this.notify();
    }
  }

  // Consumers compare version to detect changes
}
```

### Render Culling

**Current**: All handles/highlights rendered every frame.

**Improvement**: Only render visible and relevant elements.

```typescript
function renderHandles(glyph: GlyphSnapshot, viewport: Rect) {
  for (const contour of glyph.contours) {
    // Skip contours outside viewport
    if (!Rect.intersects(contour.bounds, viewport)) continue;

    // Skip if nothing selected/hovered in this contour
    if (!hasSelectedPoints(contour)) continue;

    // Render only relevant handles
    for (const point of contour.points) {
      if (point.pointType === 'offCurve' && isRelevant(point)) {
        drawHandle(point);
      }
    }
  }
}
```

### Path Caching

**Current**: New `Path2D` created every frame.

```typescript
beginPath() {
  this.currentPath = new Path2D();  // Allocation every call
}
```

**Improvement**: Cache contour paths, invalidate on change.

```typescript
class PathCache {
  private cache = new Map<ContourId, Path2D>();
  private versions = new Map<ContourId, number>();

  getPath(contour: ContourSnapshot): Path2D {
    const cached = this.cache.get(contour.id);
    if (cached && this.versions.get(contour.id) === contour.version) {
      return cached;
    }

    const path = this.buildPath(contour);
    this.cache.set(contour.id, path);
    this.versions.set(contour.id, contour.version);
    return path;
  }
}
```

---

## Part 5: Prioritized Action Plan

### Immediate (Bug Fixes)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Block undo during drag | 30min | Prevents data corruption |
| P0 | Handle Escape during drag | 30min | User experience |
| P0 | Try-catch in drag intent | 15min | Error recovery |
| P0 | Check restoreSnapshot result | 15min | Undo reliability |

### Short-Term (Quick Performance Wins)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P1 | Cache segment parsing | 2hr | 2-3x render speedup |
| P1 | Spatial index for hit testing | 4hr | 10-100x hit test speedup |
| P1 | Lightweight NAPI for drag | 2hr | Eliminates serialization |
| P2 | Selection Set mutation | 1hr | Fewer allocations |
| P2 | Render culling | 2hr | Scales with viewport |

### Medium-Term (Architecture)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P2 | TS rules engine | 8hr | Enables local-first |
| P2 | Delta NAPI returns | 4hr | Proportional serialization |
| P3 | Path caching | 4hr | GPU-side optimization |
| P3 | Delta snapshots for undo | 8hr | Memory reduction |

### Recommended Order

1. **Fix the bugs** (P0) — These can cause data loss today
2. **Add lightweight NAPI** — Maximum impact for serialization
3. **Spatial indexing** — May be bigger win than NAPI for large fonts
4. **Segment caching** — Fixes render performance
5. **TS rules engine** — Only after other optimizations prove insufficient

---

## Part 6: Decision Framework

### When to Use Local-First

✅ **Use local-first if**:
- NAPI round-trip latency is perceptible (>16ms)
- Serialization dominates CPU profile
- Rules are stable and unlikely to change
- You need offline support

❌ **Don't use local-first if**:
- Hit testing or rendering is the bottleneck
- Rules are evolving rapidly
- Complexity budget is limited
- Single source of truth is important

### When to Keep Rules in Rust

✅ **Keep in Rust if**:
- Rules involve complex validation
- Rules need access to Rust-only data structures
- You want type safety across the boundary
- Performance of rules themselves matters

❌ **Move to TS if**:
- Rules are simple (pattern matching + basic math)
- Serialization overhead dominates rule computation
- You want faster iteration on rules
- Debugging rules in browser devtools is valuable

---

## Conclusion

The local-first architecture is viable but may be **overkill** for this problem. The simpler approach:

1. **Fix the critical bugs** (undo during drag, escape, error handling)
2. **Add lightweight NAPI** (`setPointPositions` with no return)
3. **Move rules to TS** (simple, enables immediate feedback)
4. **Add spatial indexing** (may be the bigger win)

This gives 90% of the benefit with 30% of the complexity of full local-first with async sync.

The key insight: **You don't need two sources of truth if both sources receive the same moves at the same time.** TS computes moves, applies locally, and sends to Rust. No drift, no reconciliation, no complexity.
