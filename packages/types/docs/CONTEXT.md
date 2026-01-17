# Types - LLM Context

## Quick Facts
- **Purpose**: Shared TypeScript types generated from Rust via ts-rs
- **Language**: TypeScript (generated)
- **Key Files**: `generated/*.ts`, `ids.ts`
- **Dependencies**: ts-rs (Rust crate)
- **Dependents**: All TypeScript code

## File Structure
```
packages/types/
├── package.json    # @shift/types package
└── index.d.ts      # Re-exports from shift-node

src/renderer/src/types/
├── generated/
│   ├── index.ts              # Barrel export
│   ├── PointTypeString.ts    # "onCurve" | "offCurve"
│   ├── PointSnapshot.ts      # Point data
│   ├── ContourSnapshot.ts    # Contour data
│   ├── GlyphSnapshot.ts      # Full glyph
│   ├── CommandResult.ts      # Mutation response
│   ├── RuleId.ts             # Pattern rule IDs
│   └── MatchedRule.ts        # Pattern match result
├── ids.ts                    # Branded ID types
├── math.ts                   # Point2D, Rect2D
├── events.ts                 # Event type definitions
├── graphics.ts               # IRenderer, PathCommand
├── tool.ts                   # Tool interface
└── electron.d.ts             # Window augmentation
```

## Core Abstractions

### Generated Snapshots (types/generated/)
```typescript
// PointSnapshot.ts
export type PointSnapshot = {
  id: string;
  x: number;
  y: number;
  pointType: PointTypeString;
  smooth: boolean;
};

// ContourSnapshot.ts
export type ContourSnapshot = {
  id: string;
  points: PointSnapshot[];
  closed: boolean;
};

// GlyphSnapshot.ts
export type GlyphSnapshot = {
  unicode: number;
  name: string;
  xAdvance: number;
  contours: ContourSnapshot[];
  activeContourId: string | null;
};
```

### CommandResult (types/generated/CommandResult.ts)
```typescript
export type CommandResult = {
  success: boolean;
  snapshot: GlyphSnapshot | null;
  error: string | null;
  affectedPointIds: string[] | null;
  canUndo: boolean;
  canRedo: boolean;
};
```

### Pattern Types (types/generated/)
```typescript
// RuleId.ts
export type RuleId =
  | "moveRightHandle"
  | "moveLeftHandle"
  | "moveBothHandles"
  | "maintainTangencyRight"
  | "maintainTangencyLeft";

// MatchedRule.ts
export type MatchedRule = {
  pointId: string;
  ruleId: RuleId;
  description: string;
  pattern: string;
  affectedPointIds: string[];
};
```

### Branded IDs (types/ids.ts)
```typescript
declare const PointIdBrand: unique symbol;
export type PointId = string & { readonly [PointIdBrand]: unique symbol };

declare const ContourIdBrand: unique symbol;
export type ContourId = string & { readonly [ContourIdBrand]: unique symbol };

export function asPointId(id: string): PointId {
  return id as PointId;
}

export function asContourId(id: string): ContourId {
  return id as ContourId;
}
```

## Key Patterns

### ts-rs Generation
```rust
// In Rust (shift-core/src/snapshot.rs)
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/renderer/src/types/generated/")]
pub struct GlyphSnapshot {
    pub unicode: u32,
    pub name: String,
    pub x_advance: f64,
    pub contours: Vec<ContourSnapshot>,
    pub active_contour_id: Option<String>,
}
```

### Branded Type Safety
```typescript
// Prevents accidental ID mixing
function movePoint(id: PointId): void;
function removeContour(id: ContourId): void;

const pid = asPointId("1");
const cid = asContourId("2");

movePoint(pid);  // OK
movePoint(cid);  // Type error!
```

### String ID Serialization
```typescript
// IDs are u64 in Rust, strings in TypeScript
// Rust: PointId::from_raw(123)
// JSON: { "id": "123" }
// TypeScript: asPointId("123")
```

## API Surface

| Type | Source | Purpose |
|------|--------|---------|
| PointSnapshot | generated | Point data |
| ContourSnapshot | generated | Contour data |
| GlyphSnapshot | generated | Full glyph |
| CommandResult | generated | Mutation response |
| RuleId | generated | Pattern rule ID |
| MatchedRule | generated | Pattern match |
| PointTypeString | generated | Point type enum |
| PointId | ids.ts | Branded point ID |
| ContourId | ids.ts | Branded contour ID |
| Point2D | math.ts | 2D coordinate |
| Rect2D | math.ts | Rectangle |

## Common Operations

### Import generated types
```typescript
import type {
  GlyphSnapshot,
  ContourSnapshot,
  PointSnapshot,
  CommandResult,
} from '@/types/generated';
```

### Create branded IDs
```typescript
import { asPointId, asContourId } from '@/types/ids';

const pointId = asPointId(result.affectedPointIds[0]);
const contourId = asContourId(snapshot.activeContourId!);
```

### Parse command result
```typescript
const json = native.addPoint(x, y, 'onCurve', false);
const result: CommandResult = JSON.parse(json);

if (result.success) {
  const snapshot = result.snapshot!;
  const affectedIds = result.affectedPointIds!.map(asPointId);
}
```

### Type guard for point type
```typescript
function isOnCurve(point: PointSnapshot): boolean {
  return point.pointType === 'onCurve';
}
```

## Generation Process

```bash
# In shift-core directory
cargo test
# ts-rs generates files to types/generated/
```

## Constraints and Invariants

1. **Generated = Read-Only**: Don't manually edit generated files
2. **String IDs**: All IDs are strings in TypeScript
3. **Branded Safety**: Use asPointId/asContourId for type safety
4. **Null Handling**: Optional fields are `T | null`, not `T | undefined`
5. **Rename Convention**: Rust snake_case becomes camelCase via serde
6. **Regenerate on Change**: Must rerun cargo test after Rust changes
