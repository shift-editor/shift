# Themes

Shift's colors come from plain files in a per-build config folder. Shift watches the folder and applies every save to every open window, canvas included, so an agent can design a theme by editing a file and looking at the result. No API call or restart is involved.

## Where the files are

| Build         | macOS and Linux            | Windows                           |
| ------------- | -------------------------- | --------------------------------- |
| Shift         | `~/.config/shift/`         | `%APPDATA%\Shift\config\`         |
| Shift Nightly | `~/.config/shift-nightly/` | `%APPDATA%\Shift Nightly\config\` |
| Shift Dev     | `~/.config/shift-dev/`     | `%APPDATA%\Shift Dev\config\`     |

`$XDG_CONFIG_HOME` replaces `~/.config` when set. Settings → Appearance shows the exact folder and has an **Open folder** button. Ask the user which build they run rather than writing to every folder.

```
config.toml        which themes Shift uses
themes/<id>.toml   the user's themes, one per file; the file name is its id
```

## config.toml

```toml
theme = "nord"   # one theme, in its own appearance
```

or a light and a dark theme, and which to use:

```toml
theme = { mode = "system", light = "catppuccin-latte", dark = "my-rice" }
```

- `mode` is `system` (follow the OS), `light`, or `dark`; missing means `system`. A missing `light` or `dark` uses Shift Light or Shift Dark. `theme = "system"` follows the OS with Shift's own themes.
- A `[theme]` section with the same keys works too.
- Change only the `theme` setting and keep the user's comments and form: if the file uses a table, edit the table's keys.

Theme ids Shift ships:

- Built in: `shift-light`, `shift-dark`, `solarized-light`, `solarized-dark`, `dracula`, `nord`, `gruvbox-light`, `gruvbox-dark`, `one-dark`.
- Bundled light: `catppuccin-latte`, `rose-pine-dawn`, `tokyo-night-light`, `ayu-light`, `flexoki-light`, `github`, `selenized-light`, `tomorrow`, `papercolor-light`, `penumbra-light`, `oxocarbon-light`, `precious-light-white`, `measured-light`, `cupertino`, `da-one-paper`, `horizon-light`.
- Bundled dark: `catppuccin-macchiato`, `catppuccin-mocha`, `rose-pine-moon`, `rose-pine`, `tokyo-night-storm`, `tokyo-night-dark`, `ayu-mirage`, `ayu-dark`, `flexoki-dark`, `github-dark`, `selenized-dark`, `tomorrow-night`, `papercolor-dark`, `penumbra-dark`, `oxocarbon-dark`, `kanagawa`, `everforest`, `vesper`.

Any other id is a file in `themes/`.

## Theme files

```toml
name = "My Rice"            # optional; shown in Settings
appearance = "dark"         # or "light"; required

[palette]                   # all sixteen base16 colors, required
base00 = "#1a1b26"          # background
# … base01 through base0F

[colors]                    # optional overrides of derived colors
accent = "#ff9e64"
editor-selection-fill = "#ff9e6420"   # #rrggbbaa sets transparency
```

- **Start from a bundled theme.** Shift's bundled themes are files in this same format, inside the app: `Shift.app/Contents/Resources/themes/` on macOS, `resources/themes/` beside the executable on Windows and Linux, and `apps/desktop/themes/` in the Shift repository. Copy one into `themes/` under a new file name and edit it.
- Palettes from base16 scheme files work unchanged; the `#` is optional.
- Shift derives every interface and canvas color from the palette. `base00` is the background, `base05` the text, `base0D` the accent and the selected handles, `base08` errors and snapping, `base0E` anchors.
- `[colors]` overrides one derived color by name: its CSS variable without `--color-` or `--`. The names:
  - Interface: `background`, `surface`, `surface-muted`, `chrome`, `hover`, `surface-hover`, `surface-inverse`, `on-surface-inverse`, `input`, `icon-button`, `icon-button-hover`, `line`, `line-subtle`, `shadow-ambient`, `shadow-key`, `primary`, `secondary`, `muted`, `sidebar-icon`, `accent`, `on-accent`, `error`, `error-ring`, `destructive`, `destructive-hover`, `icon-subtle`, `control-muted`, `canvas-purple`, `canvas-orange`, `canvas-green`, `canvas-indigo`, `canvas-blue`, `canvas-cyan`.
  - Glyph and selection: `editor-glyph-fill`, `editor-glyph-editable-fill`, `editor-glyph-stroke`, `editor-component-fill`, `editor-selection-fill`, `editor-selection-stroke`, `editor-preview-color`, `editor-edit-ghost-color`, `editor-interpolated`, `editor-variation-outline-color`, `editor-read-only-lock-color`.
  - Points and handles: `editor-handle-fill`, `editor-handle-primary-stroke`, `editor-handle-control-stroke`, `editor-handle-anchor-stroke`, `editor-handle-interpolated-stroke`, `editor-handle-overlay-subtle`, `editor-handle-overlay-first`, `editor-handle-overlay-last`, `editor-handle-overlay-anchor`, `editor-control-line-color`, `editor-pen-ready-fill`, `editor-pen-ready-stroke`.
  - Guides and hover: `editor-guides-color`, `editor-metric-marker-fill`, `editor-snap-color`, `editor-cursor-color`, `editor-segment-hover-color`, `editor-segment-selected-color`, `editor-component-hover-outline`, `editor-advance-tee-color`.
  - Spacing and kerning: `editor-spacing`, `editor-spacing-faint`, `editor-spacing-negative`, `editor-spacing-negative-faint`, `editor-kerning`, `editor-kerning-positive`.
  - Text runs: `editor-text-cursor-color`, `editor-text-selection-fill`, `editor-text-hover-outline`, `editor-text-composite-arm-fill`, `editor-text-component-overlay-a`, `editor-text-component-overlay-b`, `editor-text-component-overlay-hover-a`, `editor-text-component-overlay-hover-b`.
  - Debug overlays: `editor-debug-tight-bounds`, `editor-debug-hit-radii`, `editor-debug-segment-bounds`, `editor-debug-glyph-bbox`.
- Keep glyphs and text at least 4.5:1 against `base00`, and points, handles, anchors, and snapping at least 3:1; Shift's bundled themes meet these.
- Do not name a file after a theme Shift ships or `system`: Shift ignores it and reports a warning.

## Iterating on a theme

1. Write or edit `themes/<id>.toml`, and choose it in `config.toml` if it is not in use.
2. Shift applies the save within a moment. If MCP is available, look at the result with `shift.capture` (see [mcp.md](mcp.md)). Judge contrast between handles, selection, glyph, and background from the image, not from hex values.
3. Repeat. Each capture is a point-in-time image; capture again after every change.

## When a file is wrong

Shift never applies a broken file. It keeps the last valid colors and lists the problem with its file, line, and column in Settings → Appearance:

- An error (a TOML syntax error, a missing palette color, a value that is not `#rrggbb` or `#rrggbbaa`, a missing `appearance`, or a `mode` other than `system`, `light`, or `dark`) keeps the last valid theme.
- A warning (an unknown key, a theme id Shift does not have, or a `[colors]` name Shift has no color for) applies the rest of the file.

If a change does not show up, ask the user what Settings → Appearance reports before editing further.
