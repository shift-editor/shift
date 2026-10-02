---
name: shift
description: Inspect and work with the font and editor currently open in the live Shift desktop application through its local MCP code-mode API. Use for live Shift sessions, current glyph/source/selection/tool state, font-development investigation, and agent workflows that need the running app rather than a closed file.
---

# Live Shift

Use the live MCP connection when the user refers to the font, glyph, source, selection, tool, or view currently open in Shift. Use `shift-cli` instead for closed documents, batch processing, or CI.

## Connect

Run scripts relative to this skill directory:

```sh
node scripts/client.mjs connections
```

The client discovers run descriptors for Shift, Shift Nightly, and development builds. Set `SHIFT_MCP_DESCRIPTOR=/absolute/path/to/mcp.json` when Shift uses a custom user-data directory. If multiple applications are running, pass `--descriptor <path>` explicitly; never guess.

## Discover the API

```sh
node scripts/client.mjs describe --descriptor <path>
```

The first slice exposes `shift.sessions.list()` and `shift.editor.inspect({ windowId })` inside `shift.execute`.

## Execute code

Pass an async zero-argument function on stdin to avoid shell escaping:

```sh
node scripts/client.mjs execute --descriptor <path> <<'EOF'
async () => {
  const sessions = await shift.sessions.list();
  const session = sessions.find(({ sessionId }) => sessionId === "...");
  if (!session) throw new Error("Target Shift session is not open");
  return shift.editor.inspect({ windowId: session.windowId });
}
EOF
```

Always target the explicit `windowId` returned by `sessions.list()`. Do not assume focus is stable. Treat `editor.inspect()` as a point-in-time renderer observation: it reports the current glyph occurrence, active/editing sources, external location, selection, tool, gesture flags, and workspace apply status. It does not return authored glyph geometry or commit edits in this first slice.

Keep returned values focused. Filter and map inside code mode instead of returning complete intermediate responses. Generated code has no filesystem, network, environment, Node.js, or Electron access.

## Safety and interpretation

- The connection secret is transport material, not a user login. Never print or include it in conversation output.
- A preview session is read-only; do not imply that it can be edited.
- `dragging: true` or `applyStatus !== "idle"` means the observation may include transient or unsettled editor state. Say so when it affects the answer.
- A missing or closed window is an error. Re-list sessions instead of silently switching targets.
- Do not use this interface as a replacement for regression tests. Reproduce and prove fixes through the repository's normal unit or Electron E2E boundary.
