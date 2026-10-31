//! The live font at the location text is laid out at.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use shift_font::anchor_propagation::PropagatedAnchors;
use shift_font::composite::resolved_contours_bbox;
use shift_font::interpolation::KerningBlend;
use shift_font::interpolation::ResolvedSourceMetrics;
use shift_font::positioning::{
    GeneratedFeature, PositioningFont, RunDirection, RunGlyph, RunPosition, RunPositioning,
};
use shift_font::projection::FontProjection;
use shift_font::{DesignLocation, ExternalLocation, Font, GlyphId, MetricKind, OpenTypeCategory};
use shift_shape::{GlyphPosition, Tag, TextDirection};
use shift_shaper_font::{GeneratedPositioning, LiveAdvances, LiveShaper, PositioningGlyphs};

use crate::GlyphBounds;

/// A font's vertical metrics at the location text is laid out at.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LineMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    /// Below the baseline, so usually negative.
    pub descender: f64,
    pub line_gap: f64,
    /// The cap height, where a mark laid out as typed sits; the ascender
    /// stands in when the font has none.
    pub cap_height: Option<f64>,
}

impl LineMetrics {
    /// The font's metrics at `design`: its sources' ascender, descender,
    /// cap height and line gap, interpolated between them. A font with no
    /// such rows gets an ascender of its units per em and a descender of 0.
    pub fn at(font: &Font, design: &DesignLocation) -> Self {
        let units_per_em = font.metrics().units_per_em;
        let resolved = font
            .source_metric_interpolation()
            .and_then(|interpolation| interpolation.resolve(design, font.axes()).ok());
        let row = |kind: MetricKind| {
            let resolved = resolved.as_ref()?;
            font.metric_definitions()
                .iter()
                .find(|definition| definition.kind() == kind)
                .and_then(|definition| resolved.metric_values().get(&definition.id()))
                .map(|value| value.position)
        };
        Self {
            units_per_em,
            ascender: row(MetricKind::Ascender).unwrap_or(units_per_em),
            descender: row(MetricKind::Descender).unwrap_or(0.0),
            line_gap: resolved
                .as_ref()
                .and_then(ResolvedSourceMetrics::line_gap)
                .unwrap_or(0.0),
            cap_height: row(MetricKind::CapHeight),
        }
    }
}

/// The live font as layout reads it: glyphs, anchors and kerning at one
/// location, the shaper over its feature code, and each glyph's `GDEF`
/// class. Each glyph is resolved once per layout.
pub struct LayoutFont<'a> {
    font: &'a Font,
    external: ExternalLocation,
    projection: RefCell<FontProjection<'a>>,
    kerning: KerningBlend,
    shaper: Result<&'a LiveShaper, String>,
    classes: &'a dyn Fn(GlyphId) -> Option<OpenTypeCategory>,
    metrics: LineMetrics,
    // non-reactive: memoized reads for one layout
    resolved: RefCell<HashMap<GlyphId, Option<Resolved>>>,
}

/// What layout reads of one glyph at the location.
#[derive(Clone, Copy)]
struct Resolved {
    advance: f64,
    bounds: Option<GlyphBounds>,
}

impl<'a> LayoutFont<'a> {
    /// The live font at `design` (`external` in user space), kerned with
    /// `kerning`, shaped with `shaper` or laid out as typed for the reason
    /// it gives, with `classes` giving each glyph's `GDEF` class.
    pub fn new(
        font: &'a Font,
        design: &DesignLocation,
        external: ExternalLocation,
        kerning: KerningBlend,
        shaper: Result<&'a LiveShaper, String>,
        classes: &'a dyn Fn(GlyphId) -> Option<OpenTypeCategory>,
        metrics: LineMetrics,
    ) -> Self {
        Self {
            font,
            external,
            projection: RefCell::new(font.projection(design)),
            kerning,
            shaper,
            classes,
            metrics,
            resolved: RefCell::new(HashMap::new()),
        }
    }

    pub(crate) fn external(&self) -> &ExternalLocation {
        &self.external
    }

