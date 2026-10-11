# Shift theme rendered by Omarchy from the active theme's colors.toml.
# Installed as ~/.config/omarchy/themed/shift.toml.tpl; see README.md.
name = "Omarchy"
appearance = "{{ mode }}"

[palette]
base00 = "{{ background }}"
# Raised surfaces: toward the text color, so lighter in dark themes and darker in light ones.
base01 = "{{ mix background foreground 6% }}"
base02 = "{{ selection }}"
base03 = "{{ dark_foreground }}"
base04 = "{{ mix foreground dark_foreground 50% }}"
base05 = "{{ foreground }}"
base06 = "{{ light_foreground }}"
base07 = "{{ bright_foreground }}"
base08 = "{{ red }}"
base09 = "{{ orange }}"
base0A = "{{ yellow }}"
base0B = "{{ green }}"
base0C = "{{ cyan }}"
base0D = "{{ accent }}"
base0E = "{{ magenta }}"
base0F = "{{ brown }}"
