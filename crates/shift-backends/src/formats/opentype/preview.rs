//! A compiled glyph drawn at a location, as the font's own scaler draws it.

use shift_font::AxisRange;
use skrifa::instance::{LocationRef, NormalizedCoord, Size};
use skrifa::outline::{DrawError, DrawSettings, OutlinePen};
use skrifa::raw::types::{F2Dot14, GlyphId};
use skrifa::{FontRef, MetadataProvider};

use super::OpenTypeFont;
use crate::font_source::{FontReadError, FontSource, GlyphIndex, VariationAxisKind, malformed};

/// A glyph's outline at one location as an SVG path in font units, y up,
/// and its advance there. A glyph without ink, such as a space, has an
/// empty path.
#[derive(Clone, Debug, PartialEq)]
pub struct DrawnGlyph {
    pub svg_path: String,
    pub x_advance: f64,
}

impl OpenTypeFont {
    /// Draws `glyph` at `design`, one design value per axis in the font's
    /// axis order, with the font's own `glyf` or `CFF`/`CFF2` outlines and
    /// `gvar` deltas, unhinted.
    ///
    /// A design value is the axis's user value through `avar`, so it
    /// normalizes over the axis's user range to the coordinate the font's
    /// variation tables read.
    ///
    /// # Errors
    ///
    /// Returns [`FontReadError::GlyphOutOfRange`] when `glyph` is not in the
    /// font, [`FontReadError::InvalidProjection`] when `design` does not give
    /// one value per continuous axis, and [`FontReadError::MalformedSource`]
    /// when the font has no outline or advance for it, or the outline cannot
    /// be drawn.
    pub fn drawn_glyph(
        &self,
        glyph: GlyphIndex,
        design: &[f64],
    ) -> Result<DrawnGlyph, FontReadError> {
        let directory = self.directory();
        if glyph.to_usize() >= directory.glyphs().len() {
            return Err(FontReadError::GlyphOutOfRange {
                glyph,
                glyph_count: directory.glyph_count(),
            });
        }
        let coords = self.normalized_coords(design)?;
        let location = LocationRef::new(&coords);
        let font = FontRef::new(self.bytes().as_ref())
            .map_err(|error| malformed(&self.path, format!("failed to parse font: {error}")))?;
        let glyph_id = GlyphId::new(glyph.to_u32());

        let mut pen = SvgPathPen::default();
        let advance = draw_outline(&font, glyph_id, location, &mut pen).map_err(|failure| {
            malformed(
                &self.path,
                format!("failed to draw glyph {}: {failure}", glyph.to_u32()),
            )
        })?;

        Ok(DrawnGlyph {
            svg_path: pen.finish(),
            x_advance: f64::from(advance),
        })
    }

    /// `design` normalized on each axis's user range, as the font's
    /// variation tables read a location.
    fn normalized_coords(&self, design: &[f64]) -> Result<Vec<NormalizedCoord>, FontReadError> {
        let axes = self.directory().axes();
        if design.len() != axes.len() {
            return Err(FontReadError::InvalidProjection {
                details: format!(
                    "drawing location has {} values for {} axes",
                    design.len(),
                    axes.len()
                ),
            });
        }
        axes.iter()
            .zip(design)
            .map(|(axis, value)| {
                let VariationAxisKind::Continuous {
                    minimum,
                    default,
                    maximum,
                } = &axis.kind
                else {
                    return Err(FontReadError::InvalidProjection {
                        details: "binary variation axes must be continuous".into(),
                    });
                };
                let range = AxisRange {
                    minimum: *minimum,
                    default: *default,
                    maximum: *maximum,
                };
                Ok(F2Dot14::from_f32(crate::numeric::lossy_f32(
                    range.normalize(*value),
                )))
            })
            .collect()
    }
}

