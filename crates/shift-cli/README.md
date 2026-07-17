# shift-cli

Command-line inspection, authoring, and compilation for `.shift` source packages.

The crate builds the `shift-cli` binary. `inspect` opens a source package, summarizes the font model, and can emit stable JSON for scripts and CI. Resource commands apply semantic Shift intents and save only after the complete change validates. `compile` sends the canonical Shift model directly through fontir/fontc to produce a TrueType font.

## Usage

```sh
cargo run -p shift-cli -- inspect path/to/Family.shift
cargo run -p shift-cli -- inspect --view axes path/to/Family.shift
cargo run -p shift-cli -- inspect --view mappings path/to/Family.shift
cargo run -p shift-cli -- inspect --view sources path/to/Family.shift
cargo run -p shift-cli -- inspect --view layers path/to/Family.shift
cargo run -p shift-cli -- inspect --json path/to/Family.shift
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

Available views:

- `summary`: package metadata, counts, and sources
- `axes`: variable font axes
- `mappings`: independent and cross-axis mappings
- `sources`: design sources and locations
- `glyphs`: glyph names, Unicode values, and layer counts
- `layers`: glyph layer source bindings and geometry counts

## Authoring

Authoring commands operate on Shift domain objects rather than package JSON. The resource surface creates font topology, glyph identity, and sparse authored layers:

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

Every mutation supports:

- `--dry-run` to execute real domain validation without writing;
- `--json` for a structured result; and
- `--output Variant.shift` to leave the input untouched and write an independent package.

In-place changes retain package identity. `--output` refuses to overwrite an existing destination and mints a new package identity. All mutations apply to a cloned font and write atomically only after the complete semantic change succeeds.

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
cargo run -p shift-cli -- layer add --help
cargo run -p shift-cli -- layer copy --help
```
