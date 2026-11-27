//! Live stroke outlines at an interpolated location: interpolate, then expand.
//!
//! Between masters there is no authored layer to read strokes from, so the
//! skeleton and the style are interpolated from the glyph's compatible
//! drawings with the same weights the outline interpolation uses, and the
//! stroke is solved around the interpolated skeleton. A contour takes part
//! when every drawing in the interpolation strokes it; a contour stroked on
//! only some drawings keeps the between-masters answer it has at a drawing
//! that does not stroke it, which is no stroke.

use crate::interpolation::InterpolationSample;
use crate::stroke::layer_lib::LayerStrokeLib;
use crate::stroke::live_stroke::{StrokeContourFailure, StrokeOutlineRead};
use crate::stroke::solve_cache::StrokeOutlineCache;
use crate::stroke::style::OutlineStrokeStyle;
use crate::{CoreResult, DesignLocation, Font, GlyphId, GlyphLayer};

impl Font {
    /// The live stroke outlines of `glyph_id` at an interpolated authoring
    /// `location`, solved around the skeleton interpolated there.
    ///
    /// Styles blend with the outline's own weights: `width`, `miter_limit`
    /// and `position` are weighted sums; `cap` and `join`, which cannot
    /// blend, come from the drawing weighing most (the first such drawing on
    /// a tie). Solved outlines are named by the reference layer's contour
    /// ids, the identities the interpolated outline itself carries. A glyph
    /// that does not interpolate, or has no contour stroked across its
    /// drawings, reads as an empty answer.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::GlyphNotFound`] when the font has no such glyph,
    /// and the interpolation or solver errors of the reads it composes.
    pub fn stroke_outlines_at_location(
        &self,
        glyph_id: GlyphId,
        location: &DesignLocation,
        tolerance: f64,
        cache: &mut StrokeOutlineCache,
    ) -> CoreResult<StrokeOutlineRead> {
        let glyph = self.require_glyph(glyph_id)?;
        let Some(interpolation) = self.glyph_interpolation(glyph_id)? else {
            return Ok(StrokeOutlineRead::default());
        };

        let axes = self.glyph_space_axes(glyph);
        let weights = interpolation.basis().weights_at(location, &axes)?;
        let sample_layers: Vec<Option<&GlyphLayer>> = interpolation
            .basis()
            .samples()
            .iter()
            .map(|sample| match sample {
                InterpolationSample::Source(source_id) => glyph.layer_for_source(*source_id),
                InterpolationSample::Layer(layer_id) => self.layer(*layer_id),
            })
            .collect();

        let reference = interpolation.reference_layer();
        let mut layer = interpolation.resolve(location, &axes)?;
        layer.set_stroke_lib(&LayerStrokeLib {
            contours: std::collections::BTreeMap::new(),
        });

        let mut failed = Vec::new();
        for (index, contour) in reference.contours_iter().enumerate() {
            let Some(style) = blended_style(&sample_layers, &weights, index) else {
                continue;
            };
            let contour_id = contour.id();
            if let Err(error) = style.require_valid() {
                failed.push(StrokeContourFailure {
                    skeleton_contour_id: contour_id,
                    error,
                });
                continue;
            }
            layer.set_live_stroke_contours(std::slice::from_ref(&contour_id), style)?;
        }

        let mut read = layer.stroke_outline_points_for_preview_with(tolerance, cache)?;
        read.failed.extend(failed);
        Ok(read)
    }
}

