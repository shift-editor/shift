# Font reference

Neutral conventions for reading and describing fonts. These are shared vocabulary, not style advice: Shift-specific behavior is stated as fact, and design choices are left to the designer.

## Coordinates

- **Font units.** Geometry is measured in units of the em square. `unitsPerEm` (often 1000 or 2048) is the em height.
- **Y points up.** The baseline is `y = 0`; ascenders are positive and descenders negative. Screen and SVG coordinates usually point Y down, so flip when converting.
- **Advance width** is the horizontal distance to the next glyph's origin. Sidebearings are the space between the outline's bounds and the origin (left) or the advance (right).

## Metrics

Vertical metrics are per source in Shift: baseline, x-height, cap height, ascender, descender, and optional line gap, italic angle, and underline values. A glyph's outline may overshoot a metric (round shapes usually extend slightly past flat ones); an overshoot is not an error.

## Outlines

- **Contours** are closed (or, in some sources, open) paths made of **points**. On-curve points lie on the outline; off-curve points are Bézier control points.
- **Cubic** curves have two off-curve points per segment (PostScript/CFF, most design sources). **Quadratic** curves have one (TrueType); `qCurve` marks implied on-curve runs.
- **Direction.** By convention, outer contours run counter-clockwise and counters (holes) clockwise in Y-up coordinates. TrueType output often reverses this; what matters is that a glyph's contours are consistent.
- **Smooth** points keep their adjacent handles collinear so the curve has no corner.
- **Extrema.** Placing on-curve points at horizontal and vertical extremes keeps outlines predictable for rendering and hinting.

## Composition

- **Components** place another glyph inside this one with an affine transformation (`xx xy yx yy dx dy`). A component inherits every change to its base glyph. Components can nest; cycles are invalid and skipped.
- **Anchors** are named points used to position marks: a base glyph's `top` aligns with a mark's `_top`.
- **Decomposing** replaces components with copies of their outlines, breaking the link to the base glyph.

## Glyph identity

- **Names** follow production conventions: `A`, `a`, `zero`, `Aacute`, `uni0416`, `a.sc` (suffixes mark alternates), `f_i` (ligatures).
- **Unicode** assignments map code points to glyphs. A glyph may have several or none (alternates and ligatures usually have none).
- Shift also gives every glyph, layer, contour, point, component, and anchor a stable ID. Use names to talk with people and IDs to address objects in tools.
