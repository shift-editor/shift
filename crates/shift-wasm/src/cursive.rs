//! Cursive attachment: shift-font's `attach_cursive`, the rule export's
//! `curs` lookups follow, for the editor's live text.

use shift_font::cursive::{CursiveDirection, CursiveGlyph, CursivePosition, attach_cursive};
use shift_font::kurbo::Point;
use wasm_bindgen::prelude::*;

use crate::layout::{call, enum_layout, foreign_layout, layout};

enum_layout! {
    /// Which way a run of text reads.
    CursiveDirection {
        LeftToRight => "ltr",
        RightToLeft => "rtl",
    }
}

foreign_layout! {
    /// A glyph's advance and offset, before or after cursive attachment.
    CursivePosition => CursivePosition {
        x_advance: f64,
        x_offset: f64,
        y_offset: f64,
    }
}

layout! {
    /// An anchor's position in its glyph's own coordinates.
    pub struct CursiveAnchor {
        pub x: f64,
        pub y: f64,
    }
}

layout! {
    /// One glyph of a run, in reading order, as cursive attachment reads it.
    pub struct CursiveGlyphInput {
        /// The glyph's `entry` anchor; null without one.
        pub entry: Option<CursiveAnchor>,
        /// The glyph's `exit` anchor; null without one.
        pub exit: Option<CursiveAnchor>,
        /// A mark is passed over: it neither joins nor breaks a chain.
        pub is_mark: bool,
        /// The glyph's position before attachment.
        pub position: CursivePosition,
    }
}

layout! {
    /// A run's glyphs in reading order, and the way the run reads.
    pub struct CursiveRun {
        pub direction: CursiveDirection,
        pub glyphs: Vec<CursiveGlyphInput>,
    }
}

/// Joins a run's glyphs at their `exit` and `entry` anchors, as the `curs`
/// lookups export generates join them.
///
/// Input: [`CursiveRun`]. Output: each glyph's [`CursivePosition`] after,
/// in reading order.
#[wasm_bindgen(js_name = attachCursive)]
pub fn attach_cursive_in(input: &[f64]) -> Vec<f64> {
    call(input, |run: CursiveRun| {
        let glyphs: Vec<CursiveGlyph> = run
            .glyphs
            .iter()
            .map(|glyph| CursiveGlyph {
                entry: glyph.entry.as_ref().map(CursiveAnchor::point),
                exit: glyph.exit.as_ref().map(CursiveAnchor::point),
                is_mark: glyph.is_mark,
                position: glyph.position,
            })
            .collect();
        attach_cursive(&glyphs, run.direction)
    })
}

impl CursiveAnchor {
    fn point(&self) -> Point {
        Point::new(self.x, self.y)
    }
}