/// The style of the contour at `index` blended over the sample layers, or
/// `None` when any sample does not stroke that contour: the contour then has
/// no interpolated stroke. Samples match the reference by contour order,
/// the correspondence the interpolation itself is built on.
///
/// # Contour-index contract
///
/// This function pairs masters by contour **order** (index), not by id.
/// That is correct today because variable font compatibility already requires
/// masters to be structurally parallel (same contour count and order).
///
/// When per-point nib shapes are introduced they will attach more data to
/// individual contours.  Before that work begins, decide whether this
/// index-based contract is still sufficient or whether id-stable matching
/// across masters is needed.
fn blended_style(
    sample_layers: &[Option<&GlyphLayer>],
    weights: &[f64],
    index: usize,
) -> Option<OutlineStrokeStyle> {
    let mut width = 0.0;
    let mut miter_limit = 0.0;
    let mut position = 0.0;
    let mut dominant: Option<(f64, OutlineStrokeStyle)> = None;

    for (layer, &weight) in sample_layers.iter().zip(weights) {
        let layer = (*layer)?;
        let contour = layer.contours_iter().nth(index)?;
        let style = layer
            .live_strokes()
            .into_iter()
            .find(|stroke| stroke.contour_id == contour.id())?
            .style;

        width += weight * style.width;
        miter_limit += weight * style.miter_limit;
        position += weight * style.position;
        if dominant.is_none_or(|(heaviest, _)| weight > heaviest) {
            dominant = Some((weight, style));
        }
    }

    let dominant = dominant?.1;
    Some(OutlineStrokeStyle {
        width,
        cap: dominant.cap,
        join: dominant.join,
        miter_limit,
        position,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stroke::style::{StrokeCap, StrokeJoin};
    use crate::{Axis, Contour, Glyph, LayerId, PointType, Source, SourceId};

    /// A weight axis (100–900, default 400) with Regular at 400 and Heavy at
    /// 900, and one glyph whose closed square sits at `regular_x` on Regular
    /// and `heavy_x` on Heavy, stroked on both at the given widths.
    fn two_master_font(regular_width: f64, heavy_width: f64) -> (Font, GlyphId, crate::AxisId) {
        let mut font = Font::new();
        let weight = Axis::weight();
        let weight_id = weight.id();
        font.add_axis(weight).expect("weight axis");

        let regular_id = font.default_source_id().expect("default source");
        font.source_mut(regular_id)
            .expect("default source")
            .set_location(DesignLocation::from([(weight_id, 400.0)]));
        let heavy_id = font.add_source(Source::new(
            "Heavy".to_string(),
            DesignLocation::from([(weight_id, 900.0)]),
        ));

        let mut glyph = Glyph::new("test".to_string());
        glyph.set_layer(stroked_square(regular_id, 100.0, regular_width));
        glyph.set_layer(stroked_square(heavy_id, 200.0, heavy_width));
        let glyph_id = font.insert_glyph(glyph).expect("glyph");
        (font, glyph_id, weight_id)
    }

    fn stroked_square(source_id: SourceId, x: f64, stroke_width: f64) -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
        let mut contour = Contour::new();
        contour.add_point(x, 0.0, PointType::OnCurve, false);
        contour.add_point(x + 200.0, 0.0, PointType::OnCurve, false);
        contour.add_point(x + 200.0, 400.0, PointType::OnCurve, false);
        contour.add_point(x, 400.0, PointType::OnCurve, false);
        contour.close();
        let contour_id = contour.id();
        layer.add_contour(contour);
        layer
            .set_live_stroke_contours(
                &[contour_id],
                OutlineStrokeStyle {
                    width: stroke_width,
                    cap: StrokeCap::Round,
                    join: StrokeJoin::Round,
                    miter_limit: 4.0,
                    position: 0.0,
                },
            )
            .expect("stroke the square");
        layer
    }

    fn read_at(
        font: &Font,
        glyph_id: GlyphId,
        weight_id: crate::AxisId,
        weight: f64,
    ) -> StrokeOutlineRead {
        font.stroke_outlines_at_location(
            glyph_id,
            &DesignLocation::from([(weight_id, weight)]),
            0.25,
            &mut StrokeOutlineCache::default(),
        )
        .expect("interpolated stroke read")
    }

    #[test]
    fn between_masters_the_stroke_is_solved_around_the_interpolated_skeleton() {
        // Regular: square 100..300 stroked 20 wide. Heavy: square 200..400
        // stroked 60 wide. Halfway: skeleton 150..350, width 40, so the ink
        // spans 130..370.
        let (font, glyph_id, weight_id) = two_master_font(20.0, 60.0);

        let read = read_at(&font, glyph_id, weight_id, 650.0);

        assert!(read.failed.is_empty());
        let [solved] = read.solved.as_slice() else {
            panic!("one contour solves between masters");
        };
        let (min_x, _, max_x, _) = solved.bounds;
        assert!((min_x - 130.0).abs() < 0.01, "ink left edge {min_x}");
        assert!((max_x - 370.0).abs() < 0.01, "ink right edge {max_x}");
    }

    #[test]
    fn at_a_master_the_interpolated_read_matches_that_masters_own_read() {
        let (font, glyph_id, weight_id) = two_master_font(20.0, 60.0);

        let read = read_at(&font, glyph_id, weight_id, 400.0);

        let glyph = font.glyph(glyph_id).expect("glyph");
        let regular = glyph
            .layer_for_source(font.default_source_id().expect("default source"))
            .expect("regular layer");
        let own = regular
            .stroke_outline_points_for_preview(0.25)
            .expect("regular's own read");
        assert_eq!(read.solved.len(), 1);
        assert_eq!(read.solved[0].bounds, own.solved[0].bounds);
        assert_eq!(
            read.solved[0].skeleton_contour_id,
            own.solved[0].skeleton_contour_id
        );
    }

    #[test]
    fn a_contour_stroked_on_only_one_master_has_no_interpolated_stroke() {
        let (mut font, glyph_id, weight_id) = two_master_font(20.0, 60.0);
        let heavy_id = font
            .sources()
            .iter()
            .find(|source| source.name() == "Heavy")
            .expect("heavy source")
            .id();
        let heavy_layer_id = font
            .glyph(glyph_id)
            .expect("glyph")
            .layer_for_source(heavy_id)
            .expect("heavy layer")
            .id();
        let heavy = font.layer_mut(heavy_layer_id).expect("heavy layer");
        let contour_id = heavy.contours_iter().next().expect("one contour").id();
        heavy
            .remove_live_stroke_contours(&[contour_id])
            .expect("unstroke heavy");

        let read = read_at(&font, glyph_id, weight_id, 650.0);

        assert!(read.solved.is_empty());
        assert!(read.failed.is_empty());
    }

    #[test]
    fn a_static_font_reads_no_interpolated_strokes() {
        let mut font = Font::new();
        let source_id = font.default_source_id().expect("default source");
        let mut glyph = Glyph::new("test".to_string());
        glyph.set_layer(stroked_square(source_id, 100.0, 20.0));
        let glyph_id = font.insert_glyph(glyph).expect("glyph");

        let read = font
            .stroke_outlines_at_location(
                glyph_id,
                &DesignLocation::default(),
                0.25,
                &mut StrokeOutlineCache::default(),
            )
            .expect("static read");

        assert!(read.solved.is_empty());
        assert!(read.failed.is_empty());
    }
}
