# Omarchy

Keeps a Shift theme named **Omarchy** in step with the active [Omarchy](https://omarchy.org) theme. When you switch themes in Omarchy, Shift recolors with the rest of the desktop.

It uses two extension points Omarchy provides for exactly this:

- **`shift.toml.tpl`** is a user template. On every theme switch, Omarchy renders it from the theme's `colors.toml` into `~/.local/state/omarchy/current/theme/shift.toml`, a [Shift theme file](../../docs/themes.md).
- **`theme-set`** is a hook Omarchy runs after each switch. It copies that file to `themes/omarchy.toml` in the config folder of each Shift build you have (`~/.config/shift`, `shift-nightly`, `shift-dev`). Shift watches the folder and applies the change.

## Install

```sh
mkdir -p ~/.config/omarchy/themed ~/.config/omarchy/hooks/theme-set.d
cp shift.toml.tpl ~/.config/omarchy/themed/
cp theme-set ~/.config/omarchy/hooks/theme-set.d/shift
```

Switch Omarchy's theme once so the files are rendered. Then set `theme = "omarchy"` in `~/.config/shift/config.toml`. The theme takes its light or dark appearance from Omarchy's, so this plain form makes Shift follow Omarchy's mode too. You can also pick **Omarchy** under **Your themes** in Settings → Appearance.

## Customize

The template maps Omarchy's colors onto Shift's base16 palette: `background` to `base00`, `foreground` to `base05`, `accent` to `base0D` (Shift's accent and selected handles), and so on. To change how a color lands in Shift, edit your copy of the template. To override a single Shift color, add a `[colors]` table to it; see the [theme guide](../../docs/themes.md). Template expressions such as `{{ mix background foreground 6% }}` are Omarchy's.

## Uninstall

```sh
rm ~/.config/omarchy/themed/shift.toml.tpl ~/.config/omarchy/hooks/theme-set.d/shift
```

Then remove `~/.config/shift/themes/omarchy.toml` and pick another theme in Shift.
