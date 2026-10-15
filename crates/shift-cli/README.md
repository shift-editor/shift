# shift-cli

Command-line inspection, authoring, and compilation for canonical SQLite `.shift` documents.

The crate builds the `shift-cli` binary. `inspect` opens a document, summarizes the font model, and can emit stable JSON for scripts and CI. Resource commands apply semantic Shift intents through a temporary recovery overlay and save only after the complete change validates. `compile` sends the canonical Shift model directly through fontir/fontc to produce a TrueType font.

## Install

Shift bundles a release `shift-cli` with every desktop build, so the command always matches the app. In Shift, choose **Shift → Install Command Line Tool…** on macOS, or **Help → Install Command Line Tool…** on Windows and Linux:

- **macOS and Linux packages** link `/usr/local/bin/shift-cli` to the app's copy, asking for an administrator password when that directory is protected.
- **Linux AppImage** copies it to `~/.local/bin/shift-cli` (add that directory to `PATH` if needed); Shift refreshes the copy after updates.
- **Windows** adds the app's `bin` directory to your user `PATH`; open a new terminal afterwards.

Shift Nightly installs the same binary as `shift-cli-nightly`, and development builds as `shift-cli-dev` (macOS and Linux only), so release, Nightly, and development builds never replace each other's command. If your terminal finds a different `shift-cli` earlier on `PATH`, such as a `cargo install` build, Shift names it after installing.

## Agent skill

The binary embeds the Shift agent skill (`skills/shift`) and installs the copy that matches it, so agents learn this command's workflows without the app's MCP server:

```sh
shift-cli skill install            # .agents/skills/shift and .claude/skills/shift in this project
shift-cli skill install --global   # the same under your home directory
shift-cli skill status --global    # current, stale, missing, or foreign for each copy
shift-cli skill show variable-fonts
shift-cli skill show themes
```

Each build installs its own skill, named after its command: `shift`, `shift-nightly`, `shift-dev`. A non-release skill opens by naming its command. `SKILL.md` records the version and command in `metadata`, and `status` compares every file, so a stale reference is caught as well as a stale `SKILL.md`. A same-named skill that `shift-cli` did not install is replaced only with `--force`. Shift's **Install Command Line Tool…** offers the global install, and the app refreshes an installed copy at launch with `--refresh-only`.

`shift-cli --version` prints the Shift product version from the root `package.json`, which the release and Nightly workflows set before building.

To build it from a checkout instead, run `pnpm build:cli` (or `cargo build --release -p shift-cli`); packaging the desktop app requires that build.

## Usage

```sh
cargo run -p shift-cli -- inspect path/to/Family.shift
cargo run -p shift-cli -- inspect --view axes path/to/Family.shift
cargo run -p shift-cli -- inspect --view mappings path/to/Family.shift
cargo run -p shift-cli -- inspect --view sources path/to/Family.shift
cargo run -p shift-cli -- inspect --view layers path/to/Family.shift
cargo run -p shift-cli -- inspect --view kerning path/to/Family.shift
cargo run -p shift-cli -- inspect --json path/to/Family.shift
cargo run -p shift-cli -- glyph inspect path/to/Family.glyphs Aacute
cargo run -p shift-cli -- glyph inspect path/to/Family.designspace Aacute \
  --location wght=700 --view variation --json
cargo run -p shift-cli -- compile path/to/Family.shift --output path/to/Family.ttf

cargo run -p shift-cli -- font create path/to/Lab.shift
cargo run -p shift-cli -- font create path/to/Lab.shift --from path/to/Family.glyphspackage
cargo run -p shift-cli -- axis add path/to/Lab.shift \
  --tag wght --name Weight --min 100 --default 400 --max 900
cargo run -p shift-cli -- source add path/to/Lab.shift \
  --name Black --location wght=900
cargo run -p shift-cli -- glyph add path/to/Lab.shift A \
  --unicode U+0041
cargo run -p shift-cli -- layer add path/to/Lab.shift \
  --glyph A --source Regular --input A-regular.json
cargo run -p shift-cli -- layer copy path/to/Lab.shift \
  --glyph A --from-source Regular --source Black
```

