# MCP

<!-- reviewed: 2026-10-04 review-every: 90d -->

Local code-mode access to the live Shift desktop application.

## Architecture Invariants

- **Architecture Invariant:** `@shift/mcp` is an adapter over `ShiftCapabilities` from `@shift/runtime`. It does not own font, document, editor, window, persistence state, or the reusable plugin contract.
- **Architecture Invariant:** The Fastify MCP adapter binds only to `127.0.0.1`, and validates localhost Host and Origin headers (DNS-rebinding and browser defence, pinned by tests). There is no token; the host runs the server only while the user allows agent connections. Release, Nightly, Dev, and Nightly Dev use distinct fixed ports; a collision leaves MCP unavailable rather than selecting another port. Explicit test instances use port `0`.
- **Architecture Invariant:** `@shift/mcp` owns only the protocol adapter. `@shift/sandbox` owns bounded QuickJS execution against `ShiftCapabilities`; the desktop app owns the utility-process supervisor independently of whether the MCP listener starts.
- **Architecture Invariant:** Every editor request names a window explicitly. Focus changes never retarget an in-flight or subsequent call.
- **Architecture Invariant:** Every targeted call preserves `ShiftObservation<T>` and its `fontRevision`; MCP never invents a transport-specific snapshot identity or strips revision preconditions from scripting.
- **Architecture Invariant:** MCP is not Shift's canonical font API. Shared document and editor capabilities remain usable by future plugin and protocol hosts without MCP. The desktop host asks `Font.readLayers()` and `Font.resolveLayers()` for accepted authored layers; agent clients connect through native MCP support rather than a Shift-specific client CLI.

## Codemap

```text
src/
  declarations.ts -- loads @shift/runtime's generated declaration for shift.describe
  guide.ts        -- bundles skills/shift for shift.guide and the initialize instructions
  types.ts        -- MCP connection and activity contracts
  server.ts       -- MCP tools, Fastify loopback HTTP, activity tracking
  index.ts        -- main-process-safe public package surface
```

## Key Types

- `ShiftCapabilities` -- host-neutral live operations owned by `@shift/runtime` and supplied by the desktop application.
- `ShiftSession` -- explicit window and font-session identity, mode, focus, and editor connection status.
- `ShiftObservation` and `FontRevision` -- authored-revision correlation shared by code mode and native capture metadata.
- `EditorInspection` -- point-in-time renderer observation for one explicitly targeted session.
- `ShiftMcpServer` -- loopback MCP lifecycle, tool registration, and recent-activity tracking.
- `ShiftMcpConnection` -- the local URL a started server answers on.
- `ShiftMcpActivity` -- the last request time and the clients that recently sent `initialize`; the request path is stateless, so activity stands in for "connected".

## How it works

### `shift.describe`

Returns the TypeScript declarations available inside code mode.

### `shift.capture`

Captures one explicitly addressed Shift window as PNG. `target: "window"` captures its visible web contents; `target: "editor"` returns only the editor canvas panel. The optional `scale` is a display-density-independent multiplier of logical UI pixels, bounded from `0.25` to `4`. The native MCP result includes an image content block followed by `{ fontRevision, value }` metadata; the reusable code API returns the same observation with base64 `value.data`.

### `shift.execute`

Accepts an async zero-argument JavaScript function and returns its JSON result. For a targeted live session:

```js
async () => {
  const session = (await shift.sessions.list()).find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target session closed");
  return shift.read({ windowId: session.windowId }, async (read) => {
    const font = await read.font.get();
    const page = await read.glyphs.list({ limit: 20 });
    return {
      family: font.info.familyName,
      count: font.glyphCount,
      names: page.items.map((g) => g.name),
    };
  });
};
```

