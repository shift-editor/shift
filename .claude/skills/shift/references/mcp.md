# Live Shift over MCP

## Connect

In Shift, open **Settings → Agents** and turn on **Allow agent connections** (off by default). The panel shows a ready-to-copy Claude Code command, an MCP config snippet with this build's server name and local URL for other agents, and an example prompt to test the connection. There is no token: the server answers only on `127.0.0.1`, and only while the setting is on and the app is running.

| Build         | Server name     | URL                          |
| ------------- | --------------- | ---------------------------- |
| Shift         | `shift`         | `http://127.0.0.1:17461/mcp` |
| Shift Nightly | `shift-nightly` | `http://127.0.0.1:17462/mcp` |
| Shift Dev     | `shift-dev`     | `http://127.0.0.1:17463/mcp` |

For example, Claude Code: `claude mcp add --transport http --scope user shift http://127.0.0.1:17461/mcp`. Register each build under its own name so a client never silently switches fonts between them.

## Tools

- `shift.guide` returns this skill and its references, matching the running build.
- `shift.describe` returns the complete typed API available inside `shift.execute`. Read it before writing code; it is the source of truth for parameters and return shapes.
- `shift.execute` runs an async zero-argument **JavaScript** function against the live API and returns its JSON result.
- `shift.capture` returns a PNG of a Shift window or its editor canvas as an image block.

## Write code for `shift.execute`

```js
async () => {
  const [session] = await shift.sessions.list();
  if (!session) throw new Error("No Shift window is open");
  return shift.read({ windowId: session.windowId }, async (read) => {
    const font = await read.font.get();
    const glyph = await read.glyphs.get({ name: "A" });
    const regular = font.sources.find(({ name }) => name === "Regular");
    const layer = glyph.layers.find(({ sourceId }) => sourceId === regular?.id);
    return layer ? read.layers.resolve({ layerId: layer.layerId }) : null;
  });
};
```

- **Target a window explicitly.** `shift.sessions.list()` returns one entry per open font window; pass its `windowId`.
- **Compose reads inside `shift.read`.** It binds one font revision for the whole callback and returns plain values. If the font changes mid-read, calls throw an error named `FontChangedError` and the scope stays stale; start a new `shift.read` rather than mixing revisions. Outside a scope, each call returns `{ fontRevision, value }`, and you can pass `fontRevision` as `ifFontRevision` to later calls yourself.
- **Address layers by `layerId`.** A glyph lists its layers as `{ layerId, sourceId }`. `layers.get` returns authored contours, points, components, and anchors; `layers.resolve` returns the composited outline (`svgPath`, `bounds`) and each direct component's subtree outline; `layers.render` returns a portable SVG proof with optional point, anchor, component, metric, and advance overlays.
- **Resolve arbitrary locations** with `locations.resolve` (axis coordinates → design location, exact source, metrics) and `glyphs.resolve` (drawable paths and advances at a location).
- **Page through glyphs** with `glyphs.list` and its `nextCursor`. A cursor is not a snapshot; read every page inside one `shift.read`. Large scans can hit the execution deadline: return partial results with the cursor and continue.
- **Keep results small.** Filter and map inside the function instead of returning whole responses. The function has no filesystem, network, or Node.js access.

## Interpret what you read

- `editor.inspect` reports the selection, tool, and location in one window. `dragging: true` or an `applyStatus` other than `"idle"` means the view is mid-change.
- A font revision covers authored font data only, not selection, viewport, or focus.
- Rendered SVG and captures are point-in-time proofs, not live views. Render again after changes.
- Coordinates are font units with **Y pointing up**; SVG output flips Y for display.