Human-readable output is quiet by default and uses plain text when stdout is redirected. Use `--json` when another tool needs the complete report.

Document inspection views:

- `summary`: document identity, schema, counts, and sources
- `axes`: variable font axes
- `mappings`: independent and cross-axis mappings
- `sources`: design sources and locations
- `glyphs`: glyph names, Unicode values, and layer counts
- `layers`: glyph layer source bindings and geometry counts
- `kerning`: group counts and each master's pairs by kind (glyph, exception, group), counting pairs whose glyph or group no longer exists

`glyph inspect` reads one glyph through Shift's semantic font model from `.shift`, UFO,
Designspace, Glyphs, TTF, or OTF input. Locations use external/user-space `TAG=VALUE`
coordinates and are mapped once into design space. Its views are:

- `summary`: identity, location, selection mode, bounds, and geometry counts
- `structure`: resolved root contours, anchors, and ordered component occurrences
- `sources`: layer presence and structural compatibility by source
- `variation`: selected interpolation model, source weights, and support regions
- `resolved`: location-evaluated points with components flattened

`--json` emits the complete `GlyphInspection` regardless of the selected human-readable view.

## Check

`check` reports problems that make a font build, interpolate, or render differently from what was drawn, in any source Shift reads:

```sh
shift check Family.glyphs
shift check Family.designspace --json
shift check Lab.shift --charset latin1
shift check Mono.ufo --mono --width 600
```

Findings carry a stable code, a fixed severity, the glyph, master, and contour concerned, and a message. Codes group by subject:

