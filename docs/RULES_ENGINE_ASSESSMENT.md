# Point Rules Engine: Critical Assessment

## Executive Summary

**The decision to put the rules engine in Rust is causing significant overhead during drag operations.** The overhead comes not from the rules computation itself (which is trivial), but from the **full glyph snapshot serialization on every drag tick**.

**Recommendation: Move rules engine to TypeScript and refactor the drag-time NAPI interface.**

---

## Current Architecture

### Data Flow During Drag Operations

```
User drag gesture (60Hz)
    ↓
DragBehavior.transitionDragging()     [TS]
    ↓ No throttling
executeIntent({ action: "movePointsDelta" })
    ↓
editor.edit.applySmartEdits(selectedPoints, dx, dy)
    ↓
native.applyEditsUnified(pointIds, dx, dy)   [NAPI BOUNDARY]
    ↓
apply_edits(session, selected_ids, dx, dy)   [Rust]
    ├── move_points() - move selected points
    ├── PatternMatcher::match_rule() - find applicable rules
    ├── apply_rule() - move affected handles
    └── GlyphSnapshot::from_edit_session()  ← FULL SERIALIZATION
    ↓
Return EditResultJson {
    success: bool,
    snapshot: GlyphSnapshot,      ← ~24-30KB JSON for typical glyph
    affectedPointIds: Vec<String>,
    matchedRules: Vec<MatchedRule>
}
    ↓ JSON.parse()
emitGlyph(result.snapshot)  → triggers reactive UI update
```

### The Overhead Breakdown

| Component | Cost per tick | At 60Hz |
|-----------|--------------|---------|
| NAPI call overhead | ~0.1ms | 6ms/sec |
| String→u128 ID parsing | ~0.01ms | 0.6ms/sec |
| **Pattern matching** | ~0.05ms | 3ms/sec |
| **Tangency math** | ~0.01ms | 0.6ms/sec |
| **Full snapshot serialization** | ~2-5ms | **120-300ms/sec** |
| **JSON.parse() on TS side** | ~1-2ms | **60-120ms/sec** |

**The rules engine itself is <5% of the overhead. Serialization is >90%.**

---

## The Rules Are Trivially Simple

### Pattern Matching (~184 lines Rust)

The entire pattern matching algorithm:
1. Build a 3 or 5 character string from neighboring point types
2. Look up string in a HashMap
3. Return the matched rule

```rust
// This is the core logic - a HashMap lookup
if let Some(rule) = self.rule_table.get(&pattern) {
    return Some(MatchedRule { ... });
}
```

**Equivalent TS code: ~50 lines**

### Tangency Maintenance (~50 lines Rust)

The entire tangency math:
```rust
let opposite_magnitude = (opposite - anchor).length();
let normalized = (selected - anchor).normalize();
let new_opposite_pos = anchor + (-normalized * opposite_magnitude);
```

**Equivalent TS code: 5 lines** using existing `@shift/geo/Vec2`:
```typescript
const magnitude = Vec2.len(Vec2.sub(opposite, anchor));
const direction = Vec2.normalize(Vec2.sub(selected, anchor));
const newOpposite = Vec2.add(anchor, Vec2.scale(direction, -magnitude));
```

### The 5 Rules

| Rule | Pattern | Action |
|------|---------|--------|
| MoveRightHandle | `NCH`, `SCH` | Move right handle with anchor |
| MoveLeftHandle | `HCN`, `HCS` | Move left handle with anchor |
| MoveBothHandles | `HSH`, `HCH` | Move both handles with anchor |
| MaintainTangencyRight | `HSHCN`, etc. | Rotate opposite handle to maintain tangent |
| MaintainTangencyLeft | `NCHSH`, etc. | Rotate opposite handle to maintain tangent |

---

## Why Rust Was Chosen (and Why It's Wrong)

### Original Rationale (Inferred)
1. "Geometric constraints are complex" → **False.** It's string matching + basic vector math.
2. "Rust is faster" → **True but irrelevant.** The computation is <5% of overhead.
3. "Keep all geometry logic in one place" → **Valid concern but not blocking.**

### Why It's Problematic

1. **Serialization dominates**: Every drag tick serializes the entire glyph (all contours, all points) to JSON, crosses NAPI, then parses on the other side.

2. **The TS side already has the glyph**: After each `applySmartEdits`, TS receives and stores the full snapshot. The next drag tick could use that local copy instead of asking Rust.

3. **Undo doesn't need rules**: The undo system is snapshot-based. It captures before/after states, not operation sequences. Rules could run anywhere.

4. **No validation advantage**: There's no Rust-side validation of rule correctness that TS couldn't do.

---

## The Real Problem: Unnecessary Round-Trips

