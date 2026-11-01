//! The font at the location text is laid out at: the live font, or what a
//! window without one knows of each glyph.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
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
use crate::request::{LineMetrics, TypedFont, TypedGlyph};

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

/// The font as layout reads it: glyph advances, bounds, anchors and kerning
/// at one location, the shaper, and each glyph's `GDEF` class. Each glyph is
/// resolved once per layout.
///
/// Over the live font ([`Self::new`]) text shapes with the font's feature
/// code; over a [`TypedFont`] ([`Self::typed`]), which has neither outlines
/// nor feature code, it lays out as typed.
pub struct LayoutFont<'a> {
    glyphs: Glyphs<'a>,
    metrics: LineMetrics,
    // non-reactive: memoized reads for one layout
    resolved: RefCell<HashMap<GlyphId, Option<Resolved>>>,
}

/// Where a [`LayoutFont`] reads its glyphs.
enum Glyphs<'a> {
    Live(Box<LiveGlyphs<'a>>),
    Typed(TypedGlyphs),
}

/// The live font at one location.
struct LiveGlyphs<'a> {
    font: &'a Font,
    external: ExternalLocation,
    projection: RefCell<FontProjection<'a>>,
    kerning: KerningBlend,
    shaper: Result<&'a LiveShaper, String>,
    classes: &'a dyn Fn(GlyphId) -> Option<OpenTypeCategory>,
}

/// A [`TypedFont`], indexed by character and glyph.
struct TypedGlyphs {
    characters: HashMap<u32, GlyphId>,
    glyphs: HashMap<GlyphId, TypedGlyph>,
}

/// Why text over a [`TypedFont`] lays out as typed.
const NO_FEATURE_CODE: &str = "the font has no feature code to shape with here";

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
            glyphs: Glyphs::Live(Box::new(LiveGlyphs {
                font,
                external,
                projection: RefCell::new(font.projection(design)),
                kerning,
                shaper,
                classes,
            })),
            metrics,
            resolved: RefCell::new(HashMap::new()),
        }
    }

    /// A font known only by what `font` says of each glyph, such as a
    /// preview's, whose live font is in another process: text over it lays
    /// out as typed, unkerned, saying why it was not shaped. A character
    /// `font` maps to no glyph shows none, and a glyph it does not list has
    /// no advance.
    pub fn typed(font: &TypedFont) -> Self {
        Self {
            glyphs: Glyphs::Typed(TypedGlyphs {
                characters: font
                    .characters
                    .iter()
                    .map(|mapped| (mapped.codepoint, mapped.glyph_id))
                    .collect(),
                glyphs: font
                    .glyphs
                    .iter()
                    .map(|glyph| (glyph.glyph_id, *glyph))
                    .collect(),
            }),
            metrics: font.metrics,
            resolved: RefCell::new(HashMap::new()),
        }
    }

    /// The shaper and the user-space location it shapes at, or why text
    /// lays out as typed.
    pub(crate) fn shaper(&self) -> Result<(&'a LiveShaper, &ExternalLocation), &str> {
        match &self.glyphs {
            Glyphs::Live(live) => match &live.shaper {
                Ok(shaper) => Ok((*shaper, &live.external)),
                Err(reason) => Err(reason),
            },
            Glyphs::Typed(_) => Err(NO_FEATURE_CODE),
        }
    }

    pub(crate) fn metrics(&self) -> LineMetrics {
        self.metrics
    }

    pub(crate) fn class(&self, glyph: GlyphId) -> Option<OpenTypeCategory> {
        match &self.glyphs {
            Glyphs::Live(live) => (live.classes)(glyph),
            Glyphs::Typed(typed) => typed
                .glyphs
                .get(&glyph)
                .filter(|typed| typed.is_mark)
                .map(|_| OpenTypeCategory::Mark),
        }
    }

    /// The glyph a character maps to, as shaping maps it.
    pub(crate) fn character_glyph(&self, codepoint: u32) -> Option<GlyphId> {
        let live = match &self.glyphs {
            Glyphs::Live(live) => live,
            Glyphs::Typed(typed) => return typed.characters.get(&codepoint).copied(),
        };
        if let Ok(shaper) = &live.shaper {
            return shaper.character_glyph(codepoint);
        }
        live.font
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

    /// The glyph's anchors as export compiles them, at the location; none
    /// over a [`TypedFont`].
    pub(crate) fn anchors(&self, glyph: GlyphId) -> Option<Arc<PropagatedAnchors>> {
        let Glyphs::Live(live) = &self.glyphs else {
            return None;
        };
        let class = |glyph| self.class(glyph);
        live.projection
            .borrow_mut()
            .compiled_anchors(glyph, &class)
            .ok()
            .flatten()
    }

    /// The kerning between each pair at the location; none over a
    /// [`TypedFont`].
    fn kerning(&self, pairs: &[(GlyphId, GlyphId)]) -> Vec<f64> {
        match &self.glyphs {
            Glyphs::Live(live) => live
                .kerning
                .values(live.font.kerning(), pairs.iter().copied()),
            Glyphs::Typed(_) => vec![0.0; pairs.len()],
        }
    }

    fn resolve(&self, glyph: GlyphId) -> Option<Resolved> {
        if let Some(resolved) = self.resolved.borrow().get(&glyph) {
            return *resolved;
        }
        let resolved = match &self.glyphs {
            Glyphs::Live(live) => live.resolve(glyph),
            Glyphs::Typed(typed) => typed.glyphs.get(&glyph).map(|typed| Resolved {
                advance: typed.advance,
                bounds: None,
            }),
        };
        self.resolved.borrow_mut().insert(glyph, resolved);
        resolved
    }
}

