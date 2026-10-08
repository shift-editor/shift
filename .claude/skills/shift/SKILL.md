---
name: shift
description: Inspect and work with the font and editor currently open in the live Shift desktop application through its local MCP code-mode API. Use for live Shift sessions, current glyph/source/selection/tool state, font-development investigation, and agent workflows that need the running app rather than a closed file.
---

# Live Shift

Use the live MCP connection when the user refers to the font, glyph, source, selection, tool, or view currently open in Shift. Use `shift-cli` instead for closed documents, batch processing, or CI.

## Connect

Configure your agent's native MCP client once with the running app's URL and private token; see the [one-time setup guide](../../../docs/mcp.md). Release, Nightly, Dev, and Nightly Dev have separate named connections. Never check in or disclose the token. No Shift-specific client CLI is needed.

## Discover the API

Call the native `shift.describe` MCP tool. The typed API exposes `shift.capture({ windowId, target, scale? })`, `shift.sessions.list()`, `shift.editor.inspect({ windowId })`, `shift.font.get({ windowId })`, `shift.glyphs.list({ windowId, limit?, cursor?, sourceId? })`, `shift.glyphs.get({ windowId, glyphId })` or `shift.glyphs.get({ windowId, name })`, `shift.layers.get({ windowId, glyphId, sourceId })`, and `shift.layers.render({ windowId, glyphId, sourceId, overlays? })` inside `shift.execute`.

## Execute code

Call the native `shift.execute` MCP tool, passing an async zero-argument function in its `code` argument:

```js
async () => {
  const sessions = await shift.sessions.list();
  const session = sessions.find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  return shift.editor.inspect({ windowId: session.windowId });
};
```

Always target the explicit `windowId` returned by `sessions.list()`. Do not assume focus is stable. `capture()` returns an immutable PNG observation with a unique `captureId`; it is not a font revision. `editor.inspect()` reports a point-in-time renderer observation; `font.get()` returns Home-safe metadata, metrics, axes, global master sources, named instances, and glyph count. Individual glyphs may advertise additional authored `sourceIds` for non-master support layers; those IDs are also valid for layer reads. `glyphs.get()` resolves one glyph by exact name or stable ID, without scanning the directory; provide exactly one of `name` or `glyphId`. `glyphs.list()` returns directory entries with an opaque `nextCursor` (pass it back as `cursor` until null). Supply a specific `sourceId` to include authored `structure` for each glyph in a bounded page; `null` means no layer in that source. `layers.get()` returns positions and structure for one authored glyph/source layer, or `null` if the layer is absent. `layers.render()` returns portable SVG for that authored layer; request any combination of `points`, `controlLines`, `anchors`, `components`, `fontMetrics`, and `advanceWidth` under `overlays`. `fontMetrics` draws labeled horizontal source metrics; `advanceWidth` independently draws the vertical origin and advance guides. Component outlines resolve recursively with the canvas's source-fallback rules; `components` adds handles for components authored directly in the requested layer. `appearance` accepts presentation-only color overrides, while the response's structured `guides` remain style-independent. Point, anchor, and component elements retain their Shift IDs in `data-shift-id`. The SVG is a point-in-time, read-only proof, not a live binding: call `layers.render()` again to refresh it after edits. Preview sessions expose font and glyph directory facts but have no authored layers; these operations are read-only.

## Capture the UI

Call the native `shift.capture` MCP tool with `{ windowId, target: "window" | "editor", scale? }` when the client should receive an image content block. `window` captures the visible Shift web contents; `editor` crops to the visible editor canvas panel and fails if that window has no editor. `scale` defaults to `1`, accepts `0.25` through `4`, and multiplies logical UI pixels independently of display density. The result also includes `captureId`, dimensions, scale, and `capturedAt` metadata. The same `shift.capture()` function is available inside `shift.execute` for scripts that need to combine capture metadata with other reads, but its PNG is base64 `data`; omit that data from the script result unless needed.

For example, count authored anchors in one explicitly chosen source, paging without returning every glyph:

```js
async () => {
  const session = (await shift.sessions.list()).find((session) => session.sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  const font = await shift.font.get({ windowId: session.windowId });
  const source = font.sources.find((source) => source.name === "Regular");
  if (!source) throw new Error("Target source is not open");
  let cursor;
  let anchors = 0;
  do {
    const page = await shift.glyphs.list({
      windowId: session.windowId,
      sourceId: source.id,
      cursor,
      limit: 20,
    });
    for (const glyph of page.items) anchors += glyph.structure?.anchors.length ?? 0;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { sourceId: source.id, anchors };
};
```

To produce an annotated proof of one authored layer:

```js
async () => {
  const session = (await shift.sessions.list()).find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  const glyph = await shift.glyphs.get({ windowId: session.windowId, name: "A" });
  const font = await shift.font.get({ windowId: session.windowId });
  const source = font.sources.find(({ name }) => name === "Regular");
  if (!source) throw new Error("Target source is not open");
  return shift.layers.render({
    windowId: session.windowId,
    glyphId: glyph.id,
    sourceId: source.id,
    overlays: {
      points: true,
      controlLines: true,
      anchors: true,
      components: true,
      fontMetrics: true,
    },
    appearance: { outlineFill: "#111111", metricStroke: "#999999" },
  });
};
```

A live directory may change between pages; a cursor is not a frozen snapshot. Large scans may exceed the sandbox deadline: return a partial result and `nextCursor` to continue in another call rather than assuming the entire font fits one execution.

Keep returned values focused. Filter and map inside code mode instead of returning complete intermediate responses. Generated code has no filesystem, network, environment, Node.js, or Electron access.

## Saved fonts without Shift

Use the Rust `shift-cli` binary, not the live MCP, for a file that is not open in the app. From the Shift checkout, install or update it after pulling changes with `cargo install --path crates/shift-cli --bin shift-cli --locked --force` (inside the repository's Nix dev shell). For a one-off query without installation, use `cargo run -p shift-cli --` in place of `shift-cli`.

```sh
shift-cli inspect --json /absolute/path/Family.shift
shift-cli glyph inspect /absolute/path/Family.ufo A --json
```

`inspect --json` exposes `.shift` glyph directories and per-layer counts; `glyph inspect --json` accepts `.shift`, UFO, Designspace, Glyphs, TTF, and OTF and reports glyph structure, source-layer presence, and resolved geometry. Its `--view` flag changes human-readable output, **not** the JSON report. Use `fontTools` for low-level UFO/OpenType format questions where useful, but do not describe its data as Shift's authored source model. Neither CLI JSON command currently returns every authored layer's point and anchor coordinates: ask for a CLI read extension if a saved-file question requires those rather than substituting interpolated/resolved geometry. Do not claim the disk file includes unsaved app edits.

## Safety and interpretation

- The connection secret is transport material, not a user login. Never print or include it in conversation output.
- A preview session is read-only; do not imply that it can be edited.
- `dragging: true` or `applyStatus !== "idle"` means the observation may include transient or unsettled editor state. Say so when it affects the answer.
- A missing or closed window is an error. Re-list sessions instead of silently switching targets.
- Do not use this interface as a replacement for regression tests. Reproduce and prove fixes through the repository's normal unit or Electron E2E boundary.
