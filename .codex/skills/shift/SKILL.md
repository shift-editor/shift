---
name: shift
description: Work with fonts in the Shift font editor. Use for questions about the font, glyph, source, selection, or view open in the running Shift app (through its local MCP server), for reading, authoring, or compiling saved .shift documents and other font files with shift-cli, and for font concepts such as contours, components, masters, and variable fonts.
---

# Shift

Shift is a desktop font editor. An agent can reach it in two ways; pick by where the font is.

| The font is… | Use | Read |
| --- | --- | --- |
| Open in the running Shift app, or the user means "what I'm looking at" | The local **MCP server** (`shift.describe`, `shift.execute`, `shift.capture`) | [references/mcp.md](references/mcp.md) |
| A saved file (`.shift`, UFO, Designspace, Glyphs, TTF, OTF), a batch job, or CI | **`shift-cli`** | [references/cli.md](references/cli.md) |

For vocabulary and conventions shared by both, read [references/fonts.md](references/fonts.md); for axes, masters, instances, and interpolation, read [references/variable-fonts.md](references/variable-fonts.md).

## Rules

- **The live MCP is read-only.** It inspects, resolves, renders, and captures; it cannot change a font. To change a font, save it in Shift and edit the file with `shift-cli`, or describe the change for the user to make. Never claim an edit happened through MCP.
- **A saved file does not include unsaved app edits.** Say so when the answer depends on which one you read.
- **Check exact signatures at the source.** For the MCP API, call `shift.describe`; for the CLI, run `shift-cli --help` and `shift-cli <command> --help`. This skill describes workflows and interpretation, not every parameter.
- **Target explicitly.** Use the `windowId` from `shift.sessions.list()`. If a window or session disappears, list sessions again and say so; never silently switch to another font.
- **Report transient state.** An editor mid-drag or with edits still applying is not settled; say so when it affects the answer.
- **Preview sessions are read-only.** A font opened as a preview has no authored layers to read or edit.
- **Look before you judge.** To assess how a glyph looks, render it (`shift.layers.render`) or capture the editor (`shift.capture`) and inspect the image. Do not claim a shape looks right from coordinates alone.

## If the MCP server is unreachable

Shift serves MCP only while **Settings → Agents → Allow agent connections** is on, and only while the app is running. Each build (Shift, Nightly, Dev) has its own server name and port; the Agents panel shows the exact setup command. Ask the user to turn it on rather than guessing ports.
