# Types

Shared TypeScript types bridging Rust and TypeScript via ts-rs code generation.

## Overview

The types package provides the TypeScript type definitions generated from Rust structs using ts-rs. This enables type-safe communication between the Rust shift-core library and the TypeScript renderer, ensuring consistency across the language boundary.

## Architecture

```
Rust (shift-core)
├── #[derive(TS)] on structs
└── ts-rs generates TypeScript
    ↓
Generated Types (types/generated/)
├── PointSnapshot.ts
├── ContourSnapshot.ts
├── GlyphSnapshot.ts
├── CommandResult.ts
├── RuleId.ts
└── MatchedRule.ts
    ↓
packages/types
└── Re-exports from shift-node
    ↓
Renderer (imports types)
```

### Key Design Decisions

1. **Code Generation**: Types auto-generated from Rust via ts-rs
2. **Single Source of Truth**: Rust definitions are canonical
3. **Branded IDs**: PointId/ContourId use TypeScript brands for safety
4. **String Serialization**: IDs converted to strings for JSON transport

## Key Concepts

### Generated Types

Types generated from Rust `#[derive(TS)]` annotations:

```typescript
// From Rust PointSnapshot
type PointSnapshot = {
  id: string;
  x: number;
  y: number;
  pointType: PointTypeString;
  smooth: boolean;
};

// From Rust GlyphSnapshot
type GlyphSnapshot = {
  unicode: number;
  name: string;
  xAdvance: number;
  contours: ContourSnapshot[];
  activeContourId: string | null;
};
```

### Branded IDs

Type-safe ID wrappers preventing misuse:

```typescript
declare const PointIdBrand: unique symbol;
type PointId = string & { readonly [PointIdBrand]: unique symbol };

declare const ContourIdBrand: unique symbol;
type ContourId = string & { readonly [ContourIdBrand]: unique symbol };

// Usage
function movePoint(id: PointId, dx: number, dy: number): void;
// movePoint(contourId, 10, 5); // Error: ContourId not assignable to PointId
```

### CommandResult

Standard response format for mutations:

```typescript
type CommandResult = {
  success: boolean;
  snapshot: GlyphSnapshot | null;
  error: string | null;
  affectedPointIds: string[] | null;
  canUndo: boolean;
  canRedo: boolean;
};
```

## API Reference

### Snapshot Types
- `PointSnapshot` - Point data (id, x, y, type, smooth)
- `ContourSnapshot` - Contour data (id, points, closed)
- `GlyphSnapshot` - Full glyph state

### Result Types
- `CommandResult` - Mutation response
- `MatchedRule` - Pattern match result

### Enum Types
- `PointTypeString` - "onCurve" | "offCurve"
- `RuleId` - Pattern rule identifiers

### ID Types
- `PointId` - Branded point identifier
- `ContourId` - Branded contour identifier

## Usage Examples

### Working with Snapshots
```typescript
import type { GlyphSnapshot, ContourSnapshot, PointSnapshot } from '@shift/types';

function processGlyph(glyph: GlyphSnapshot): void {
  for (const contour of glyph.contours) {
    for (const point of contour.points) {
      console.log(`Point ${point.id} at (${point.x}, ${point.y})`);
    }
  }
}
```

### Type-Safe IDs
```typescript
import { asPointId, asContourId } from '@/types/ids';

const pointId = asPointId('123');  // PointId
const contourId = asContourId('456');  // ContourId

// Type system prevents mixing
movePoint(pointId, 10, 5);      // OK
movePoint(contourId, 10, 5);    // Error!
```

### Parsing Results
```typescript
import type { CommandResult } from '@shift/types';

const json = engine.addPoint(100, 200, 'onCurve', false);
const result: CommandResult = JSON.parse(json);

if (result.success && result.snapshot) {
  updateUI(result.snapshot);
}
```

## Data Flow

```
Rust Struct Definition
    ↓
#[derive(Serialize, TS)]
#[ts(export, export_to = "...")]
    ↓
cargo test (ts-rs generates files)
    ↓
src/renderer/src/types/generated/*.ts
    ↓
Imported by renderer code
```

## Related Systems

- [shift-core](../../crates/shift-core/docs/DOCS.md) - Source of type definitions
- [shift-node](../../crates/shift-node/docs/DOCS.md) - NAPI type bridges
- [engine](../../src/renderer/src/engine/docs/DOCS.md) - Uses these types
