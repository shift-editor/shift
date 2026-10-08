# MCP

<!-- reviewed: 2026-10-04 review-every: 90d -->

Local code-mode access to the live Shift desktop application.

## Architecture Invariants

- **Architecture Invariant:** `@shift/mcp` is an adapter over `ShiftCapabilities` from `@shift/runtime`. It does not own font, document, editor, window, persistence state, or the reusable plugin contract.
- **Architecture Invariant:** The Fastify MCP adapter binds only to `127.0.0.1`, validates localhost Host and Origin headers, and requires a persistent, private bearer token. Release, Nightly, Dev, and Nightly Dev use distinct fixed ports; a collision leaves MCP unavailable rather than selecting another port. Explicit test instances use port `0`.
- **Architecture Invariant:** `@shift/mcp` owns only the protocol adapter. `@shift/sandbox` owns bounded QuickJS execution against `ShiftCapabilities`; the desktop app owns the utility-process supervisor independently of whether the MCP listener starts.
- **Architecture Invariant:** Every editor request names a window explicitly. Focus changes never retarget an in-flight or subsequent call.
- **Architecture Invariant:** MCP is not Shift's canonical font API. Shared document and editor capabilities remain usable by future plugin and protocol hosts without MCP. The desktop host asks `Font.readAuthoredLayers()` for accepted authored snapshots; agent clients connect through native MCP support rather than a Shift-specific client CLI.

## Codemap

```text
src/
  declarations.ts -- loads @shift/runtime's generated declaration for shift.describe
  types.ts        -- MCP connection contract
  server.ts       -- MCP tools, Fastify loopback HTTP, persistent token, connection descriptor
  index.ts        -- main-process-safe public package surface
```

## Key Types

- `ShiftCapabilities` -- host-neutral live operations owned by `@shift/runtime` and supplied by the desktop application.
- `ShiftSession` -- explicit window and font-session identity, mode, focus, and editor connection status.
- `EditorInspection` -- point-in-time renderer observation for one explicitly targeted session.
- `ShiftMcpServer` -- loopback MCP lifecycle, authentication, connection descriptor, and tool registration.
- `ShiftMcpConnection` -- local URL and persistent bearer token written to the private descriptor.

## How it works

### `shift.describe`

Returns the TypeScript declarations available inside code mode.

### `shift.capture`

Captures one explicitly addressed Shift window as PNG. `target: "window"` captures its visible web contents; `target: "editor"` returns only the editor canvas panel. The optional `scale` is a display-density-independent multiplier of logical UI pixels, bounded from `0.25` to `4`. The native MCP result includes an image content block followed by structured metadata; the reusable code API returns the same metadata plus base64 `data`.

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

`shift.sessions.list()` returns one entry per open font window. `shift.editor.inspect()` returns renderer-owned UI facts. `shift.font.get()` returns metadata, metrics, axes, sources, named instances, and glyph count even on Home. `shift.glyphs.list()` returns bounded directory pages with `nextCursor`; passing an explicit `sourceId` includes each glyph's authored structure for code-mode aggregation. `shift.glyphs.get()` returns one directory entry by exact `name` or stable `glyphId` (not both). `shift.layers.get()` returns authored positions and structure for one glyph/source pair, while `shift.layers.render()` returns point-in-time portable SVG with optional source-addressable overlays, presentation-only `appearance` overrides, and style-independent metric and advance `guides` for that same authored layer. Untrusted inputs are parsed using `@shift/runtime`'s shared Zod schemas; the code-mode sandbox remains bounded.

## Desktop ownership

Electron main starts an app-owned `SandboxRuntimeProcess` and then one `ShiftMcpServer` after `app.whenReady()`. MCP startup failure leaves the sandbox available for other execution hosts. The MCP server writes `mcp.json` under the distribution-specific user-data directory with mode `0600` on POSIX. The descriptor contains the loopback URL and persistent token; an existing valid, private token is reused on restart, while an invalid or insecure descriptor prevents MCP startup. Shutdown leaves the credential in place. The token is local connection material, not a user login. MCP delegates code execution to the app-owned sandbox utility process. First-class capture and sandbox capture calls share the same main-process capability: main resolves the target, asks the renderer for editor bounds when needed, and captures with Electron without exposing host objects. A hard host deadline terminates the process if its internal QuickJS deadline cannot settle; a later execution restarts it.

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

- The connection descriptor survives shutdown. A client must treat connection failure as authoritative when Shift is not running. The descriptor is checked for file type and, on POSIX, private mode before the token is reused; Windows relies on user-data directory ACLs.
- Focus is descriptive only. Always pass a `windowId` from the same `sessions.list()` result used to choose a target.
- A renderer can exist before its agent lane connects. Check `editorConnected` or retry session discovery rather than substituting another window.
- Code-mode results must be JSON-serializable and remain under the configured output bound. Prefer the first-class MCP `shift.capture` tool when the client needs an image content block rather than base64 inside JSON.
- Preview fonts have no authored layers; source-scoped structure reads and renderings fail explicitly. Rendered SVG is refreshable output, not a live binding. Directory cursors do not freeze a changing font; scope counts to an explicit source and restart if the directory changes.

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
