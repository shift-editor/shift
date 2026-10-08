# Connect an AI agent to Shift

Shift exposes the fonts **currently open in the desktop app** through a local, read-only [MCP](https://modelcontextprotocol.io/) server. Claude Code, Codex, and other HTTP MCP clients can connect directly; no Shift client program or project checkout is required. This is a one-time setup per Shift build and MCP client.

## Find your connection

1. Start Shift. It creates a private `mcp.json` in its user-data directory. Open that file **locally** and copy its `url` and `token` fields. Never share the token with an agent, put it in a prompt, or commit it to a repository.
2. Configure your MCP client at **user scope**, not inside a project. Add the HTTP URL and the header `Authorization: Bearer <token>`. You can add just the Shift builds you use.
3. Restart or refresh the client, then call `shift.describe` to confirm the connection. Shift must be running for calls to succeed.

| Build             | MCP name            | URL                          | User-data directory name |
| ----------------- | ------------------- | ---------------------------- | ------------------------ |
| Shift             | `shift`             | `http://127.0.0.1:17461/mcp` | `Shift`                  |
| Shift Nightly     | `shift-nightly`     | `http://127.0.0.1:17462/mcp` | `Shift Nightly`          |
| Shift Dev         | `shift-dev`         | `http://127.0.0.1:17463/mcp` | `Shift Dev`              |
| Shift Nightly Dev | `shift-nightly-dev` | `http://127.0.0.1:17464/mcp` | `Shift Nightly Dev`      |

The user-data directory is normally under `~/Library/Application Support/` on macOS, `%APPDATA%\` on Windows, and `${XDG_CONFIG_HOME:-~/.config}/` on Linux. If Shift was launched with `--user-data-dir`, its `mcp.json` is there instead. Each build has a **different token**. The file remains after Shift quits, and the token survives relaunches; its URL is only reachable while that build is running.

### Claude Code

Use Claude Code's [user-scoped MCP configuration](https://code.claude.com/docs/en/mcp). On macOS/Linux, the following reads the token from your clipboard without putting it in shell history (paste when `read` waits for input):

```sh
read -rs SHIFT_MCP_TOKEN
claude mcp add --transport http --scope user shift http://127.0.0.1:17461/mcp \
  --header "Authorization: Bearer $SHIFT_MCP_TOKEN"
unset SHIFT_MCP_TOKEN
```

Use the matching name and URL from the table for Nightly or Dev, and copy **that build's token**. Claude Code stores the header in your private user configuration; keep that file private. Check the connection with `claude mcp get shift` or Claude Code's `/mcp` command.

### Codex

Add a server to your **personal** `~/.codex/config.toml` (not a repository's `.codex/config.toml`). Replace the placeholder with the token from your private Shift `mcp.json`:

```toml
[mcp_servers.shift]
url = "http://127.0.0.1:17461/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

Add another `[mcp_servers.shift-nightly]` or `[mcp_servers.shift-dev]` entry with its matching URL and token if needed. Protect the token-bearing file from other users (for example, `chmod 600 ~/.codex/config.toml` on macOS/Linux), and never copy it into a project. Codex also supports `bearer_token_env_var` if you prefer to supply the token through your own secret manager instead of storing it in client configuration.

### Other MCP clients

Add a **Streamable HTTP** server with the name and URL from the table, and set its `Authorization` header to `Bearer <token>`. Configure it in your personal client settings; Shift does not modify another application's configuration. Keep each build's name distinct so the client doesn't silently switch fonts when you change apps.

## What the connection can read

`shift.describe` describes the typed API. `shift.execute` runs bounded, read-only code against explicit live Shift window IDs. The first-class `shift.capture` tool returns a point-in-time PNG image plus structured capture metadata for either the visible window contents or its editor canvas panel. Agents can list open sessions; read font info, metric definitions, glyph directories, nested authored source layers, conventional component transformations, and point-in-time editor observations; resolve mapped locations, source metrics, and drawable glyphs at arbitrary axis coordinates; and render one authored layer as portable SVG with optional points, control lines, anchors, component handles, labeled source metrics, and independent advance-width guides. Render calls can apply presentation-only `appearance` overrides and return style-independent structured `guides`. Rendered SVG is a refreshable point-in-time proof, not a live binding. Preview geometry is not authored data. An offline file that is not open in Shift should be inspected with [`shift-cli`](../crates/shift-cli/README.md), not this live server.

Every operation targeting one font window returns `{ fontRevision, value }`. For a composed read, take the first result's opaque `fontRevision` and pass it as `ifFontRevision` to every later call. Shift rejects the sequence if authored state changed; the token does not retrieve historical data and is not valid for another window or renderer lifetime. `captureId` still identifies one image and is distinct from the surrounding font revision. Font revisions do not version selection, viewport, focus, or other editor-only state.

```js
async () => {
  const session = (await shift.sessions.list()).find(({ editorConnected }) => editorConnected);
  if (!session) throw new Error("No connected Shift font");

  const observedFont = await shift.font.get({ windowId: session.windowId });
  const ifFontRevision = observedFont.fontRevision;
  const page = await shift.glyphs.list({
    windowId: session.windowId,
    ifFontRevision,
    limit: 20,
  });

  return {
    familyName: observedFont.value.info.familyName,
    glyphNames: page.value.items.map(({ name }) => name),
    fontRevision: ifFontRevision,
  };
};
```

If a connection fails, make sure that build is running and its URL matches the file. Shift does **not** switch to another port when the assigned one is occupied; close the conflicting process and restart Shift. An invalid or insecure `mcp.json` is not overwritten automatically. To deliberately rotate a token, quit Shift, move the private `mcp.json` out of its user-data directory, start Shift again, and update your MCP clients with the new token. Keep the old file private or delete it when you no longer need it.
