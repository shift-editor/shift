# MCP

<!-- reviewed: 2026-10-02 review-every: 90d -->

Local code-mode access to the live Shift desktop application.

## Architecture Invariants

- **Architecture Invariant:** `@shift/mcp` is an adapter over `ShiftCapabilities` from `@shift/runtime`. It does not own font, document, editor, window, persistence state, or the reusable plugin contract.
- **Architecture Invariant:** The server binds to `127.0.0.1` on a random port, validates localhost Host and Origin headers, and requires a random secret generated for one application run. It never listens on a public interface.
- **Architecture Invariant:** Agent-written code runs in a fresh QuickJS runtime with bounded time, memory, source size, and result size. Desktop hosts that runtime in a dedicated utility process so generated code cannot block or crash Electron main. It has no Node.js, filesystem, environment, Electron, or network globals.
- **Architecture Invariant:** Every editor request names a window explicitly. Focus changes never retarget an in-flight or subsequent call.
- **Architecture Invariant:** MCP is not Shift's canonical font API. Shared document and editor capabilities remain usable by future plugin and protocol hosts without MCP.

## Codemap

```text
src/
  declarations.ts -- loads @shift/runtime's generated declaration for shift.describe
  types.ts        -- MCP connection contract
  code.ts         -- bounded QuickJS execution over ShiftCapabilities
  runtime.ts      -- isolated-runtime-only package surface
  server.ts       -- MCP tools, loopback HTTP, run secret, connection descriptor
  index.ts        -- main-process-safe public package surface
```

## Key Types

- `ShiftCapabilities` -- host-neutral live operations owned by `@shift/runtime` and supplied by the desktop application.
- `ShiftSession` -- explicit window and font-session identity, mode, focus, and editor connection status.
- `EditorInspection` -- point-in-time renderer observation for one explicitly targeted session.
- `ShiftMcpServer` -- loopback MCP lifecycle, authentication, connection descriptor, and tool registration.
- `ShiftMcpConnection` -- run-scoped local URL and bearer token written to the private descriptor.

## How it works

### `shift.describe`

Returns the TypeScript declarations available inside code mode.

### `shift.execute`

Accepts an async zero-argument JavaScript function and returns its JSON result. For a targeted live session:

```ts
async () => {
  const session = (await shift.sessions.list()).find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target session closed");
  const font = await shift.font.get({ windowId: session.windowId });
  const page = await shift.glyphs.list({ windowId: session.windowId, limit: 20 });
  return {
    family: font.metadata.familyName,
    count: font.glyphCount,
    names: page.items.map((g) => g.name),
  };
};
```

`shift.sessions.list()` returns one entry per open font window. `shift.editor.inspect()` returns renderer-owned UI facts. `shift.font.get()` returns metadata, metrics, axes, sources, named instances, and glyph count even on Home. `shift.glyphs.list()` returns bounded directory pages with `nextCursor`; passing an explicit `sourceId` includes each glyph's authored structure for code-mode aggregation. `shift.glyphs.get()` returns one directory entry by exact `name` or stable `glyphId` (not both), and `shift.layers.get()` returns authored positions and structure for one glyph/source pair. Untrusted inputs are parsed using `@shift/runtime`'s shared Zod schemas; the code-mode sandbox remains bounded.

## Desktop ownership

Electron main starts one `ShiftMcpServer` and one `SandboxRuntimeProcess` after `app.whenReady()`. It writes `mcp.json` under the distribution-specific user-data directory with mode `0600`. The descriptor contains the loopback URL and run secret; it is local connection material, not a user login. MCP delegates execution to the sandbox utility process, and main serves only the typed capability requests that return from that process. A hard host deadline terminates the sandbox if its internal QuickJS deadline cannot settle.

Each renderer serves an agent request lane over a transferred `MessagePort`. Main pairs renderer observations with the explicit window and font-session identities before returning them. Launcher windows are excluded from session discovery.

## Workflow recipes

### Add a capability

1. Put reusable semantic computation in its existing domain owner or shared Rust capability layer.
2. Add the public snapshot or operation to `@shift/runtime` and regenerate its code API.
3. Extend the desktop host implementation and sandbox protocol.
4. Route document truth to utility ownership and view truth to renderer ownership.
5. Add package contract coverage and a real desktop integration test.
6. Update the `shift` agent skill with the intended workflow.

Do not expose internal `Editor`, `FontStore`, `WorkspaceHost`, NAPI, SQLite rows, or arbitrary IPC through this package.

## Gotchas

- The connection descriptor is removed during graceful shutdown, but an application crash can leave a stale descriptor. A client must treat connection failure as authoritative.
- Focus is descriptive only. Always pass a `windowId` from the same `sessions.list()` result used to choose a target.
- A renderer can exist before its agent lane connects. Check `editorConnected` or retry session discovery rather than substituting another window.
- Code-mode results must be JSON-serializable and remain under the configured output bound.
- Preview fonts have no authored layers; source-scoped structure reads fail explicitly. Directory cursors do not freeze a changing font; scope counts to an explicit source and restart if the directory changes.

## Verification

```sh
pnpm --filter @shift/mcp test
pnpm --filter @shift/mcp typecheck
pnpm --filter @shift/mcp lint:check
pnpm typecheck
```

## Related

- [`packages/runtime/docs/DOCS.md`](../../runtime/docs/DOCS.md) -- canonical protocol and plugin capability contracts.
- [`apps/desktop/src/main/docs/DOCS.md`](../../../apps/desktop/src/main/docs/DOCS.md) -- Electron lifecycle, window/session identity, and renderer lanes.
- [`apps/desktop/src/preload/docs/DOCS.md`](../../../apps/desktop/src/preload/docs/DOCS.md) -- authenticated `MessagePort` transfer into the renderer.
- [`docs/architecture/index.md`](../../../docs/architecture/index.md) -- repository documentation routing and API boundaries.
