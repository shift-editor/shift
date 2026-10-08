---
name: shift
description: Inspect and work with the font and editor currently open in the live Shift desktop application through its local MCP code-mode API. Use for live Shift sessions, current glyph/source/selection/tool state, font-development investigation, and agent workflows that need the running app rather than a closed file.
---

# Live Shift

Use the live MCP connection when the user refers to the font, glyph, source, selection, tool, or view currently open in Shift. Use `shift-cli` instead for closed documents, batch processing, or CI.

## Connect

Configure your agent's native MCP client once with the running app's URL and private token; see the [one-time setup guide](../../../docs/mcp.md). Release, Nightly, Dev, and Nightly Dev have separate named connections. Never check in or disclose the token. No Shift-specific client CLI is needed.

## Discover the API

Call the native `shift.describe` MCP tool. The typed API exposes `shift.capture`, `shift.sessions.list`, `shift.editor.inspect`, `shift.font.get`, `shift.locations.resolve`, `shift.glyphs.list`, `shift.glyphs.get`, `shift.glyphs.resolve`, `shift.layers.get`, and `shift.layers.render` inside `shift.execute`. Every operation targeting a font window accepts optional `ifFontRevision` and returns `{ fontRevision, value }`.

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

Always target the explicit `windowId` returned by `sessions.list()`. Do not assume focus is stable. Start a composed read with any targeted operation, keep its opaque `fontRevision`, and pass it as `ifFontRevision` to every later related call. A mismatch means authored state changed: restart the read. The token is scoped to one live renderer, retrieves no historical data, and does not version selection or viewport state. `captureId` separately identifies one image inside the surrounding observation.

`font.get().value` returns Home-safe `info`, metrics, metric definitions, axes, global designspace sources, instances, and glyph count. Glyphs advertise stable `layers` as `{ layerId, sourceId }`, including glyph-specific support layers. `glyphs.get()` resolves one glyph by exact name or stable ID; provide exactly one of `name` or `glyphId`. `glyphs.list()` returns bounded directory pages with an opaque `nextCursor`. Supply `sourceId` to include each entry's nested authored `layer`; `null` means sparse absence. `layers.get().value` returns `advanceWidth`, `contours[].points`, components with conventional affine `transformation`, and anchors for one authored glyph/source layer. `locations.resolve()` maps arbitrary external axis coordinates and resolves source metrics. `glyphs.resolve()` returns drawable paths and advances at such a location.

`layers.render().value` returns portable SVG for one authored layer; request any combination of `points`, `controlLines`, `anchors`, `components`, `fontMetrics`, and `advanceWidth` under `overlays`. `fontMetrics` draws labeled horizontal source metrics; `advanceWidth` independently draws vertical origin and advance guides. Component outlines resolve recursively with the canvas's source-fallback rules; `components` adds handles for components authored directly in the requested layer. `appearance` accepts presentation-only color overrides, while structured `guides` remain style-independent. Point, anchor, and component elements retain Shift IDs in `data-shift-id`. Rendered SVG is a point-in-time, read-only proof. Preview sessions expose font and glyph directory facts but have no authored layers; all capabilities remain read-only.

## Capture the UI

Call the native `shift.capture` MCP tool with `{ windowId, target: "window" | "editor", scale?, ifFontRevision? }` when the client should receive an image content block. `window` captures visible Shift web contents; `editor` crops to the visible editor canvas panel and fails if that window has no editor. `scale` defaults to `1`, accepts `0.25` through `4`, and multiplies logical UI pixels independently of display density. Structured metadata is `{ fontRevision, value }`, where `value` includes `captureId`, dimensions, scale, and `capturedAt`. The same function is available inside `shift.execute`; its PNG is base64 `observation.value.data`, which scripts should omit from results unless needed.

For example, count authored anchors in one explicitly chosen source, paging without returning every glyph:

```js
async () => {
  const session = (await shift.sessions.list()).find((session) => session.sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  const observedFont = await shift.font.get({ windowId: session.windowId });
  const source = observedFont.value.sources.find((source) => source.name === "Regular");
  if (!source) throw new Error("Target source is not open");
  const target = { windowId: session.windowId, ifFontRevision: observedFont.fontRevision };
  let cursor;
  let anchors = 0;
  do {
    const observedPage = await shift.glyphs.list({
      ...target,
      sourceId: source.id,
      cursor,
      limit: 20,
    });
    for (const glyph of observedPage.value.items) anchors += glyph.layer?.anchors.length ?? 0;
    cursor = observedPage.value.nextCursor ?? undefined;
  } while (cursor);
  return { sourceId: source.id, anchors, fontRevision: observedFont.fontRevision };
};
```

To produce an annotated proof of one authored layer:

```js
async () => {
  const session = (await shift.sessions.list()).find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  const font = await shift.font.get({ windowId: session.windowId });
  const target = { windowId: session.windowId, ifFontRevision: font.fontRevision };
  const glyph = await shift.glyphs.get({ ...target, name: "A" });
  const source = font.value.sources.find(({ name }) => name === "Regular");
  if (!source) throw new Error("Target source is not open");
  return shift.layers.render({
    ...target,
    glyphId: glyph.value.id,
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

A cursor is not a frozen snapshot; guard every page with the same `fontRevision`. Large scans may exceed the sandbox deadline: return a partial result, `nextCursor`, and `fontRevision` to continue, then restart if that revision is stale.

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
- `observation.value.dragging: true` or `observation.value.applyStatus !== "idle"` means editor-only state may be transient or unsettled. Say so when it affects the answer.
- A missing or closed window is an error. Re-list sessions instead of silently switching targets.
- Do not use this interface as a replacement for regression tests. Reproduce and prove fixes through the repository's normal unit or Electron E2E boundary.
