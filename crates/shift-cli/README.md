# shift-cli

Command-line tools for `.shift` source packages.

The crate builds the `shift-cli` binary. `inspect` opens a source package, summarizes the font model, and can emit stable JSON for scripts and CI. `compile` sends the canonical Shift model directly through fontir/fontc to produce a TrueType font.

## Usage

```sh
cargo run -p shift-cli -- inspect path/to/Family.shift
cargo run -p shift-cli -- inspect --view axes path/to/Family.shift
cargo run -p shift-cli -- inspect --view mappings path/to/Family.shift
cargo run -p shift-cli -- inspect --view sources path/to/Family.shift
cargo run -p shift-cli -- inspect --view layers path/to/Family.shift
cargo run -p shift-cli -- inspect --json path/to/Family.shift
cargo run -p shift-cli -- compile path/to/Family.shift --output path/to/Family.ttf
```

Human-readable output is quiet by default and uses plain text when stdout is redirected. Use `--json` when another tool needs the complete report.

Available views:

- `summary`: package metadata, counts, and sources
- `axes`: variable font axes
- `mappings`: independent and cross-axis mappings
- `sources`: design sources and locations
- `glyphs`: glyph names, Unicode values, and layer counts
- `layers`: glyph layer source bindings and geometry counts

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
```