    pub(crate) fn shaper(&self) -> Result<&'a LiveShaper, &str> {
        match &self.shaper {
            Ok(shaper) => Ok(*shaper),
            Err(reason) => Err(reason),
        }
    }

    pub(crate) fn metrics(&self) -> LineMetrics {
        self.metrics
    }

    pub(crate) fn class(&self, glyph: GlyphId) -> Option<OpenTypeCategory> {
        (self.classes)(glyph)
    }

    /// The glyph a character maps to, as shaping maps it.
    pub(crate) fn character_glyph(&self, codepoint: u32) -> Option<GlyphId> {
        if let Ok(shaper) = &self.shaper {
            return shaper.character_glyph(codepoint);
        }
        self.font
            .character_map()
            .find(|(mapped, _)| *mapped == codepoint)
            .map(|(_, glyph)| glyph)
    }

    /// The glyph's advance at the location; 0 for one with no shape here.
    pub(crate) fn advance(&self, glyph: GlyphId) -> f64 {
        self.resolve(glyph).map_or(0.0, |resolved| resolved.advance)
    }

    /// The glyph's outline bounds at the location.
    pub(crate) fn bounds(&self, glyph: GlyphId) -> Option<GlyphBounds> {
        self.resolve(glyph)?.bounds
    }

    /// The glyph's anchors as export compiles them, at the location.
    pub(crate) fn anchors(&self, glyph: GlyphId) -> Option<Arc<PropagatedAnchors>> {
        let class = |glyph| self.class(glyph);
        self.projection
            .borrow_mut()
            .compiled_anchors(glyph, &class)
            .ok()
            .flatten()
    }

    fn resolve(&self, glyph: GlyphId) -> Option<Resolved> {
        if let Some(resolved) = self.resolved.borrow().get(&glyph) {
            return *resolved;
        }
        let resolved = self
            .projection
            .borrow_mut()
            .glyph(glyph)
            .ok()
            .flatten()
            .map(|resolved| Resolved {
                advance: resolved.x_advance(),
                bounds: resolved_contours_bbox(resolved.contours()).map(
                    |(x_min, y_min, x_max, y_max)| GlyphBounds {
                        x_min,
                        y_min,
                        x_max,
                        y_max,
                    },
                ),
            });
        self.resolved.borrow_mut().insert(glyph, resolved);
        resolved
    }
}

impl LiveAdvances for LayoutFont<'_> {
    fn advance(&self, glyph: GlyphId) -> Option<i32> {
        Some(font_units(LayoutFont::advance(self, glyph)))
    }
}

/// Positions the generated features with the live font, as shaping reaches
/// each one's place among the font's lookups.
pub(crate) struct GeneratedPositions<'f, 'a>(pub(crate) &'f LayoutFont<'a>);

impl GeneratedPositioning for GeneratedPositions<'_, '_> {
    fn position(
        &mut self,
        feature: Tag,
        glyphs: &PositioningGlyphs<'_>,
        positions: &mut [GlyphPosition],
    ) {
        let Some(feature) = GeneratedFeature::from_tag(&feature.to_string()) else {
            return;
        };
        let run: Vec<RunGlyph> = (0..glyphs.len())
            .map(|index| {
                let glyph_id = glyphs.glyph(index);
                RunGlyph {
                    glyph_id,
                    is_mark: glyph_id
                        .is_some_and(|glyph| self.0.class(glyph) == Some(OpenTypeCategory::Mark)),
                }
            })
            .collect();
        let mut run_positions: Vec<RunPosition> = positions
            .iter()
            .map(|position| RunPosition {
                x_advance: f64::from(position.x_advance),
                y_advance: f64::from(position.y_advance),
                x_offset: f64::from(position.x_offset),
                y_offset: f64::from(position.y_offset),
            })
            .collect();
        let direction = match glyphs.direction() {
            TextDirection::LeftToRight => RunDirection::LeftToRight,
            TextDirection::RightToLeft => RunDirection::RightToLeft,
        };
        let mut reads = FontReads(self.0);
        RunPositioning::new(&run, &mut run_positions, direction, &mut reads).apply(feature);
        for (position, positioned) in positions.iter_mut().zip(&run_positions) {
            position.x_advance = font_units(positioned.x_advance);
            position.y_advance = font_units(positioned.y_advance);
            position.x_offset = font_units(positioned.x_offset);
            position.y_offset = font_units(positioned.y_offset);
        }
    }
}

/// The live font as shift-font's positioning reads it.
struct FontReads<'f, 'a>(&'f LayoutFont<'a>);

impl PositioningFont for FontReads<'_, '_> {
    fn anchors(&mut self, glyph_id: GlyphId) -> Option<Arc<PropagatedAnchors>> {
        self.0.anchors(glyph_id)
    }

    fn kerning(&mut self, pairs: &[(GlyphId, GlyphId)]) -> Vec<f64> {
        self.0
            .kerning
            .values(self.0.font.kerning(), pairs.iter().copied())
    }
}

/// Rounds a value to the whole font units a shaper positions in, as export
/// rounds what it compiles.
pub(crate) fn font_units(value: f64) -> i32 {
    let rounded = value
        .round()
        .clamp(f64::from(i32::MIN), f64::from(i32::MAX));
    #[allow(
        clippy::cast_possible_truncation,
        reason = "rounded and clamped to i32's range just above"
    )]
    let units = rounded as i32;
    units
}
