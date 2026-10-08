# Variable fonts

## Axes

An **axis** is a design dimension such as weight (`wght`), width (`wdth`), or optical size (`opsz`), with a minimum, default, and maximum. Registered axes use lowercase four-letter tags; custom axes use uppercase tags.

- **External (user) coordinates** are what designers and users choose, such as `wght=700`.
- **Design coordinates** are where sources are drawn. **Axis mappings** translate external to design coordinates; without a mapping they are the same. Shift's MCP and CLI accept external coordinates and map them once.

## Sources, masters, and layers

- A **source** is a location in the design space. **Masters** are sources whose drawings define the interpolation; other sources hold glyph-specific or background layers.
- Each glyph has at most one **layer** per source. Layers can be **sparse**: a glyph may have no layer in some masters and is then interpolated there from the masters it does have.
- The **default source** sits at every axis default; it is the font's reference drawing.

## Compatibility

Interpolation needs every master of a glyph to have the same structure: the same contours in the same order, the same number and type of points in each contour, the same components in the same order, and the same anchors. Starting points and contour direction must also match.

When a font fails to build or interpolates strangely, check compatibility first. `shift-cli glyph inspect <file> <glyph> --view sources` reports which sources are compatible. An incompatible source is used only at its exact location.

## Instances

**Named instances** are product presets at external locations, such as "Book" at `wght=450`. They are not masters: adding one creates no drawing, and deleting one removes no source.

## Reading a location

To see a glyph at an arbitrary location, resolve it rather than reading a master's layer: over MCP use `glyphs.resolve` or `locations.resolve`; in the CLI use `glyph inspect --location`. Report whether a value came from an exact source or from interpolation.
