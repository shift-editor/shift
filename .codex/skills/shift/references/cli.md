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
shift-cli import Family.glyphspackage --output Family.shift    # the whole font: glyphs, kerning, features, instances
shift-cli axis add Lab.shift --tag wght --name Weight --min 100 --default 400 --max 900
shift-cli axis add Lab.shift --tag opsz --name "Optical size" --min 8 --default 12 --max 72 --hidden
shift-cli axis set Lab.shift opsz --visible                  # or --hidden; the fvar hidden flag
shift-cli source add Lab.shift --name Black --location wght=900
shift-cli glyph add Lab.shift A --unicode U+0041
shift-cli layer set Lab.shift --glyph A --source Regular --input A.json
shift-cli glyph set Lab.shift --input glyphs.json --dry-run --json
shift-cli glyph export Inter.glyphspackage --glyphs aacute,one.ss01 > glyphs.json   # any source → the JSON glyph set reads
shift-cli glyph export Inter.glyphspackage --glyphs aacute | shift-cli glyph set Lab.shift --input -
shift-cli glyph color Lab.shift --glyphs A,B,C --color red      # tag glyphs; --clear removes the tag
shift-cli font set Lab.shift --family-name "Packet Mono" --x-height 480 --cap-height 720
shift-cli instance add Lab.shift --name Book --location wght=450
shift-cli kerning set Lab.shift @A @V -60 --source Bold
shift-cli kerning set Lab.shift --input kerning.json --dry-run --json
shift-cli kerning group create Lab.shift O O Q --position first
shift-cli glyph axis add Lab.shift dot --name Spread --min 0 --default 0 --max 100     # an axis only dot has (tag SPRD)
shift-cli glyph axis edit Lab.shift dot SPRD --max 1000 --rescale                      # also --name, --tag; remove
shift-cli glyph swap add Lab.shift dollar dollar.bled --when "Bleed >= 70"         # also remove, move --to N, set
shift-cli component condition set Lab.shift H 2 --when "RSLN >= 50"                     # in every drawing of H
shift-cli layer add Lab.shift --glyph dot --source Regular --location SPRD=100 --input dot-wide.json
shift-cli layer add Lab.shift --glyph H --location BLED=50 --input H-brace.json        # a brace drawing on no source
shift-cli layer move Lab.shift --glyph H --location BLED=50 --to-location BLED=40      # layer remove takes the same place flags
```

- **Shift assigns all identities.** Read the IDs a command returns and use them as selectors; never invent IDs.
- **Layer payloads** are JSON with `advance`, and either `contours` (points with optional `pointType`: `onCurve`, `offCurve`, `qCurve`) or `svgPath`, plus optional `anchors` and `components` (`{"base": "A", "transform": [xx, xy, yx, yy, dx, dy]}`, transform optional). `svgPath` uses font units with **Y up**; an SVG drawn in Y-down screen coordinates must be flipped first. Arc commands are rejected. A layer's optional `metricsKeys` (`{"left", "right", "width"}`, such as `{"width": "=space"}`) link its sidebearings or width for its source only.
- **`layer set` replaces a drawing**, components included: the payload's components replace the layer's. Use `layer copy` to duplicate a layer into another source.
- **`glyph set` applies a batch atomically** and supports `--dry-run`. A component's base may be another glyph in the same batch.
- **Metrics keys** (`=n`, `=n+10`, `=|H`) go in `metricsKeys` on a glyph entry (every source) or on a layer (its source only, winning over the glyph's). They apply in the same edit, as in the app, and keep applying when a glyph they read changes later. A key that cannot be evaluated fails the command without writing. `""` removes a side's key.
- **Mark colours** are the colour tags the app's glyph grid shows and filters by; a glyph has one, whatever the source. `glyph color --glyphs A,B --color NAME` tags many glyphs at once (`--clear` removes the tag). Names are `red`, `orange`, `brown`, `yellow`, `lightGreen`, `darkGreen`, `lightBlue`, `darkBlue`, `purple`, `magenta`, `lightGray`, `charcoal`; any other colour is `r,g,b,a` with channels from 0 to 1. In a `glyph set` entry, `"markColor": "red"` sets it, `null` clears it, and leaving it out keeps it. `glyph export` writes it and `glyph inspect` (and `--json`'s `glyph.markColor`) shows it.
- **`glyph export` copies real glyphs**: it reads named glyphs from any source (`.shift`, UFO, Designspace, Glyphs, TTF, OTF) as the batch `glyph set` reads, adding every glyph their components use. `--source NAME` or `--source all` picks masters (default: the default source). Small exported files are good scratch fixtures: edit them, then `glyph set` them into a document.
- **Glyph axes** (`glyph axis add|edit|remove`) belong to one glyph; values on them are in the axis's own units. A component sets its base glyph's axes in its `location`, by tag (`{"base": "dot", "location": {"SPRD": 60}}`); one that doesn't is at the axis default, never the parent's value. A range edit that would leave a drawing or component location outside is refused and lists them; `--rescale` moves them with the range. `remove` is refused while anything sets the axis.
- **Swaps** (`glyph swap add|remove|move|set`) are other glyphs text draws in a glyph's place where a condition on font axes holds; they are tried in order, the first match wins, and components are never swapped. **Component conditions** (`component condition set`) hide a component wherever they fail, in every drawing of its glyph, and read font axes and the glyph's own axes, never its base glyph's. A condition is one `--when` per range: axis tag or name, then `700`/`>=700`/`700+` (from), `<=80` (up to) or `400-600`, in **user units** on font axes. Swaps and components are named by position from 1 or by the glyph they draw. `glyph set` takes `"swaps": [{"glyph": "dollar.bled", "when": ["BLED>=70"]}]` and a component's `"condition": ["RSLN>=50"]`. `check` warns about a never-used swap (`A001`); `glyph inspect --location` shows `drawn as`. Compiled fonts carry swaps as `rvrn` substitutions, first match first; a designspace export writes them as `<rules>`, and a static instance draws the swap that holds there in the glyph's place. They can't carry component conditions yet: `compile` and `export` refuse a font with any, and `check` warns about each (`A002`); `check` also warns when feature code writes its own `variation rvrn` block beside swaps (`A003`), since only one `rvrn` record applies where both hold; `proof` draws them everywhere and warns (stderr, and `warnings` in `--json`).
- **A drawing can sit anywhere**: `--source`, `--location TAG=VALUE` (font or glyph axes), or both. `--location` without `--source` places it on no source, other axes at their defaults. `glyph set` entries take the same `location` beside `source`. `inspect --json` lists each glyph's `axes` and each layer's `location`.
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

## Compile and export

```sh
shift-cli compile Family.shift --output Family.ttf
shift-cli compile Family.shift --static --output fonts/           # one static .ttf per named instance
shift-cli compile Family.shift --woff2 --output Family.ttf        # also Family.woff2, for the web
shift-cli export Family.shift --output out/Family.designspace   # designspace plus one UFO per master
shift-cli export Family.shift --output Family.ufo               # a font with one master
shift-cli import Family.designspace --output Family.shift       # the reverse: any source into a new document
```

`compile --static` writes each named instance as its own static font, named after its PostScript name; it needs named instances (add them with `instance add`). `export` writes editable sources for other tools and build pipelines; the output's extension picks the format. Masters made in Shift are written as `<name>-<master>.ufo` beside the designspace. A UFO holds one master, so a font with several exports as a designspace. Neither command changes the document. `import` reads a UFO, Designspace, Glyphs, TTF, or OTF font the way the app opens one and writes it as a new `.shift`; it refuses an existing output and lists what the import dropped (`--json` for scripts).

Compile after authoring to confirm the font builds. A compile error usually names the glyph and source; incompatible masters are the most common cause in variable fonts (see [variable-fonts.md](variable-fonts.md)).
