# shift-cli

Command-line inspection, authoring, and compilation for canonical SQLite `.shift` documents.

The crate builds the `shift-cli` binary. `inspect` opens a document, summarizes the font model, and can emit stable JSON for scripts and CI. Resource commands apply semantic Shift intents through a temporary recovery overlay and save only after the complete change validates. `compile` sends the canonical Shift model directly through fontir/fontc to produce a TrueType font.

## Install

Shift bundles a release `shift-cli` with every desktop build, so the command always matches the app. In Shift, choose **Shift → Install Command Line Tool…** on macOS, or **Help → Install Command Line Tool…** on Windows and Linux:

- **macOS and Linux packages** link `/usr/local/bin/shift-cli` to the app's copy, asking for an administrator password when that directory is protected.
- **Linux AppImage** copies it to `~/.local/bin/shift-cli` (add that directory to `PATH` if needed); Shift refreshes the copy after updates.
- **Windows** adds the app's `bin` directory to your user `PATH`; open a new terminal afterwards.

Shift Nightly installs the same binary as `shift-cli-nightly`, and development builds as `shift-cli-dev` (macOS and Linux only), so release, Nightly, and development builds never replace each other's command. If your terminal finds a different `shift-cli` earlier on `PATH`, such as a `cargo install` build, Shift names it after installing.

To build it from a checkout instead, run `pnpm build:cli` (or `cargo build --release -p shift-cli`); packaging the desktop app requires that build.

## Usage

```sh
cargo run -p shift-cli -- inspect path/to/Family.shift
cargo run -p shift-cli -- inspect --view axes path/to/Family.shift
cargo run -p shift-cli -- inspect --view mappings path/to/Family.shift
cargo run -p shift-cli -- inspect --view sources path/to/Family.shift
cargo run -p shift-cli -- inspect --view layers path/to/Family.shift
cargo run -p shift-cli -- inspect --json path/to/Family.shift
cargo run -p shift-cli -- glyph inspect path/to/Family.glyphs Aacute
cargo run -p shift-cli -- glyph inspect path/to/Family.designspace Aacute \
  --location wght=700 --view variation --json
cargo run -p shift-cli -- compile path/to/Family.shift --output path/to/Family.ttf

cargo run -p shift-cli -- font create path/to/Lab.shift
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

`glyph inspect` reads one glyph through Shift's semantic font model from `.shift`, UFO,
Designspace, Glyphs, TTF, or OTF input. Locations use external/user-space `TAG=VALUE`
coordinates and are mapped once into design space. Its views are:

- `summary`: identity, location, selection mode, bounds, and geometry counts
- `structure`: resolved root contours, anchors, and ordered component occurrences
- `sources`: layer presence and structural compatibility by source
- `variation`: selected interpolation model, source weights, and support regions
- `resolved`: location-evaluated points with components flattened

`--json` emits the complete `GlyphInspection` regardless of the selected human-readable view.

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

Identity is not part of the layer payload. `pointType` defaults to `onCurve`; accepted values are `onCurve`, `offCurve`, and `qCurve`. A new layer payload currently authors contours and anchors. `layer copy` preserves complete authored layer content, including components, while minting fresh internal identities.

### Replacing drawings

`layer set` creates a missing layer or replaces an existing layer's drawing:

```sh
shift layer set Lab.shift --glyph A --source Regular --input A-regular.json
```

An existing layer keeps its stable ID, source binding, height, guidelines, and library data.
Advance, contours, anchors, and components are replaced. **Existing components are removed**
because the payload only supports outlines and anchors. Replaced points, contours, and anchors
receive fresh identities; omitted outlines and anchors produce an empty drawing.

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
