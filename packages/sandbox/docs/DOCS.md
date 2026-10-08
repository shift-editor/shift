# Sandbox

<!-- reviewed: 2026-10-04 review-every: 90d -->

Bounded Shift code execution over host-supplied typed capabilities, independent of MCP transport.

## Architecture Invariants

- **Architecture Invariant:** `@shift/sandbox` executes against `ShiftCapabilities` from `@shift/runtime`. It owns no MCP endpoint, Electron app state, renderer, document, or font persistence. Hosts decide how to supply capabilities and when execution is allowed.
- **Architecture Invariant:** Each `executeShiftCode()` call gets a fresh QuickJS realm with only the explicitly installed `shift` read API. Code has no Node.js, filesystem, environment, Electron, or network globals; output must be JSON-compatible.
- **Architecture Invariant:** Source, memory, stack, result, and execution time are bounded. The Electron host additionally supervises execution in a utility process and stops that process on its hard deadline. Neither this one-shot API nor the current read-only capability contract promises persistent plugin state or mutation authority.
- **Architecture Invariant:** The sandbox preserves `ShiftObservation<T>` unchanged. Scripts explicitly carry `fontRevision` into later `ifFontRevision` inputs; the executor does not pin, cache, or silently refresh authored state.

## Codemap

```text
src/
  execute.ts      -- QuickJS realm, capability installation, quotas, and JSON result
  execute.test.ts -- sandbox and capability-boundary behavior
  index.ts        -- host-neutral execution entrypoint
```

## Key Types

- `ShiftCapabilities` -- host-supplied, explicitly targeted observation operations; defined by `@shift/runtime`.
- `ShiftObservation` -- one value correlated with an opaque authored `fontRevision` for guarded multi-call scripts.
- `executeShiftCode()` -- one-shot execution of an async function against those capabilities.
- `SandboxRuntimeProcess` -- Electron host supervisor, not part of this package.

## How it works

### Desktop ownership

`App` owns `SandboxRuntimeProcess` independently of MCP. The process starts when the app is ready; a timeout or crash stops it, and its next `execute()` starts a replacement. App quit stops it. An MCP listener failure leaves the app-owned sandbox available for another host. The utility process routes capability requests through typed main-process calls; main resolves the explicitly targeted renderer, workspace data, and point-in-time window or editor capture.

This is the first **one-shot** execution mode, not a full interactive plugin lifecycle. A future scripting host can use the same executor and capability contract. Long-lived tool contributions would need explicit registration, cancellation, preview, and disposal semantics rather than inheriting the lifetime of an MCP request.

Within one execution, a script starts a composed read with any targeted capability, keeps its returned `fontRevision`, and supplies that token as `ifFontRevision` to subsequent font, location, glyph, layer, editor, or capture calls. A mismatch rejects the script call rather than returning mixed authored state. The token is scoped to the targeted live renderer and does not version editor-only selection or viewport state.

## Workflow recipes

### Add a capability

1. Add its contract and input schema in `@shift/runtime`.
2. Install a validated callback in `executeShiftCode()` without exposing host objects or globals.
3. Wire the desktop utility/main host and test the capability through the executor and a real desktop boundary.

## Gotchas

- A fresh realm means scripts cannot keep globals, subscriptions, or tool instances across calls.
- The runtime package owns capability contracts, not the QuickJS engine. Electron owns the supervised process, not this package.
- Authored layers and preview geometry have different semantics; the sandbox does not decide which is authoritative.
- Capture data enters the realm as `observation.value.data` base64. Return only the metadata needed when a code-mode result does not need to carry the image itself.
- Font data uses the shared scripting vocabulary from `@shift/runtime`: `info`, sources, instances, nested layer contours/components/anchors, `advanceWidth`, and affine `transformation`. The sandbox defines no aliases or transport-specific shapes.

## Verification

```sh
pnpm --filter @shift/sandbox test
pnpm --filter @shift/sandbox typecheck
pnpm --filter @shift/sandbox lint:check
```

## Related

- [`packages/runtime/docs/DOCS.md`](../../runtime/docs/DOCS.md) -- canonical capability contracts.
- [`packages/mcp/docs/DOCS.md`](../../mcp/docs/DOCS.md) -- first transport adapter using the sandbox.
- [`apps/desktop/src/main/docs/DOCS.md`](../../../apps/desktop/src/main/docs/DOCS.md) -- desktop sandbox process ownership.
