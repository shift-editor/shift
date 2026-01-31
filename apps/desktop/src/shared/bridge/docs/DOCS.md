# Bridge

Type-safe preload bridge system connecting Rust native functions to the TypeScript renderer.

## Overview

The bridge layer provides compile-time type safety between:

- Rust NAPI bindings (shift-node)
- Electron preload script (contextBridge)
- TypeScript renderer code

Using TypeScript's `satisfies` operator, any missing methods in the preload script cause compile-time errors rather than runtime failures.

## Architecture

```
FontEngineAPI.ts (single source of truth)
        │
        ├──► preload.ts: `satisfies FontEngineAPI` → COMPILE ERROR if incomplete
        │
        └──► native.ts: imports FontEngineAPI → type-safe access
```

### Key Design Decisions

1. **Single Source of Truth**: All bridge types defined in `FontEngineAPI.ts`
2. **Compile-Time Safety**: `satisfies` operator catches missing methods
3. **Type Re-exports**: Native types re-exported from shift-node
4. **Caching**: Native engine instance cached after first access

## Key Concepts

### FontEngineAPI Interface

The interface that preload must satisfy:

```typescript
export interface FontEngineAPI {
  loadFont(path: string): void;
  saveFont(path: string): void;
  getMetadata(): JsFontMetaData;
  getMetrics(): JsFontMetrics;
  // ... all native methods
}
```

### Satisfies Operator

In preload.ts, the API object uses `satisfies`:

```typescript
const fontEngineAPI = {
  loadFont: (path: string) => {
    return fontEngineInstance.loadFont(path);
  },
  // ...
} satisfies FontEngineAPI; // TypeScript error if method missing
```

### Native Access

Renderer code accesses the native engine via helper functions:

```typescript
import { getNative, hasNative } from "@/engine/native";

if (hasNative()) {
  const native = getNative();
  native.loadFont(path);
}
```

## Adding a New Rust Function

1. **Add NAPI function in Rust**:

   ```rust
   #[napi]
   pub fn my_new_function(&self, param: String) -> String {
     // implementation
   }
   ```

2. **Run pnpm dev** - Turbo rebuilds native automatically

3. **Add method to FontEngineAPI**:

   ```typescript
   // In FontEngineAPI.ts
   export interface FontEngineAPI {
     // ...existing methods
     myNewFunction(param: string): string;
   }
   ```

4. **TypeScript shows errors in preload.ts** - add wrapper:

   ```typescript
   myNewFunction: (param: string): string => {
     return fontEngineInstance.myNewFunction(param);
   },
   ```

5. **Done** - method now available via `window.shiftFont`

## Type Re-exports

Native snapshot types are re-exported for convenience:

```typescript
// From FontEngineAPI.ts
export type {
  JsGlyphSnapshot,
  JsContourSnapshot,
  JsPointSnapshot,
  JsFontMetrics,
  JsFontMetaData,
} from "shift-node";

// Usage in renderer
import type { JsGlyphSnapshot } from "@shared/bridge/FontEngineAPI";
```

## Turbo Integration

The `turbo.json` configuration ensures native builds happen before dev:

```json
{
  "tasks": {
    "build:native": {
      "inputs": ["crates/*/src/**", "crates/*/Cargo.toml", "Cargo.toml", "Cargo.lock"],
      "outputs": [
        "crates/shift-node/index.js",
        "crates/shift-node/index.d.ts",
        "crates/shift-node/*.node"
      ]
    },
    "dev": {
      "dependsOn": ["build:native"]
    }
  }
}
```

This enables:

- Automatic native rebuild when Rust changes
- Cached builds when Rust unchanged
- Type generation before TypeScript checks

## Files

| File               | Purpose                               |
| ------------------ | ------------------------------------- |
| `FontEngineAPI.ts` | Interface definition, type re-exports |
| `preload.ts`       | Implements interface via `satisfies`  |
| `native.ts`        | Renderer access helpers               |
| `mock.ts`          | Test implementation                   |

## Related Systems

- [shift-node](../../../../crates/shift-node/docs/DOCS.md) - NAPI bindings
- [preload](../../preload/docs/DOCS.md) - Context bridge
- [engine](../../renderer/src/engine/docs/DOCS.md) - TypeScript wrapper
