//! Lightweight read-only glyph projections for transport consumers.

use shift_font::composite::resolved_contours_to_svg_path;
use shift_font::{CoreResult, Font, GlyphId, Location};

use crate::GlyphPreview;

/// Resolves ordered preview DTOs at one internal authoring location.
///
/// The native projection owns source selection, interpolation, fallback, and
/// recursive component resolution. This adapter only serializes its flattened
/// contours and advances. Missing glyph IDs are omitted; duplicate existing
/// IDs produce duplicate ordered results.
///
/// # Errors
///
/// Returns the first projection error encountered while resolving the batch.
pub fn glyph_previews(
    font: &Font,
    glyph_ids: &[GlyphId],
    location: &Location,
) -> CoreResult<Vec<GlyphPreview>> {
    let mut projection = font.projection(location);
    let glyphs = projection.glyphs(glyph_ids)?;

    Ok(glyphs
        .into_iter()
        .map(|glyph| GlyphPreview {
            glyph_id: glyph.glyph_id(),
            svg_path: resolved_contours_to_svg_path(glyph.contours()),
            x_advance: glyph.x_advance(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use shift_font::test_support::sample_variable_font;
    use shift_font::{Font, Glyph, GlyphId, GlyphLayer, LayerId, Location};

    use super::glyph_previews;

    #[test]
    fn previews_preserve_existing_request_order_and_blank_glyphs() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let blank_id = GlyphId::from_raw("blank");
        let mut blank = Glyph::with_id(blank_id.clone(), "blank");
        blank.set_layer(GlyphLayer::with_width(LayerId::new(), source_id, 420.0));
        font.insert_glyph(blank).unwrap();

        let previews = glyph_previews(
            &font,
            &[
                GlyphId::from_raw("missing"),
                blank_id.clone(),
                blank_id.clone(),
            ],
            &Location::new(),
        )
        .unwrap();

        assert_eq!(previews.len(), 2);
        assert_eq!(previews[0].glyph_id, blank_id);
        assert_eq!(previews[0].svg_path, "");
        assert_eq!(previews[0].x_advance, 420.0);
    }

    #[test]
    fn previews_serialize_interpolated_geometry_and_advance() {
        let font = sample_variable_font();
        let glyph_id = font.glyph_by_name("A").unwrap().id();
        let axis_id = font.axes()[0].id();
        let mut location = Location::new();
        location.set(axis_id, 600.0);

        let preview = glyph_previews(&font, &[glyph_id], &location)
            .unwrap()
            .remove(0);

        assert_eq!(preview.x_advance, 700.0);
        assert!(preview.svg_path.contains("340 700"));
    }
}
