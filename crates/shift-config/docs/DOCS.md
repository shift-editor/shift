# shift-config

<!-- reviewed: 2026-10-13 review-every: 90d -->

Reads, validates, and edits the files in a Shift build's config folder: `config.toml` and `themes/*.toml`.

## Architecture Invariants

- **The user's file is never rewritten.** `set_theme` changes only `theme` through `toml_edit` and keeps every comment, key, blank line, and trailing comment around it. Slots written into an existing `theme` table replace only their own values.
- **A broken file is never edited.** `set_theme` returns `ConfigEditError::InvalidFile` for any source `read_config` reports an error in, so an edit cannot overwrite a file the user is still fixing.
- **Errors block, warnings inform.** An error makes a read return no values (`ConfigRead::values`, `ThemeRead::theme` are `None`); the caller keeps its last valid settings. Unknown keys are warnings, so files written for newer builds still apply.
- **Locations are one-based, in characters**, so Settings and editors agree on where a problem is.
- **One implementation.** The desktop main process reaches this crate through `shift-bridge` (`configRead`, `configSetTheme`, `configSetThemeSlots`, `themeRead`); `shift-cli` links it directly.
- **No I/O.** Callers read and write files; this crate only transforms text, which keeps atomic writes and watching with the caller.

## Codemap

```text
src/
  lib.rs     config.toml: ConfigRead, ConfigProblem, ThemeSetting, read_config, set_theme
  theme.rs   themes/<id>.toml: Theme, read_theme
```

## Key Types

- **`ConfigRead`** — a `config.toml` source's values, or `None` with an error, plus every problem.
- **`ConfigProblem`** — severity, message, and optional `Location`.
- **`ThemeSetting`** — `theme = "nord"` (`Name`) or a table of `ThemeSlots`: an optional `ThemeMode` (`system | light | dark`) and optional `light` and `dark` theme ids.
- **`Theme`** — a theme file: optional name, `Appearance`, and sixteen lowercase `#rrggbb` base16 colors.

## How it works

`read_config` and `read_theme` parse with `toml_edit::Document`, which keeps source spans, so every problem can name its line and column. A read with any error returns no values; the caller keeps what it last read validly. `set_theme` re-reads the source first and refuses a file with errors, then edits a `DocumentMut`: an existing value keeps its decoration (spacing and trailing comment), and a new key goes among the top-level settings, after a comment-only file's comments. Slots go into an existing inline or `[theme]` table key by key; otherwise they replace the value with an inline table. A name replaces an inline table, and a `[theme]` section becomes a top-level key.

## Theme files

```toml
name = "My Rice"        # optional; Settings shows the file name otherwise
appearance = "dark"     # or "light"

[palette]
base00 = "#1a1b26"      # through base0F; "#" optional, either hex-digit case in keys
```

The appearance and all sixteen colors are required.

## Gotchas

- `toml_edit::Document` spans are lost once a document is converted for editing; compute locations from a parsed `Document`, never from an edited `DocumentMut`.

## Verification

- `cargo test -p shift-config`
- `cargo clippy -p shift-config --all-targets -- -D warnings`

## Related

- [`shift-bridge`](../../shift-bridge/docs/DOCS.md) — exposes these functions to the desktop main process
- [Desktop main process](../../../apps/desktop/src/main/docs/DOCS.md) — `AppConfig` owns the files, watching, and atomic writes
- [Color themes](../../../apps/desktop/src/renderer/src/lib/themes/docs/DOCS.md) — how a theme file becomes interface and canvas colors