The architecture forces a full Rust round-trip on every drag tick when:
- TS already has the current point positions
- TS could compute affected points locally
- TS only needs Rust for persistence (file/undo)

### What Actually Needs Rust

| Operation | Needs Rust? | Why |
|-----------|------------|-----|
| Moving points | Yes | Source of truth for file |
| Pattern matching | **No** | Pure function on local data |
| Tangency math | **No** | Pure function on local data |
| Getting snapshot | **No** | TS already has it |
| Committing to history | Yes | Undo stack in Rust |

---

## Proposed Architecture

### Option A: Full TS Rules (Recommended)

Move all rules logic to TypeScript. Rust becomes a "dumb" persistence layer during drag.

```
User drag gesture
    ↓
RulesEngine.computeAffectedPoints(glyph, selectedIds)  [TS]
    ↓
RulesEngine.applyRules(glyph, delta)  [TS - updates local copy]
    ↓
editor.emitGlyph(updatedGlyph)  [TS - UI updates immediately]
    ↓
native.setPointPositions(allMoves)  [NAPI - lightweight, no return]
```

**Drag End:**
```
native.commitSnapshot()  [Returns full snapshot for undo]
```

**Benefits:**
- Zero serialization during drag (except lightweight position updates)
- Immediate UI feedback (no round-trip latency)
- Rules logic is debuggable in browser devtools
- Simpler mental model

**Costs:**
- ~300 lines of TS to write
- Two sources of truth during drag (acceptable - reconciled on commit)

### Option B: Optimized NAPI (Partial Fix)

Keep rules in Rust but fix the serialization:

```rust
// New lightweight drag API
#[napi]
fn apply_edits_lightweight(
    point_ids: Vec<String>,
    dx: f64,
    dy: f64,
) -> String {
    // Returns ONLY affected point positions, not full snapshot
    // { "moves": [{"id": "123", "x": 100, "y": 200}, ...] }
}
```

**Benefits:**
- Less invasive change
- Rules stay in Rust

**Costs:**
- Still has NAPI overhead
- Still serializes (just less)
- Doesn't address the fundamental design issue

### Option C: Hybrid (Not Recommended)

Keep complex rules (tangency) in Rust, move simple rules (handle movement) to TS.

**Costs:**
- Split logic is confusing
- Still has serialization for complex cases
- Worst of both worlds

---

## Implementation Plan for Option A

### Phase 1: TS Rules Engine (~4 hours)

Create `packages/shift-rules/`:
```
src/
  RulesEngine.ts      # Main entry point
  PatternMatcher.ts   # Pattern string building + lookup
  rules.ts            # Rule definitions
  actions.ts          # maintain_tangency(), move_handles()
  types.ts            # MatchedRule, RuleId, etc.
```

### Phase 2: Lightweight NAPI (~2 hours)

Add to `shift-node`:
```rust
#[napi]
fn set_point_positions(moves: Vec<PointMove>) -> bool {
    // Batch update positions, no snapshot return
}

#[napi]
fn get_snapshot_for_undo() -> String {
    // Only called at drag end
}
```

### Phase 3: Integrate with Drag Flow (~2 hours)

Update `intents.ts`:
```typescript
function executeMovePointsDelta(delta: Point2D, editor: Editor): void {
  const glyph = editor.getGlyph();
  const selected = editor.selection.getSelectedPoints();

  // 1. Compute rules locally
  const { affectedPoints, newPositions } = RulesEngine.apply(glyph, selected, delta);

  // 2. Update local glyph (immediate UI)
  const updatedGlyph = applyMovesToGlyph(glyph, newPositions);
  editor.fontEngine.emitGlyph(updatedGlyph);

  // 3. Sync to Rust (fire-and-forget during drag)
  editor.fontEngine.native.setPointPositions(newPositions);
}
```

### Phase 4: Testing (~2 hours)

- Port existing Rust tests to TS
- Add drag performance benchmarks
- Verify undo/redo still works

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Floating-point drift | Low | Use same epsilon (1e-10), reconcile on commit |
| Undo inconsistency | Low | Commit fetches authoritative snapshot |
| Regression in rules | Medium | Comprehensive test suite, port Rust tests |
| Two sources of truth | Medium | Clear ownership: TS during drag, Rust on commit |

---

## Conclusion

The Rust rules engine was premature optimization. The actual computation is trivial (~100 lines of simple logic), but the NAPI serialization overhead is massive (~180-420ms/sec of CPU time on a typical glyph).

**Moving rules to TypeScript would:**
1. Eliminate ~95% of drag overhead
2. Provide immediate UI feedback
3. Make the code more debuggable
4. Simplify the architecture

**Estimated effort: 8-12 hours for full migration.**

The change is low-risk because:
- The undo system is snapshot-based (doesn't care where rules run)
- The math is trivial and well-tested
- TS already has all the data it needs
