# shift-cli

`shift-cli` reads, authors, and compiles fonts on disk, without the app running. Use it for saved files, batch work, and CI.

## Install

In Shift, choose **Shift → Install Command Line Tool…** (on Windows and Linux, **Help → Install Command Line Tool…**). That puts `shift-cli` on your `PATH`, built from the same version as the app. Shift Nightly installs `shift-cli-nightly` and development builds install `shift-cli-dev`, so each build keeps its own command. Check with `shift-cli --version`. Run `shift-cli --help` and `shift-cli <command> --help` for every command and flag; this page explains when to use them.

To give agents this skill without the app's MCP server, run `shift-cli skill install` in a project, or `shift-cli skill install --global` for every project. It writes the skill matching this `shift-cli` to `.agents/skills/shift` (Codex, OpenCode, VS Code, Cursor) and `.claude/skills/shift` (Claude Code); Shift's install action offers the global install and refreshes it after updates. `shift-cli skill status` reports a copy that no longer matches, and `shift-cli skill show [topic]` prints a section.

## Read

```sh
shift-cli inspect Family.shift                     # summary of a .shift document
shift-cli inspect --view glyphs Family.shift        # also: axes, mappings, instances, sources, layers, kerning
shift-cli inspect --json Family.shift               # complete report for scripts
shift-cli glyph inspect Family.ufo A --json         # one glyph from .shift, UFO, Designspace, Glyphs, TTF, or OTF
shift-cli glyph inspect Family.designspace A --location wght=700 --view variation
shift-cli font info Family.shift --source Bold --json
shift-cli kerning list Family.designspace --glyph A    # authored pairs, one column per master
shift-cli kerning groups Family.ufo --json
shift-cli kerning get Family.shift A V --location wght=650
```

- `--json` always emits the complete report; `--view` only changes the human-readable output.
- Locations are external (user-facing) `TAG=VALUE` coordinates; Shift maps them into design space once.
- `glyph inspect` reports structure, which sources have a layer, compatibility, the interpolation model, and resolved geometry at a location.
- `kerning get` is the answer to "how much do these two glyphs kern?": per master it gives the value and the authored pair that supplied it (glyph pair, exception, or group pair), and at `--location` the value the compiled font applies. Use it rather than adding up pairs from `kerning list` yourself. Kerning reads take `.shift`, UFO, Designspace, or Glyphs sources, not compiled TTF/OTF.

## Author

Authoring commands work on `.shift` documents and change them atomically: an invalid change leaves the file untouched.

```sh
shift-cli font create Lab.shift
shift-cli font create Lab.shift --from Family.glyphspackage   # names, UPM, metrics, axes, masters; no glyphs
shift-cli axis add Lab.shift --tag wght --name Weight --min 100 --default 400 --max 900
shift-cli source add Lab.shift --name Black --location wght=900
shift-cli glyph add Lab.shift A --unicode U+0041
shift-cli layer set Lab.shift --glyph A --source Regular --input A.json
shift-cli glyph set Lab.shift --input glyphs.json --dry-run --json
shift-cli glyph export Inter.glyphspackage --glyphs aacute,one.ss01 > glyphs.json   # any source → the JSON glyph set reads
shift-cli glyph export Inter.glyphspackage --glyphs aacute | shift-cli glyph set Lab.shift --input -
shift-cli font set Lab.shift --family-name "Packet Mono" --x-height 480 --cap-height 720
shift-cli instance add Lab.shift --name Book --location wght=450
shift-cli kerning set Lab.shift @A @V -60 --source Bold
shift-cli kerning set Lab.shift --input kerning.json --dry-run --json
shift-cli kerning group create Lab.shift O O Q --position first
```

- **Shift assigns all identities.** Read the IDs a command returns and use them as selectors; never invent IDs.
- **Layer payloads** are JSON with `advance`, and either `contours` (points with optional `pointType`: `onCurve`, `offCurve`, `qCurve`) or `svgPath`, plus optional `anchors` and `components` (`{"base": "A", "transform": [xx, xy, yx, yy, dx, dy]}`, transform optional). `svgPath` uses font units with **Y up**; an SVG drawn in Y-down screen coordinates must be flipped first. Arc commands are rejected.
- **`layer set` replaces a drawing**, components included: the payload's components replace the layer's. Use `layer copy` to duplicate a layer into another source.
- **`glyph set` applies a batch atomically** and supports `--dry-run`. A component's base may be another glyph in the same batch.
- **`glyph export` copies real glyphs**: it reads named glyphs from any source (`.shift`, UFO, Designspace, Glyphs, TTF, OTF) as the batch `glyph set` reads, adding every glyph their components use. `--source NAME` or `--source all` picks masters (default: the default source). Small exported files are good scratch fixtures: edit them, then `glyph set` them into a document.
- Instances are presets, not masters: instance commands never create sources or drawings.
- **Kerning sides**: `first` is the left glyph, and its first-position group kerns its right edge; `second` is the right glyph. A side is a glyph name or `@GROUP` for a group at that position. Values are per master and default to the default source; set every master you mean to change.
- **`kerning set --input`** applies `groups` (created if missing; `members` replaces membership) and then `pairs` (`value: null` removes) atomically, so pairs can name groups the batch creates.

## Check and proof

```sh
shift-cli check Family.glyphs                       # problems in masters, axes, outlines, kerning
shift-cli check Family.designspace --json           # findings with stable codes for scripts and CI
shift-cli check Lab.shift --charset latin1 --mono   # opt-in character-set and monospace checks
shift-cli proof Lab.shift --output proof.png        # look at what you drew
shift-cli proof Lab.shift --output weights.png --masters --text "HOHnon"
shift-cli proof Lab.shift --output grid.png --grid
```

- Run `check` after authoring and before compiling. Errors (exit status 1) mean the font won't build or a glyph renders wrongly somewhere in the design space; fix those first. Codes starting with `I` are interpolation problems between a master and the default master, and name the glyph, master, and contour.
- **Look before you claim a glyph is right.** `proof` compiles the source in memory and draws real shaped text; read the PNG. `--masters`, `--instances`, and repeated `--at TAG=VALUE` stack the same text at several locations, which is how interpolation problems show. `/name` in `--text` sets a glyph by name (`--text "H/a.ss01H"`).
- Missing characters are drawn red and listed in `missingCharacters` in `--json`, so an agent can check coverage without reading pixels.

## Compile

```sh
shift-cli compile Family.shift --output Family.ttf
```

Compile after authoring to confirm the font builds. A compile error usually names the glyph and source; incompatible masters are the most common cause in variable fonts (see [variable-fonts.md](variable-fonts.md)).
