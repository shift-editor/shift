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
  --id weight --tag wght --name Weight --min 100 --default 400 --max 900
cargo run -p shift-cli -- source add path/to/Lab.shift \
  --id black --name Black --location wght=900
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

Authoring commands operate on Shift domain objects rather than package JSON. The initial resource surface creates fonts, continuous axes, and master sources:

```sh
shift font create Lab.shift
shift axis add Lab.shift --tag wght --name Weight --min 100 --default 400 --max 900
shift source add Lab.shift --name Black --location wght=900
```

Entity IDs are minted automatically. Pass `--id` when a script or agent needs deterministic identity; the typed prefix is optional.

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
```
