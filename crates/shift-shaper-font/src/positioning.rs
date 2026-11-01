//! Runs the editor's own positioning for the features export generates, at
//! the place among the shaper font's lookups where export would put them.

use std::ops::Range;

use shift_font::GlyphId;
use shift_shape::{
    GlyphInfo, GlyphPosition, ParagraphHook, ShapeEvent, ShapeHook, ShapeTable, Tag, TextDirection,
};

use super::{InsertMarker, ShaperGlyphOrder};

/// Positions glyphs for a feature export generates from kerning and anchors
/// (`curs`, `kern`, `mark`, or `mkmk`), which the shaper font does not hold.
///
/// [`LiveShaper::shape_positioned`](crate::LiveShaper::shape_positioned)
/// calls it once per feature per shaped run, where export would insert the
/// feature's lookups: at the first `GPOS` lookup at or past the feature's
/// `# Automatic Code` marker, or after every authored lookup when there is
/// no marker or no later lookup applies. Features run in insertion order and
/// a feature the request turns off is not run.
pub trait GeneratedPositioning {
    /// Adjusts `positions` for `feature`. `positions` holds the run's
    /// positions so far, one per glyph of `glyphs`, in logical order;
    /// offsets of glyphs the font's lookups attached stay relative to the
    /// glyph they attach to until shaping finishes.
    fn position(
        &mut self,
        feature: Tag,
        glyphs: &PositioningGlyphs<'_>,
        positions: &mut [GlyphPosition],
    );
}

/// The glyphs of a run being positioned, as Shift glyphs, in logical order.
pub struct PositioningGlyphs<'a> {
    infos: &'a [GlyphInfo],
    order: &'a ShaperGlyphOrder,
    run: RunPlace,
}

/// Where the run being shaped sits in its paragraph, and how it reads.
#[derive(Clone, Copy, Debug)]
struct RunPlace {
    start: u32,
    direction: TextDirection,
}

impl PositioningGlyphs<'_> {
    /// Returns how many glyphs the run holds.
    pub fn len(&self) -> usize {
        self.infos.len()
    }

    /// Returns whether the run holds no glyphs.
    pub fn is_empty(&self) -> bool {
        self.infos.is_empty()
    }

    /// Returns the Shift glyph at `index`; `None` past the run's end, or for
    /// a `.notdef` the font does not have.
    pub fn glyph(&self, index: usize) -> Option<GlyphId> {
        self.order.glyph(self.infos.get(index)?.glyph_id)
    }

    /// Returns the cluster of the glyph at `index`, an index into the
    /// paragraph's units; `None` past the run's end.
    pub fn cluster(&self, index: usize) -> Option<u32> {
        Some(self.infos.get(index)?.cluster + self.run.start)
    }

    /// Returns the direction the run reads in.
    pub fn direction(&self) -> TextDirection {
        self.run.direction
    }
}

/// A glyph's own advance at the location text is shaped at, which shaping
/// starts from before the font's positioning.
pub trait LiveAdvances {
    /// Returns `glyph`'s advance in font units; `None` shapes it with none.
    fn advance(&self, glyph: GlyphId) -> Option<i32>;
}

/// A [`ShapeHook`] that runs each generated feature at its insert marker.
pub(crate) struct MarkerHook<'a> {
    /// The features to run, in insertion order.
    markers: Vec<InsertMarker>,
    /// Whether each of `markers` has run in the current run's `GPOS`.
    ran: Vec<bool>,
    order: &'a ShaperGlyphOrder,
    positioning: &'a mut dyn GeneratedPositioning,
    run: RunPlace,
}

impl<'a> MarkerHook<'a> {
    /// Runs `positioning` for each of `markers` whose feature `enabled`
    /// keeps on.
    pub(crate) fn new(
        markers: &[InsertMarker],
        enabled: impl Fn(Tag) -> bool,
        order: &'a ShaperGlyphOrder,
        positioning: &'a mut dyn GeneratedPositioning,
    ) -> Self {
        let markers: Vec<InsertMarker> = markers
            .iter()
            .filter(|marker| enabled(marker.tag))
            .copied()
            .collect();
        Self {
            ran: vec![false; markers.len()],
            markers,
            order,
            positioning,
            run: RunPlace {
                start: 0,
                direction: TextDirection::LeftToRight,
            },
        }
    }

    /// Runs every feature not yet run whose marker is at or before
    /// `lookup`, or every one left when `lookup` is `None`.
    fn run_through(
        &mut self,
        lookup: Option<u16>,
        infos: &[GlyphInfo],
        positions: &mut [GlyphPosition],
    ) {
        let glyphs = PositioningGlyphs {
            infos,
            order: self.order,
            run: self.run,
        };
        for (marker, ran) in self.markers.iter().zip(&mut self.ran) {
            if *ran || !marker.is_due(lookup) {
                continue;
            }
            *ran = true;
            self.positioning.position(marker.tag, &glyphs, positions);
        }
    }
}

impl InsertMarker {
    /// Whether this feature runs before `lookup` starts, or at the end of
    /// `GPOS` when `lookup` is `None`.
    fn is_due(&self, lookup: Option<u16>) -> bool {
        let Some(lookup) = lookup else {
            return true;
        };
        self.lookup_index
            .is_some_and(|marker| marker <= usize::from(lookup))
    }
}

impl ShapeHook for MarkerHook<'_> {
    fn event(&mut self, event: ShapeEvent, infos: &[GlyphInfo], positions: &mut [GlyphPosition]) {
        match event {
            ShapeEvent::StartTable(ShapeTable::Gpos) => self.ran.fill(false),
            ShapeEvent::StartLookup {
                table: ShapeTable::Gpos,
                index,
            } => self.run_through(Some(index), infos, positions),
            ShapeEvent::EndTable(ShapeTable::Gpos) => self.run_through(None, infos, positions),
            _ => {}
        }
    }
}

impl ParagraphHook for MarkerHook<'_> {
    fn start_run(&mut self, units: Range<u32>, direction: TextDirection) {
        self.run = RunPlace {
            start: units.start,
            direction,
        };
    }
}
