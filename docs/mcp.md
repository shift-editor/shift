# Connect an AI agent to Shift

Shift exposes the fonts **currently open in the desktop app** through a local [MCP](https://modelcontextprotocol.io/) server that cannot change a font. Claude Code, Codex, and other HTTP MCP clients can connect directly; no Shift client program or project checkout is required. This is a one-time setup per Shift build and MCP client.

## Turn on agent connections

1. In Shift, open **Settings → Agents** and turn on **Allow agent connections**. It is off by default, and Shift remembers the choice per build.
2. Copy the setup for your client from the same panel, or use the commands below. Configure it at **user scope**, not inside a project.
3. Restart or refresh the client, then call `shift.guide` (how to work with Shift) or `shift.describe` (the exact API) to confirm the connection. Shift must be running, with the setting on, for calls to succeed.

| Build             | MCP name            | URL                          |
| ----------------- | ------------------- | ---------------------------- |
| Shift             | `shift`             | `http://127.0.0.1:17461/mcp` |
| Shift Nightly     | `shift-nightly`     | `http://127.0.0.1:17462/mcp` |
| Shift Dev         | `shift-dev`         | `http://127.0.0.1:17463/mcp` |
| Shift Nightly Dev | `shift-nightly-dev` | `http://127.0.0.1:17464/mcp` |

There is no token. The server answers only on `127.0.0.1`, rejects requests whose `Host` is not local (DNS rebinding), and rejects browser requests from non-local origins, so a web page cannot reach it. Any program running on your computer can connect while the setting is on; turn it off when you don't need it. Agents can inspect, render, and capture fonts, and control what a Shift window shows (see below), but cannot change fonts or files.

### Claude Code

```sh
claude mcp add --transport http --scope user shift http://127.0.0.1:17461/mcp
```

Use the matching name and URL from the table for Nightly or Dev. Check the connection with `claude mcp get shift` or Claude Code's `/mcp` command.

### Codex

Add a server to your **personal** `~/.codex/config.toml` (not a repository's `.codex/config.toml`):

```toml
[mcp_servers.shift]
url = "http://127.0.0.1:17461/mcp"
```

Add another `[mcp_servers.shift-nightly]` or `[mcp_servers.shift-dev]` entry with its matching URL if needed.

### Other MCP clients

Add a **Streamable HTTP** server with the name and URL from the table. Configure it in your personal client settings; Shift does not modify another application's configuration. Keep each build's name distinct so the client doesn't silently switch fonts when you change apps.

## What the connection can control

Agents can control what a Shift window shows, through the same paths as its menus, toolbar, pages list and glyph overview. Nothing here changes font data or a file, or moves `fontRevision`; fonts and files stay read-only over MCP. The one document change is the UI's own: opening a glyph in a new tab adds a glyph page to the document, so the document shows unsaved changes, as it does when you open the glyph yourself.

- `shift.commands.list({ windowId })` lists the app commands an agent may run: the ones that change only the view or session state (Zoom In, Zoom Out, the interface size commands, Select All, Deselect, Close Tab, Settings), each with its menu `title`, its `shortcut`, and whether it is `enabled` now. `shift.commands.run({ windowId, command })` runs one as its menu item does; Close Tab closes the shown tab; with only the glyph overview left it fails with `LastTabError` and the window stays open, since agents do not close windows. Commands that edit font data (Undo and Redo included, since they replay font edits), touch files (Save, Save As, Export, Open, New) or act outside the window (Copy, other windows, help links, updates) are not listed, and running one fails with `CommandNotRunnableError`.
- `shift.editor.setTool({ windowId, tool })` switches tools, `showPage({ windowId, pageId })` shows a page from `editor.inspect`'s `pages`, `openGlyph({ windowId, glyph })` opens a glyph (`{ name }` or `{ glyphId }`) in its tab, as double-clicking it in the overview does, `setView({ windowId, zoom?, center? })` zooms and centres the canvas, and `select({ windowId, ids })` replaces the selection (an empty list clears it). Each answers with the editor inspection afterwards. `editor.inspect` reports the camera as `viewport: { zoom, center }`; `center` is in the open glyph's units (font units, y up) while a glyph is open, and in the page's units otherwise.
- With `ifFontRevision`, a call fails with `FontChangedError` and does nothing when the font has moved on. Other failures are typed: `CommandNotFoundError`, `CommandNotRunnableError`, `CommandDisabledError`, `ToolNotFoundError`, `PageNotFoundError`, `GlyphNotFoundError`, `ObjectNotFoundError`, `LastTabError`, and `CanvasHiddenError` (centring a canvas that is not shown yet).

## What the connection can read

`shift.describe` describes the typed API. `shift.execute` runs bounded code against explicit live Shift window IDs. The first-class `shift.capture` tool returns a point-in-time PNG image plus structured capture metadata for either the visible window contents or its editor canvas panel. Agents can list open sessions; read font info, metric definitions, glyph directories, nested authored source layers, conventional component transformations, and point-in-time editor observations; resolve mapped locations, source metrics, and drawable glyphs at arbitrary axis coordinates; resolve one authored layer's composited outline and component subtrees; and render that layer as portable SVG with optional points, control lines, anchors, component handles, labeled source metrics, and independent advance-width guides. Render calls can apply presentation-only `appearance` overrides and return style-independent structured `guides`. Rendered SVG is a refreshable point-in-time proof, not a live binding. Preview geometry is not authored data. An offline file that is not open in Shift should be inspected with [`shift-cli`](../crates/shift-cli/README.md), not this live server.

Every operation targeting one font window returns `{ fontRevision, value }`. For a composed read inside `shift.execute`, use `shift.read({ windowId }, async (read) => ...)`: it binds one revision, passes it as `ifFontRevision` to every call, and returns plain values. If authored state changes mid-read, the call throws `FontChangedError`, the scope stays stale, and nothing retries; start a new read. Separate MCP requests can carry `fontRevision` into `ifFontRevision` by hand. A revision does not retrieve historical data and is not valid for another window or renderer lifetime. `captureId` still identifies one image and is distinct from the surrounding font revision. Font revisions do not version selection, viewport, focus, or other editor-only state.

```js
async () => {
  const session = (await shift.sessions.list()).find(({ editorConnected }) => editorConnected);
  if (!session) throw new Error("No connected Shift font");

  return shift.read({ windowId: session.windowId }, async (read) => {
    const font = await read.font.get();
    const page = await read.glyphs.list({ limit: 20 });
    return {
      familyName: font.info.familyName,
      glyphNames: page.items.map(({ name }) => name),
      fontRevision: read.fontRevision,
    };
  });
};
```

If a connection fails, check that the build is running and that **Settings → Agents** shows it listening. Shift does **not** switch to another port when its port is occupied; the Agents panel reports the conflict. Quit the app holding the port, then turn agent connections off and on again.
