# Themes

Shift's colors come from plain files you can edit, version in your dotfiles, and share. Shift watches them and applies every save to every open window, editor canvas included, without a restart.

## The config folder

Each Shift build has its own folder:

| Build         | macOS and Linux            | Windows                           |
| ------------- | -------------------------- | --------------------------------- |
| Shift         | `~/.config/shift/`         | `%APPDATA%\Shift\config\`         |
| Shift Nightly | `~/.config/shift-nightly/` | `%APPDATA%\Shift Nightly\config\` |
| Shift Dev     | `~/.config/shift-dev/`     | `%APPDATA%\Shift Dev\config\`     |

`$XDG_CONFIG_HOME` replaces `~/.config` when it is set. **Settings → Appearance** shows the folder and opens it with **Open folder**.

```
config.toml        which themes Shift uses
themes/<id>.toml   your themes, one per file
```

## Choosing themes

Settings → Appearance has a **Mode** (Light, Dark, or System) and a theme for each appearance. It saves them in `config.toml`, keeping your comments and layout. You can also write the file yourself:

```toml
# config.toml
theme = "nord"
```

uses Nord, in its own appearance. To keep a light and a dark theme and switch with your OS:

```toml
theme = { mode = "system", light = "catppuccin-latte", dark = "rose-pine" }
```

`mode` is `system`, `light`, or `dark`, and defaults to `system`; a theme you leave out is Shift Light or Shift Dark. A `[theme]` section with the same keys works too.

Shift ships these themes:

| Built in    | Light                                                                                                                                                                                                                                                                             | Dark                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shift's own | `shift-light`                                                                                                                                                                                                                                                                     | `shift-dark`                                                                                                                                                                                                                                                                                              |
| Classics    | `solarized-light`, `gruvbox-light`                                                                                                                                                                                                                                                | `solarized-dark`, `gruvbox-dark`, `dracula`, `nord`, `one-dark`                                                                                                                                                                                                                                           |
| From base16 | `catppuccin-latte`, `rose-pine-dawn`, `tokyo-night-light`, `ayu-light`, `flexoki-light`, `github`, `selenized-light`, `tomorrow`, `papercolor-light`, `penumbra-light`, `oxocarbon-light`, `precious-light-white`, `measured-light`, `cupertino`, `da-one-paper`, `horizon-light` | `catppuccin-macchiato`, `catppuccin-mocha`, `rose-pine-moon`, `rose-pine`, `tokyo-night-storm`, `tokyo-night-dark`, `ayu-mirage`, `ayu-dark`, `flexoki-dark`, `github-dark`, `selenized-dark`, `tomorrow-night`, `papercolor-dark`, `penumbra-dark`, `oxocarbon-dark`, `kanagawa`, `everforest`, `vesper` |

The base16 themes come from [Tinted Theming](https://github.com/tinted-theming/schemes); their ids are the upstream scheme names. Any other id is the file name of one of your themes.

## Making a theme

A theme file has a base16 palette and an appearance:

```toml
name = "My Rice"        # optional; shown in Settings
appearance = "dark"     # or "light"

[palette]
base00 = "#1a1b26"      # background
base01 = "#16161e"      # raised surfaces
base02 = "#2f3549"      # selection and chrome
base03 = "#444b6a"      # muted text
base04 = "#787c99"      # secondary text
base05 = "#a9b1d6"      # text
base06 = "#cbccd1"      # strong text
base07 = "#d5d6db"      # strongest text
base08 = "#f7768e"      # red: errors, snapping
base09 = "#ff9e64"      # orange
base0A = "#e0af68"      # yellow
base0B = "#9ece6a"      # green
base0C = "#7dcfff"      # cyan
base0D = "#7aa2f7"      # blue: accent, handles, selection
base0E = "#bb9af7"      # purple: anchors
base0F = "#c0caf5"      # magenta
```

Save it as `themes/my-rice.toml` and choose **My Rice** in Settings, or name `my-rice` in `config.toml`. Each later save shows up right away.

The easiest start is one of Shift's own theme files, in this same format: copy one from [`apps/desktop/themes`](../apps/desktop/themes) into your `themes/` folder under a new name. Palettes from other base16 scheme files work as they are; the `#` is optional.

### Overriding single colors

Shift derives about eighty interface and canvas colors from the palette. To change one without touching the palette, add it to `[colors]` by name:

```toml
[colors]
accent = "#ff9e64"
editor-handle-primary-stroke = "#ff9e64"
editor-selection-fill = "#ff9e6420"   # #rrggbbaa sets transparency
```

A name is the color's CSS variable without `--color-` or `--`. The ones you are most likely to want:

| Name                                                                    | What it colors                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| `background`, `surface`, `surface-muted`, `chrome`                      | The canvas, panels, dialogs, and window chrome |
| `primary`, `secondary`, `muted`                                         | Text, from strongest to faintest               |
| `accent`, `on-accent`                                                   | Buttons and highlights, and text on them       |
| `line`, `line-subtle`, `hover`, `input`                                 | Borders, hover tints, and text fields          |
| `editor-glyph-fill`, `editor-glyph-stroke`                              | The glyph you are editing                      |
| `editor-handle-primary-stroke`, `editor-handle-control-stroke`          | On-curve points and control handles            |
| `editor-handle-anchor-stroke`, `editor-control-line-color`              | Anchors and the lines to control points        |
| `editor-selection-fill`, `editor-selection-stroke`                      | The selection marquee                          |
| `editor-snap-color`, `editor-guides-color`, `editor-metric-marker-fill` | Snapping, guides, and metric markers           |
| `editor-spacing`, `editor-kerning`, `editor-kerning-positive`           | Sidebearings and kerning                       |
| `editor-text-cursor-color`, `editor-text-selection-fill`                | Text runs                                      |

The full list is in the theme reference of Shift's agent skill (`shift-cli skill show themes`). A name Shift has no color for is reported and ignored.

Keep glyphs and text at least 4.5:1 against the background, and points, handles, and snapping at least 3:1, as Shift's own themes do.

## When a file has a mistake

Shift never applies a broken file. It keeps the last colors that worked and shows the problem, with its file, line, and column, in Settings → Appearance. Settings will not save over a `config.toml` you are still fixing. Unknown settings, theme ids, and color names are warnings: Shift ignores them and applies the rest.

A theme file named like one of Shift's themes, such as `nord.toml`, is ignored so that `theme = "nord"` always means the same theme; rename it.

## Generating themes with other tools

Anything that writes a file can theme Shift: a template in pywal, wallust, or matugen, a script, or an agent. Write a theme file into `themes/`, choose it once, and regenerate the file whenever your colors change.

- [`contrib/omarchy`](../contrib/omarchy/README.md) keeps a Shift theme in step with the active [Omarchy](https://omarchy.org) theme.
- Agents learn the format from the Shift skill (`shift-cli skill show themes`) and can check their work with the MCP server's capture.

Fonts, corner radius, and spacing are not theme settings.