- `D` axes and masters: no master at the default (`D001`), masters at the same location (`D002`), a master outside its axis (`D003`), a mapping that turns back on itself (`D004`), an axis that runs past its last master (`D005`).
- `I` interpolation against the default master: a glyph missing from the default master (`I001`), incompatible structure (`I002`), compatible layers that can't interpolate (`I003`), a contour whose different start point breaks the shape halfway (`I004`), a contour running the other way (`I005`), contours in each other's place (`I006`), a contour that turns inside out between masters (`I007`), masters using components differently (`I008`, a warning: compilers decompose these, Shift's preview leaves the master out).
- `O` drawing, per master: open contours (`O001`), contours too small to draw (`O002`), coordinates that aren't numbers (`O003`), invalid advances (`O004`), a contour wholly inside another and winding the same way (`O005`), an encoded glyph that draws nothing in the default master (`O006`), a glyph that can't be drawn (`O007`). Glyphs marked not to export, and unencoded `_` part glyphs, are skipped.
- `K` kerning: a pair through an empty group (`K001`), a pair naming a glyph or group not in the font (`K002`).
- `C` and `M`, opt-in: `--charset ascii|latin1|FILE` requires characters (a file lists characters, `U+XXXX` scalars, and `U+XXXX..U+YYYY` ranges, one per line); `--mono [--width N]` requires one advance width, the most common one per master when no width is given.

Problems the reader had to work around, such as kerning pairs naming missing glyphs or a repeated named instance, are listed as `note:` lines and under `import` in `--json`. `check` exits with status 1 when any finding is an error.

## Proof

`proof` renders text or a glyph grid set in a font to a PNG or SVG, so people and agents can look at what they drew without opening the app or installing the font:

```sh
shift proof Lab.shift --output proof.png
shift proof Lab.shift --output proof.png --text "HOHOHOnnnooo" --sizes 16,32,72 --metrics
shift proof Lab.shift --output weights.png --at wght=300 --at wght=700 --masters
shift proof Lab.shift --output alternates.png --text "a/a.ss01 g" --features ss01,-liga
shift proof Arabic.glyphs --output arabic.png --text "مرحبا بالعالم"
shift proof Lab.shift --output glyphs.png --grid
shift proof Lab.shift --output proof.svg --width 1200 --json
```

- `PATH` is a `.shift` document or any source `glyph inspect` reads. `.ttf` and `.otf` files are proofed as they are; every other source is compiled in memory with the same exporter as `compile`, so kerning and features are exactly what export produces.
- `--text` sets one line and may repeat. Without it the proof shows `Hamburgefonstiv`, `HOHOHOnnnooo`, a pangram, and `0123456789 Il1| O0 {}[]()`.
- Inside `--text`, `/name` sets a glyph by name, as in Glyphs and FontGoggles: the name runs to the next `/` or space, and a space that ends a name is consumed (`/a /b` sets two glyphs with no space; write `/space` for one). `//` is a literal slash. Named glyphs are placed directly with their own advance, unshaped, so kerning and contextual features do not reach across them. Unknown names are drawn red and listed in `missingGlyphNames`.
- `--sizes` takes pixels per em (default `72`). Every line is set at every size.
- `--at TAG=VALUE[,TAG=VALUE]` sets every line at an external user-space location; repeat it to compare locations. `--instances` adds every named instance of the compiled font, labelled with its name, and `--masters` adds every master of the source, labelled with the master name (not available for `.ttf`/`.otf`). Rows are grouped by line, then size, then location, so the same text stacks for comparison, and each row is labelled with its size and location. Unknown axes and out-of-range values are rejected. `--location` is a hidden alias of `--at`.
- `--features` takes HarfBuzz feature syntax, comma-separated or repeated: `ss01`, `-liga`, `kern=0`, `aalt=2`. `--script` (ISO 15924, such as `arab`), `--language` (BCP 47, such as `tr`), and `--direction ltr|rtl|ttb|btt` override what is otherwise guessed from the text.
- Horizontal lines follow the Unicode bidirectional algorithm, with `--direction` as the paragraph direction (the first strong character otherwise), and are split into runs of one script before shaping. Right-to-left lines are right-aligned. Vertical text (`ttb`, `btt`) is set in columns, never wrapped and without guides.
- `--metrics` draws ascender (purple), cap-height (teal), x-height (green), baseline (blue), and descender (orange) guides behind the rows at the largest size. The ascender and descender are the authored `OS/2` typo values, not the padded `hhea` line height.
- `--grid` sets the glyphs of `--text` (characters and `/name` tokens; spaces only separate them), or every glyph in glyph order when there is no text, unshaped in cells with each glyph's name underneath, one grid per location. It takes one size (default `48`) and wraps at `--width` (default `1200`).
- `--width` fixes the image width and wraps text at spaces; without it the image grows to fit the longest row.
- `--format png|svg` picks the encoding; by default an `.svg` output is SVG and anything else is PNG.

Text is black on white. Characters the font does not map shape to `.notdef` and are drawn in red (an inkless `.notdef` becomes a hollow red box); they are listed under `missing` in the human output and in `missingCharacters`, overall and per line, in the `--json` report. A text proof of a font that maps no characters is an error and writes nothing.

The `--json` report carries the image size, the shaping options, every location (`label`, user-space `axes`, font-unit `metrics`, and `guides`), and one entry per drawn row with its `line` and `location` indexes, text, size, pen origin `x`, `baseline`, `width` in pixels, `direction`, and `glyphs` in visual order: `name`, `glyphId`, `cluster` (byte offset in the line), `x` and `advance` in font units, and `missing`. A grid reports `grids`, one per location, whose `cells` carry the printed `label`, position, and the same glyph fields.

## Authoring

Authoring commands operate on Shift domain objects rather than persistence rows. The resource surface creates font topology, glyph identity, and sparse authored layers:

```sh
shift font create Lab.shift
shift axis add Lab.shift --tag wght --name Weight --min 100 --default 400 --max 900
shift source add Lab.shift --name Black --location wght=900
shift glyph add Lab.shift A --unicode U+0041
shift layer add Lab.shift --glyph A --source Regular --input A-regular.json
shift layer copy Lab.shift --glyph A --from-source Regular --source Black
```

Shift mints every new entity ID. Human and agent workflows may read returned IDs and use them as selectors, but authoring commands never accept caller-chosen identity.

`font create --from` starts a document from another font's structure: its names, units per em,
vertical metrics, axes, mappings, masters, and named instances, without glyphs, kerning, or feature
code. Glyph batches that name masters then land in the matching sources, which makes small,
correctly scaled test documents from real fonts.

`layer add` reads a semantic layer payload from a JSON file, or from stdin when `--input -` is used. Glyph and source membership stay in the command selectors instead of being duplicated inside the payload:

```json
{
  "advance": 600,
  "contours": [
    {
      "closed": true,
      "points": [
        { "x": 0, "y": 0 },
        { "x": 300, "y": 700, "pointType": "onCurve" },
        { "x": 600, "y": 0 }
      ]
    }
  ],
  "anchors": [{ "name": "top", "x": 300, "y": 700 }]
}
```

Identity is not part of the layer payload. `pointType` defaults to `onCurve`; accepted values are `onCurve`, `offCurve`, and `qCurve`. A layer payload authors contours, anchors, and components. `layer copy` preserves complete authored layer content, including components, while minting fresh internal identities.

### Replacing drawings

`layer set` creates a missing layer or replaces an existing layer's drawing:

```sh
shift layer set Lab.shift --glyph A --source Regular --input A-regular.json
```

An existing layer keeps its stable ID, source binding, height, guidelines, and library data.
Advance, contours, anchors, and components are replaced by the payload's. Replaced points,
contours, anchors, and components receive fresh identities; omitted ones produce an empty drawing.

A payload's `components` name their base glyph and may give a transform, either as an affine
`[xx, xy, yx, yy, dx, dy]` (as UFO and most tools write it) or as Shift's decomposed form
(`translateX`, `translateY`, `rotation`, `scaleX`, `scaleY`, `skewX`, `skewY`, `tCenterX`,
`tCenterY`), which `glyph export` writes:

```json
{ "advance": 600, "components": [{ "base": "A" }, { "base": "acute", "transform": [1, 0, 0, 1, 99, 20] }] }
```

Both `layer add` and `layer set` accept `svgPath` instead of `contours`:

```json
{
  "advance": 600,
  "svgPath": "M0 0 L300 700 L600 0 Z",
  "anchors": [{ "name": "top", "x": 300, "y": 700 }]
}
```

`svgPath` is SVG path **syntax**, not an SVG-file import: path data alone has no viewport
or inherent axis orientation. Here its coordinates are font units with **Y pointing up**.
An ordinary SVG document uses Y-down by default and would need a transform before its drawing
is used in glyph space. Shift does not flip `svgPath` coordinates. Absolute/relative moves, lines, horizontal/vertical lines,
cubic/quadratic curves, shorthand curves, and closed subpaths are supported. Arc commands
(`A`/`a`) are rejected rather than approximated. `contours` and `svgPath` cannot be combined.

### Atomic glyph batches

`glyph set` creates or updates glyph identities and drawings from one JSON document:

```sh
shift glyph set Lab.shift --input glyphs.json
shift glyph set Lab.shift --input - --dry-run --json < glyphs.json
```

```json
{
  "glyphs": [
    {
      "name": "A",
      "unicodes": ["U+0041"],
      "source": "Regular",
      "layer": { "advance": 600, "svgPath": "M0 0 L300 700 L600 0 Z" }
    },
    { "name": "space", "unicodes": ["U+0020"] }
  ]
}
```

- Omitted `unicodes` preserves existing assignments; `[]` clears them.
- A component's base may be a glyph created earlier or later in the same batch.
- `"format": 1` names the batch format; a `shift-cli` that reads another format refuses the file.

### Copying glyphs from other fonts

`glyph export` reads named glyphs from any source Shift opens and writes the batch `glyph set` reads,
including every glyph their components use. Exported files are small and hand-editable, so they
make good scratch fixtures:

```sh
shift glyph export Inter.glyphspackage --glyphs aacute,one.ss01 > latin-bits.json
shift glyph set Lab.shift --input latin-bits.json
shift glyph export Inter.glyphspackage --glyphs aacute | shift glyph set Lab.shift --input -
```

`--source NAME` exports one master and `--source all` every master, each layer named after its
source (the target document needs sources with those names); the default exports the default
source for the target's default source. `--output PATH` writes a file instead of stdout.
- Omitted `layer` authors identity only; it does not create or clear a layer.
- Omitted `source` selects the default source. Explicit selectors accept source names or full IDs.
- A name may repeat for distinct sources. Repeated glyph/source pairs and conflicting
  supplied Unicode lists are rejected, including equivalent source name/ID selectors.
- Layer payloads have the same replacement semantics as `layer set`.
- Unknown fields and caller-supplied identities are rejected.

All entries are planned before one atomic workspace application; the CLI does not replay a
scratch font or load unrelated geometry. Entry errors identify the glyph and one-based entry
number; malformed JSON reports its line and column. An invalid entry leaves every canonical
byte unchanged, including otherwise valid entries earlier in the batch.

### Font metadata and source metrics

```sh
shift font info Lab.shift
shift font info Lab.shift --source Bold --json
shift font set Lab.shift --family-name "Packet Mono" --style-name Book --version 1.125
shift font set Lab.shift --ascender 850 --descender -230 --x-height 480 --cap-height 720
shift font set Lab.shift --source Bold --ascender 900 --line-gap 24 --italic-angle -8
shift font set Lab.shift --copyright "Copyright 2026 Shift Test Lab" \
  --designer "Shift Test Lab" --designer-url https://shift.graphics/team \
  --license "<license text>" --license-url https://openfontlicense.org/
```

`font info` reads authored metadata, font-global units per em, and one source's metrics
without acquiring glyph payloads. JSON includes the complete Shift metadata fields,
a formatted `version`, and a `source` object containing its identity, role, and standard
metric positions. Missing authored metrics are `null`; the report does not substitute
compiler-padded ascenders or line-height estimates.

`font set` preserves omitted fields and applies metadata and metric changes atomically.
Family/style/version, copyright, designer, designer URL, license text, and license URL
are global metadata. Source names and locations are not renamed by metadata edits.
Metric flags target the selected master, or the default source when `--source` is omitted.
`--source` without metric flags is an error; layer-only/background sources cannot receive
font metrics. Existing overshoots and all unmentioned source values are preserved.
A missing standard metric definition is introduced through the model's normal default-value
policy for other masters. Fractional font-unit values are preserved.

Versions accept `MAJOR` or exactly `MAJOR.NNN`, such as `3` or `3.125`. Ambiguous forms such
as `1.5` are rejected; major values must be between 0 and 32767. Metadata values cannot be
blank. Supplied attribution and license text, including newlines, are stored verbatim;
the CLI does not generate a license or verify licensing compliance. UPM and glyph geometry
are never rescaled by `font set`.

### Axis edits

```sh
shift axis set Lab.shift wght --name Mass --tag WGHT
shift axis set Lab.shift wght --min 100 --max 1000
```

Select an axis by its current tag or full stable ID. `axis set` preserves identity,
authored order, role, visibility, labels, mappings, master locations, and instance
coordinates. Omitted fields survive; no dependent value is relocated implicitly.
For an unmapped axis, masters must remain inside the replacement range and the
default master must remain at the replacement default. Labels and named instances
must also remain valid. Mapped axes allow naming edits only when their kind/range
is unchanged; changing mapped bounds/defaults requires explicit mapping authoring.
Discrete axes permit name/tag edits only. Empty edits and duplicate tags fail.

### Named instances

```sh
shift instance add Lab.shift --name Book --location wght=450 \
  --postscript-name PacketMono-Book
shift instance set Lab.shift Book --location wght=475 --name Text
shift instance set Lab.shift Text --clear-postscript-name
shift instance remove Lab.shift Text
shift instance add Lab.shift --standard-weights
```

Instances are product presets, not masters: these commands never create or delete
sources or drawings. Locations are external/user-space `TAG=VALUE` coordinates;
axis mappings are not applied to the stored preset. Repeat `--location` or separate
coordinates with commas. Add fills omitted external axes with their defaults;
set replaces only supplied coordinates and preserves omitted fields, identity,
order, and PostScript name. Clear a PostScript name explicitly with
`--clear-postscript-name`. Select existing products by unique name or full stable
ID; ambiguous names require an ID. JSON reports the complete ordered collection.

`--standard-weights` adds missing in-range external `wght` presets from 100 (Thin)
through 900 (Black), with other external axes at their defaults. It preserves all
existing products, names, IDs, and order, skipping occupied locations. Discrete
axes use only authored values. Reapplying the presets is a no-op with `wrote: false`
and no changes; this convenience option cannot be combined with individual
name/location/PostScript flags. It does not generate outlines or static fonts.

### Kerning

```sh
shift kerning list Family.designspace --glyph A
shift kerning groups Family.ufo --position first
shift kerning get Family.shift A V --location wght=650
shift kerning set Lab.shift @A @V -60 --source Bold
shift kerning set Lab.shift A W -40
shift kerning remove Lab.shift A W
shift kerning set Lab.shift --input kerning.json --dry-run --json
shift kerning group create Lab.shift A A Aacute Agrave --position first
shift kerning group assign Lab.shift A Atilde --position first
shift kerning group unassign Lab.shift Atilde --position first
shift kerning group rename Lab.shift A A_round --position first
shift kerning group delete Lab.shift A_round --position first
```

`list`, `groups`, and `get` read `.shift`, UFO, Designspace, and Glyphs sources (compiled
TTF and OTF files have no authored kerning to read); edits need a `.shift` document.
A pair's `first` side is the left glyph, whose first-position group (UFO `kern1`) kerns its
right edge; `second` is the right glyph, whose second-position group (UFO `kern2`) kerns
its left edge. A side is a glyph name or ID, or `@NAME` for a group at that side's position.
Groups are selected by name with `--position`, or by full stable ID. Edits default to
the default source unless `--source` names a master.

`get` resolves a glyph pair the way export compiles it. At each master it reports the
value, its `origin`, and for an `authored` value the pair and `rule` that supplied it:
`glyph`, `exception` (glyph against group), or `group`. A master that authors other
pairs but not this one is `unkerned` (zero); a master that authors no kerning is
`interpolated` from those that do. `--location` adds
the value at an external location.

`set --input` applies groups, then pairs, as one atomic change:

```json
{
  "groups": [{ "position": "first", "name": "A", "members": ["A", "Aacute"] }],
  "pairs": [
    { "source": "Regular", "first": "@A", "second": "V", "value": -40 },
    { "first": "A", "second": "W", "value": null }
  ]
}
```

A group that does not exist is created; `members`, when given, becomes its whole
membership. Pairs may name groups the batch creates. A pair without `source` edits the
default source, and `null` removes the value there.

Every mutation supports:

- `--dry-run` to execute real domain validation without writing;
- `--json` for a structured result; and
- `--output Variant.shift` to leave the input untouched and write an independent document.

In-place changes retain `DocumentId`. `--output` refuses to overwrite an existing destination and mints a new `DocumentId`. All mutations use a temporary sparse recovery overlay; canonical bytes change only after the complete semantic change succeeds.

## Install

```sh
cargo install --path crates/shift-cli --bin shift-cli --force
shift-cli inspect --view layers path/to/Family.shift
shift-cli compile path/to/Family.shift --output path/to/Family.ttf
```

After pulling or merging `main`, rerun the same `cargo install` command to update the installed binary.

## Development

```sh
cargo test -p shift-cli
cargo run -p shift-cli -- inspect --help
cargo run -p shift-cli -- compile --help
cargo run -p shift-cli -- proof --help
cargo run -p shift-cli -- axis add --help
cargo run -p shift-cli -- source add --help
cargo run -p shift-cli -- glyph add --help
cargo run -p shift-cli -- glyph inspect --help
cargo run -p shift-cli -- layer add --help
cargo run -p shift-cli -- layer copy --help
cargo run -p shift-cli -- layer set --help
cargo run -p shift-cli -- glyph set --help
cargo run -p shift-cli -- font info --help
cargo run -p shift-cli -- font set --help
cargo run -p shift-cli -- axis set --help
cargo run -p shift-cli -- instance add --help
cargo run -p shift-cli -- instance set --help
cargo run -p shift-cli -- instance remove --help
```
