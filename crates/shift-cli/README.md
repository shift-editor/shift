# shift-cli

Read-only command-line tools for `.shift` source packages.

The crate builds the `shift` binary. Its first command is `inspect`, which opens a source package, summarizes the font model, and can emit stable JSON for scripts and CI.

## Usage

```sh
cargo run -p shift-cli -- inspect path/to/Family.shift
cargo run -p shift-cli -- inspect --view axes path/to/Family.shift
cargo run -p shift-cli -- inspect --view sources path/to/Family.shift
cargo run -p shift-cli -- inspect --json path/to/Family.shift
```

Human-readable output is quiet by default and uses plain text when stdout is redirected. Use `--json` when another tool needs the complete report.

Available views:

- `summary`: package metadata, counts, and sources
- `axes`: variable font axes
- `sources`: design sources and locations
- `glyphs`: glyph names, Unicode values, and layer counts

## Development

```sh
cargo test -p shift-cli
cargo run -p shift-cli -- inspect --help
```