impl LiveGlyphs<'_> {
    fn resolve(&self, glyph: GlyphId) -> Option<Resolved> {
        self.projection
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
            })
    }
}

impl LiveAdvances for LayoutFont<'_> {
    fn advance(&self, glyph: GlyphId) -> Option<i32> {
        Some(font_units(LayoutFont::advance(self, glyph)))
    }
}

/// Positions the generated features with the live font, as shaping reaches
/// each one's place among the font's lookups, and remembers the marks it
/// attached.
pub(crate) struct GeneratedPositions<'f, 'a> {
    font: &'f LayoutFont<'a>,
    /// Each attached mark, by its cluster and glyph.
    attached: HashSet<(u32, GlyphId)>,
}

impl<'f, 'a> GeneratedPositions<'f, 'a> {
    pub(crate) fn new(font: &'f LayoutFont<'a>) -> Self {
        Self {
            font,
            attached: HashSet::new(),
        }
    }

    /// Whether the mark `glyph` at `cluster` attached to a glyph before it.
    pub(crate) fn attached(&self, cluster: u32, glyph: GlyphId) -> bool {
        self.attached.contains(&(cluster, glyph))
    }
}

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
                    is_mark: glyph_id.is_some_and(|glyph| {
                        self.font.class(glyph) == Some(OpenTypeCategory::Mark)
                    }),
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
        let mut reads = FontReads(self.font);
        let attached =
            RunPositioning::new(&run, &mut run_positions, direction, &mut reads).apply(feature);
        for index in attached {
            if let (Some(cluster), Some(glyph)) = (glyphs.cluster(index), glyphs.glyph(index)) {
                self.attached.insert((cluster, glyph));
            }
        }
        for (position, positioned) in positions.iter_mut().zip(&run_positions) {
            position.x_advance = font_units(positioned.x_advance);
            position.y_advance = font_units(positioned.y_advance);
            position.x_offset = font_units(positioned.x_offset);
            position.y_offset = font_units(positioned.y_offset);
        }
    }
}

/// The live font as shift-font's positioning reads it.
pub(crate) struct FontReads<'f, 'a>(pub(crate) &'f LayoutFont<'a>);

impl PositioningFont for FontReads<'_, '_> {
    fn anchors(&mut self, glyph_id: GlyphId) -> Option<Arc<PropagatedAnchors>> {
        self.0.anchors(glyph_id)
    }

    fn kerning(&mut self, pairs: &[(GlyphId, GlyphId)]) -> Vec<f64> {
        self.0.kerning(pairs)
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