`shift.sessions.list()` returns one entry per open font window. Every targeted operation returns `{ fontRevision, value }`; pass the first token as `ifFontRevision` to later related calls so stale composition fails explicitly. `shift.editor.inspect()` returns renderer-owned UI facts. `shift.font.get()` returns `info`, metrics, metric definitions, axes, sources, instances, and glyph count even on Home. `shift.locations.resolve()` maps arbitrary external coordinates and resolves source metrics. `shift.glyphs.list()` returns bounded directory pages with `nextCursor` and stable layer references; passing an explicit `sourceId` includes each glyph's nested authored `layer` for code-mode aggregation. `shift.glyphs.get()` returns one directory entry by exact `name` or stable `glyphId` (not both). `shift.glyphs.resolve()` returns drawable paths and advance widths at an arbitrary location. Layer operations take one stable `layerId` from a glyph's advertised `layers`. `shift.layers.get()` returns nested contours, points, components, transformations, and anchors for that authored layer; `shift.layers.resolve()` returns its composited outline and each direct component's subtree outline and bounds; and `shift.layers.render()` returns point-in-time portable SVG with optional source-addressable overlays, presentation-only `appearance` overrides, and style-independent metric and advance `guides` for that same layer. `shift.kerning.groups()` lists font-wide kerning groups with their members; `shift.kerning.pairs()` pages through one source's authored pairs, optionally only those that apply to one glyph; and `shift.kerning.resolve()` returns what the compiled font kerns between glyph pairs at a source or location, with every source's value, whether it is authored, 0 because the source kerns other pairs, or interpolated, and which kind of pair applies. Kerning is read-only here like every other capability. `shift.read({ windowId }, async (read) => ...)` binds one font revision for a composed read and returns plain values; a change mid-read throws `FontChangedError` and is never retried. Untrusted inputs are parsed using `@shift/runtime`'s shared Zod schemas; the code-mode sandbox remains bounded.

## Desktop ownership

Electron main starts an app-owned `SandboxRuntimeProcess` after `app.whenReady()`. Its `AgentConnections` owns the persisted "Allow agent connections" setting (off by default) and starts a `ShiftMcpServer` only while it is on; Settings → Agents toggles it with a switch and shows a copyable MCP config snippet, an example prompt, and recent activity. MCP startup failure leaves the sandbox available for other execution hosts. Clients receive `instructions` on `initialize` pointing them to `shift.guide`, which serves the `skills/shift` skill bundled into this build, and to `shift.describe`. MCP delegates code execution to the app-owned sandbox utility process. First-class capture and sandbox capture calls share the same main-process capability: main resolves the target, asks the renderer for editor bounds when needed, and captures with Electron without exposing host objects. A hard host deadline terminates the process if its internal QuickJS deadline cannot settle; a later execution restarts it.

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

- A client must treat connection failure as authoritative when Shift is not running or agent connections are off. Without a token, any local process can connect while the setting is on; the read-only tool surface and the explicit, persisted opt-in are the protection.
- Focus is descriptive only. Always pass a `windowId` from the same `sessions.list()` result used to choose a target.
- A renderer can exist before its agent lane connects. Check `editorConnected` or retry session discovery rather than substituting another window.
- Code-mode results must be JSON-serializable and remain under the configured output bound. Prefer the first-class MCP `shift.capture` tool when the client needs an image content block rather than base64 inside JSON.
- Preview fonts have no authored layers; source-scoped layer reads and renderings fail explicitly. Rendered SVG is refreshable output, not a live binding. Directory cursors do not freeze a changing font; guard pagination with one `fontRevision` and restart after a mismatch.
- `fontRevision` is renderer-session-local, opaque, and non-orderable. It versions authored font truth, not selection, viewport, focus, or other editor-only state. `captureId` remains a distinct identity for one image.

## Verification

```sh
pnpm --filter @shift/mcp test
pnpm --filter @shift/mcp typecheck
pnpm --filter @shift/mcp lint:check
pnpm typecheck
```

## Related

- [`packages/runtime/docs/DOCS.md`](../../runtime/docs/DOCS.md) -- canonical protocol and plugin capability contracts.
- [`packages/sandbox/docs/DOCS.md`](../../sandbox/docs/DOCS.md) -- reusable execution boundary and process lifecycle.
- [`docs/mcp.md`](../../../docs/mcp.md) -- one-time user-scoped native MCP setup for installed Shift builds.
- [`apps/desktop/src/main/docs/DOCS.md`](../../../apps/desktop/src/main/docs/DOCS.md) -- Electron lifecycle, window/session identity, and renderer lanes.
- [`apps/desktop/src/preload/docs/DOCS.md`](../../../apps/desktop/src/preload/docs/DOCS.md) -- authenticated `MessagePort` transfer into the renderer.
- [`docs/architecture/index.md`](../../../docs/architecture/index.md) -- repository documentation routing and API boundaries.
