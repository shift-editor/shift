# Boolean Path Operations Plan

Plan for implementing boolean path operations (union, subtract, intersect, XOR) in Shift's font editor.

## Requirements

- Union, difference/subtract, intersect, XOR on glyph outlines
- Must operate on **cubic Bezier curves** natively (not flatten to polygons — that loses curve fidelity and is unacceptable for font work)
- Self-intersection removal (`simplify`) for cleaning up glyph outlines
- Reasonable binary size (Shift is an Electron app, Chrome is already heavy)

## Decision: pathkit-wasm

Use **pathkit-wasm** — a standalone WASM build of Skia's PathOps module.

### Why pathkit-wasm

- **Battle-tested:** Same C++ PathOps engine used by Chrome, Android, and the entire Python font pipeline (`fonttools` + `skia-pathops`). This is the gold standard for boolean ops on Bezier paths.
- **Tiny:** ~300-350 KB uncompressed WASM binary (~100-150 KB gzipped). Negligible in an Electron app.
- **Full cubic Bezier support:** `moveTo`, `lineTo`, `cubicTo`, `quadTo`, `conicTo`, `close`. No polygon flattening.
- **Clean API:** SVG path strings in/out, array-of-commands format, all five boolean operations plus `simplify`.
- **No C++ build dependency:** It's a pre-built WASM binary. Just `npm install pathkit-wasm`.

### Why not the alternatives

| Alternative | Why not |
|---|---|
| **canvaskit-wasm** | ~6.4 MB WASM binary (full Skia rendering engine). PathOps were removed from the default build in v0.11.0 — need a custom build to get them back. Massive overkill. |
| **Paper.js** | Native Bezier boolean ops but notoriously buggy — fails on self-intersecting paths, precision issues, can take minutes on complex shapes. Not reliable for font work. |
| **polygon-clipping / Clipper2** | Polygon-only. Would need to flatten Bezier curves to line segments, losing curve data. |
| **@velipso/polybool** | Cubic Bezier support is explicitly experimental/unstable. |
| **Rust skia-safe** | Full Skia C++ dependency — heavy build (20-40 min), large binary, complicates the Electron build pipeline. |
| **Rust flo_curves** | Pure Rust Bezier boolean ops but low community validation (~96 stars, solo maintainer, v0.8). Less battle-tested. |
| **Rust linesweeper** | Early beta (v0.1.0), GitHub repo archived Jan 2026 and moved to Radicle. Uncertain future. |

### Current state of pathkit-wasm

- **Version:** `1.0.0` (published Feb 2022)
- **Status:** Frozen/stable. No updates since, but the PathOps algorithm is mature and hasn't changed. The code will keep working.
- **npm downloads:** ~1,760/week — still actively consumed
- **Package size:** ~380 KB total (JS glue + WASM binary)

## API Overview

```js
import PathKitInit from "pathkit-wasm";

// Initialise (async, one-time)
const PathKit = await PathKitInit({ wasmBinary });

// Create paths
const path1 = PathKit.FromSVGString("M 0 0 C 10 20 30 40 50 60 Z");
const path2 = PathKit.NewPath();
path2.moveTo(25, 25).cubicTo(50, 0, 75, 50, 100, 25).close();

// Boolean operations
path1.op(path2, PathKit.PathOp.UNION);
path1.op(path2, PathKit.PathOp.DIFFERENCE);
path1.op(path2, PathKit.PathOp.INTERSECT);
path1.op(path2, PathKit.PathOp.XOR);
path1.op(path2, PathKit.PathOp.REVERSE_DIFFERENCE);

// Non-mutating variant (returns new path)
const result = PathKit.MakeFromOp(path1, path2, PathKit.PathOp.UNION);

// Self-intersection removal
path1.simplify();

// Export
const svgD = path1.toSVGString();     // SVG "d" attribute string
const cmds = path1.toCmds();          // [[verb, ...args], ...]

// IMPORTANT: manual memory management (WASM heap, no GC)
path1.delete();
path2.delete();
result.delete();
```

## Electron Integration

### Installation

```bash
pnpm add pathkit-wasm
```

### Loading the WASM binary

`WebAssembly.instantiateStreaming` fails on Electron's `file://` protocol (no MIME type header). Pre-load the binary instead:

```js
import fs from "node:fs";
import path from "node:path";
import PathKitInit from "pathkit-wasm";

const wasmBinary = fs.readFileSync(
  path.join(__dirname, "node_modules/pathkit-wasm/bin/pathkit.wasm")
);

const PathKit = await PathKitInit({ wasmBinary });
```

### Content Security Policy

WASM compilation requires the `wasm-unsafe-eval` directive (narrower than `unsafe-eval` — only permits WASM, not JS `eval`):

```html
<meta
  http-equiv="Content-Security-Policy"
  content="script-src 'self' 'wasm-unsafe-eval'"
/>
```

### Bundler config

PathKit's Emscripten JS glue references Node's `fs` module. If bundling for the renderer process:

```js
// vite.config.ts
export default {
  resolve: {
    alias: { fs: false },
  },
};
```

The `.wasm` file must be copied to the build output (not inlined by the bundler). Use `vite-plugin-static-copy` or similar.

## Implementation Steps

### 1. Install and verify pathkit-wasm loads in Electron

- `pnpm add pathkit-wasm`
- Create a minimal test: load PathKit, union two rectangles, verify output
- Handle WASM loading (pre-read binary, CSP, bundler config)

### 2. Build a PathKit service/wrapper

Create a thin wrapper that:

- Initialises PathKit once (async, at app startup)
- Converts between Shift's internal glyph representation and PathKit paths
- Exposes `union`, `subtract`, `intersect`, `xor`, `simplify` operations
- Handles `path.delete()` cleanup (consider a `using`/disposable pattern or try/finally)

### 3. Wire into glyph editing UI

- Add boolean operation commands to the glyph editor (toolbar buttons, keyboard shortcuts, menu items)
- Selected paths get converted to PathKit paths, operated on, and converted back
- `simplify` available as a cleanup/validate action on any glyph

### 4. Handle edge cases

- Empty paths, single paths (no-op for binary operations)
- Open paths (PathKit expects closed paths for boolean ops — enforce or auto-close)
- Winding direction / fill rules (fonts use non-zero winding; ensure consistency)
- Memory: always clean up PathKit paths after operations

## If we hit a pathkit-wasm bug

The frozen npm package uses a ~2022 Skia snapshot. If we encounter a PathOps correctness bug that has been fixed upstream:

1. Clone the Skia repo
2. Install emsdk (Skia pins a specific version in `infra/wasm-common/docker/emsdk-base/Dockerfile`)
3. Run `modules/pathkit/compile.sh` (needs Python 3, Ninja, GN — expect 30-90 min first build)
4. Output: fresh `pathkit.js` + `pathkit.wasm` with latest fixes

This is a fallback plan only — the frozen 1.0.0 should be fine for the vast majority of glyph operations.