/// Why a glyph could not be drawn.
#[derive(Debug, thiserror::Error)]
enum DrawFailure {
    #[error("the font has no outline for it")]
    NoOutline,
    #[error("the font has no advance for it")]
    NoAdvance,
    #[error(transparent)]
    Scaler(#[from] DrawError),
}

/// Draws `glyph_id` at `location` into `pen` and returns its advance there:
/// the scaler's, from `gvar` phantom points, else the font's `hmtx` and
/// `HVAR`.
fn draw_outline(
    font: &FontRef<'_>,
    glyph_id: GlyphId,
    location: LocationRef<'_>,
    pen: &mut SvgPathPen,
) -> Result<f32, DrawFailure> {
    let outline = font
        .outline_glyphs()
        .get(glyph_id)
        .ok_or(DrawFailure::NoOutline)?;
    let adjusted = outline.draw(DrawSettings::unhinted(Size::unscaled(), location), pen)?;
    adjusted
        .advance_width
        .or_else(|| {
            font.glyph_metrics(Size::unscaled(), location)
                .advance_width(glyph_id)
        })
        .ok_or(DrawFailure::NoAdvance)
}

/// Writes outline commands as one SVG path, in the command spelling
/// `shift_font::resolved_contours_to_svg_path` uses.
#[derive(Default)]
struct SvgPathPen {
    commands: Vec<String>,
}

impl SvgPathPen {
    fn command(&mut self, command: char, values: &[f32]) {
        let mut text = command.to_string();
        for value in values {
            text.push(' ');
            text.push_str(&value.to_string());
        }
        self.commands.push(text);
    }

    fn finish(self) -> String {
        self.commands.join(" ")
    }
}

impl OutlinePen for SvgPathPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.command('M', &[x, y]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.command('L', &[x, y]);
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.command('Q', &[cx, cy, x, y]);
    }

    fn curve_to(&mut self, ax: f32, ay: f32, bx: f32, by: f32, x: f32, y: f32) {
        self.command('C', &[ax, ay, bx, by, x, y]);
    }

    fn close(&mut self) {
        self.commands.push("Z".to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::opentype::test_fonts::host_grotesk;

    fn index(font: &OpenTypeFont, name: &str) -> GlyphIndex {
        font.directory()
            .glyphs()
            .iter()
            .find(|glyph| glyph.name == name)
            .unwrap()
            .index
    }

    #[test]
    fn a_composite_draws_its_components_and_a_space_draws_nothing() {
        let font = host_grotesk();
        let default = [400.0];

        let composite = font.drawn_glyph(index(&font, "Aacute"), &default).unwrap();
        let base = font.drawn_glyph(index(&font, "A"), &default).unwrap();
        let space = font.drawn_glyph(index(&font, "space"), &default).unwrap();

        assert!(composite.svg_path.starts_with('M'));
        assert!(composite.svg_path.len() > base.svg_path.len());
        assert_eq!(composite.x_advance, base.x_advance);
        assert_eq!(space.svg_path, "");
        assert!(space.x_advance > 0.0);
    }

    #[test]
    fn a_heavier_weight_draws_another_outline() {
        let font = host_grotesk();
        let glyph = index(&font, "o");

        let regular = font.drawn_glyph(glyph, &[400.0]).unwrap();
        let bold = font.drawn_glyph(glyph, &[800.0]).unwrap();

        assert_ne!(regular.svg_path, bold.svg_path);
    }

    #[test]
    fn a_location_without_a_value_per_axis_or_a_missing_glyph_is_refused() {
        let font = host_grotesk();
        let glyph = index(&font, "o");
        let past_the_end = GlyphIndex::new(font.directory().glyph_count());

        assert!(matches!(
            font.drawn_glyph(glyph, &[]),
            Err(FontReadError::InvalidProjection { .. })
        ));
        assert!(matches!(
            font.drawn_glyph(past_the_end, &[400.0]),
            Err(FontReadError::GlyphOutOfRange { .. })
        ));
    }
}
