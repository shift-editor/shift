---
name: shift
description: Inspect and work with the font and editor currently open in the live Shift desktop application through its local MCP code-mode API. Use for live Shift sessions, current glyph/source/selection/tool state, font-development investigation, and agent workflows that need the running app rather than a closed file.
---

# Live Shift

Use the live MCP connection when the user refers to the font, glyph, source, selection, tool, or view currently open in Shift. Use `shift-cli` instead for closed documents, batch processing, or CI.

## Connect

From a Shift checkout with dependencies installed, use the packaged client:

```sh
pnpm exec shift-mcp connections
```

The client discovers run descriptors for Shift, Shift Nightly, and development builds. Set `SHIFT_MCP_DESCRIPTOR=/absolute/path/to/mcp.json` when Shift uses a custom user-data directory. If multiple applications are running, pass `--descriptor <path>` explicitly; never guess.

## Discover the API

```sh
pnpm exec shift-mcp describe --descriptor <path>
```

The typed API exposes `shift.sessions.list()`, `shift.editor.inspect({ windowId })`, `shift.font.get({ windowId })`, `shift.glyphs.list({ windowId, limit?, cursor?, sourceId? })`, `shift.glyphs.get({ windowId, glyphId })` or `shift.glyphs.get({ windowId, name })`, and `shift.layers.get({ windowId, glyphId, sourceId })` inside `shift.execute`.

## Execute code

Pass an async zero-argument function on stdin to avoid shell escaping:

```sh
pnpm exec shift-mcp execute --descriptor <path> <<'EOF'
async () => {
  const sessions = await shift.sessions.list();
  const session = sessions.find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  return shift.editor.inspect({ windowId: session.windowId });
}
EOF
```

Always target the explicit `windowId` returned by `sessions.list()`. Do not assume focus is stable. `editor.inspect()` reports a point-in-time renderer observation; `font.get()` returns Home-safe metadata, metrics, axes, global master sources, named instances, and glyph count. Individual glyphs may advertise additional authored `sourceIds` for non-master support layers; those IDs are also valid for layer reads. `glyphs.get()` resolves one glyph by exact name or stable ID, without scanning the directory; provide exactly one of `name` or `glyphId`. `glyphs.list()` returns directory entries with an opaque `nextCursor` (pass it back as `cursor` until null). Supply a specific `sourceId` to include authored `structure` for each glyph in a bounded page; `null` means no layer in that source. `layers.get()` returns positions and structure for one authored glyph/source layer, or `null` if the layer is absent. Preview sessions expose font and glyph directory facts but have no authored layers; these operations are read-only.

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
    const page = await shift.glyphs.list({ windowId: session.windowId, sourceId: source.id, cursor, limit: 20 });
    for (const glyph of page.items) anchors += glyph.structure?.anchors.length ?? 0;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { sourceId: source.id, anchors };
}
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
