# Live Shift over MCP

## Connect

In Shift, open **Settings → Agents** and turn on **Allow agent connections** (off by default). The panel shows a ready-to-copy Claude Code command, an MCP config snippet with this build's server name and local URL for other agents, and an example prompt to test the connection. There is no token: the server answers only on `127.0.0.1`, and only while the setting is on and the app is running.

| Build         | Server name     | URL                          | Command-line tool   |
| ------------- | --------------- | ---------------------------- | ------------------- |
| Shift         | `shift`         | `http://127.0.0.1:17461/mcp` | `shift-cli`         |
| Shift Nightly | `shift-nightly` | `http://127.0.0.1:17462/mcp` | `shift-cli-nightly` |
| Shift Dev     | `shift-dev`     | `http://127.0.0.1:17463/mcp` | `shift-cli-dev`     |

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
  return shift.read({ windowId: session.windowId }, (read) =>
    read.layers.resolve({ glyph: { name: "A" }, source: { name: "Regular" } }),
  );
};
```

- **Target a window explicitly.** `shift.sessions.list()` returns one entry per open font window; pass its `windowId`.
- **Compose reads inside `shift.read`.** It binds one font revision for the whole callback and returns plain values. If the font changes mid-read, calls throw an error named `FontChangedError` and the scope stays stale; start a new `shift.read` rather than mixing revisions. Outside a scope, each call returns `{ fontRevision, value }`, and you can pass `fontRevision` as `ifFontRevision` to later calls yourself.
- **Select glyphs, sources, and layers by name or id.** A glyph is `{ name }` or `{ glyphId }`, a source `{ name }` or `{ sourceId }`, never both. A layer is `{ layerId }`, or `{ glyph, source? }` for that glyph's layer at a source (the default source when `source` is omitted); a glyph lists its layers as `{ layerId, sourceId }`. Wherever a read takes a source, it takes it as `source: { name }` or `source: { sourceId }`. `layers.get` returns authored contours, points, components, and anchors; `layers.resolve` returns the composited outline (`svgPath`, `bounds`) and each direct component's subtree outline; `layers.render` returns a portable SVG proof with optional point, anchor, component, metric, and advance overlays.
- **Read the font's designspace** with `font.get`: its `axes`, the `axisMappings` from user to source coordinates (as `avar` stores them), `sources`, and `instances`. `sources.get({ name })` (or `{ sourceId }`) and `instances.get({ name })` (or `{ instanceId }`) return one source or instance without searching the list.
- **Resolve arbitrary locations** with `locations.resolve` (axis coordinates → design location, exact source, metrics) and `glyphs.resolve` (drawable paths and advances at a location).
- **Read kerning** with `kerning.groups`, `kerning.pairs`, `kerning.resolve`, and `kerning.at` (see below).
- **Page through glyphs** with `glyphs.list` and its `nextCursor`. A cursor is not a snapshot; read every page inside one `shift.read`. Large scans can hit the execution deadline: return partial results with the cursor and continue.
- **Keep results small.** Filter and map inside the function instead of returning whole responses. The function has no filesystem, network, or Node.js access.

## Read kerning

Kerning is read-only over MCP. Groups are font-wide; pair values are per master (source).

```js
async () => {
  const [session] = await shift.sessions.list();
  return shift.read({ windowId: session.windowId }, async (read) => {
    const { items } = await read.kerning.resolve({
      pairs: [
        { first: { name: "T" }, second: { name: "o" } },
        { first: { name: "A" }, second: { name: "V" } },
      ],
      source: { name: "Regular" }, // or `location: [...]`, or neither for the default location
    });
    return items.map(({ first, second, amount, masters }) => ({
      pair: `${first.name}${second.name}`,
      amount,
      masters: masters.map(({ amount, origin, rule }) => ({ amount, origin, rule })),
    }));
  });
};
```

- `kerning.groups({ position? })` lists groups with their member glyphs. A `first` group kerns before the other glyph (UFO `public.kern1`), a `second` group after it (`public.kern2`).
- `kerning.pairs({ source?, glyph?, limit?, cursor? })` pages through the pairs authored at one master (the default source when `source` is omitted). Each side is `{ kind: "glyph", glyphId, name }` or `{ kind: "group", groupId, name }`. `glyph` (`{ name }` or `{ glyphId }`) keeps pairs naming that glyph directly or through its group at that position.
- `kerning.resolve({ pairs, source? | location? })` answers what the compiled font kerns between two glyphs, each `{ name }` or `{ glyphId }` as in `kerning.at`. Do not recompute this yourself: the specific pair beats the general one, and a master's value depends on whether it kerns anything.
- `kerning.at({ first, second, source? })` reads one pair at one master (the default source when `source` is omitted), with glyphs as `{ name }` or `{ glyphId }`. It returns that master's entry from `kerning.resolve`'s `masters`: `{ sourceId, amount, origin, rule, pair }`.
- Every resolution lists each master: `origin` is `authored` (a pair applies there), `unkerned` (the master kerns other pairs but not this one, so 0), or `interpolated` (the master authors no kerning and takes the blend of those that do). `rule` is `glyph` (glyph against glyph), `exception` (a glyph against a group, overriding the group pair), `group` (group against group), or `none`.
- Useful audits: glyphs missing from the group their base glyph is in; pairs authored at some masters and not others; exceptions whose value equals their group pair; a sign that flips between masters.

## Interpret what you read

- `editor.inspect` reports the selection, tool, and location in one window. `dragging: true` or an `applyStatus` other than `"idle"` means the view is mid-change.
- A font revision covers authored font data only, not selection, viewport, or focus.
- Rendered SVG and captures are point-in-time proofs, not live views. Render again after changes.
- Coordinates are font units with **Y pointing up**; SVG output flips Y for display.
