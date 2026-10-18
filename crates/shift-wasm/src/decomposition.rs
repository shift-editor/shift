//! Component outlines between masters of a glyph compilers decompose.

use shift_font::placed_blend::{self, blend_decomposed_glyph, BlendedPoint, ContourShape};
use shift_font::Transform;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::layout::{call, foreign_layout, layout};

/// Blends every component occurrence of a decomposed glyph as each master
/// places it, as compilers interpolate the glyph.
///
/// Input: [`DecomposedGlyph`]. Output: each occurrence's blended points in
/// placed order, contour after contour, or null when any occurrence's masters
/// don't line up point for point.
#[wasm_bindgen(js_name = blendDecomposedGlyph)]
pub fn blend_decomposed_glyph_in(input: &[f64]) -> Vec<f64> {
    call(input, |glyph: DecomposedGlyph| {
        let occurrences = glyph
            .occurrences
            .iter()
            .map(|occurrence| {
                occurrence
                    .masters
                    .iter()
                    .map(Flattened::new)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let masters = occurrences
            .iter()
            .map(|masters| masters.iter().map(Flattened::master).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        blend_decomposed_glyph(&masters, &glyph.weights)
    })
}

/// One master's contours as the shared rule reads them: shapes, then
/// coordinates concatenated.
struct Flattened {
    transform: Transform,
    shapes: Vec<ContourShape>,
    coordinates: Vec<f64>,
}

impl Flattened {
    fn new(master: &PlacedMaster) -> Self {
        Self {
            transform: master.transform,
            shapes: master
                .contours
                .iter()
                .map(|contour| ContourShape {
                    point_count: contour.points.len(),
                    closed: contour.closed,
                })
                .collect(),
            coordinates: master
                .contours
                .iter()
                .flat_map(|contour| &contour.points)
                .flat_map(|point| [point.x, point.y])
                .collect(),
        }
    }

    fn master(&self) -> placed_blend::PlacedMaster<'_> {
        placed_blend::PlacedMaster {
            transform: self.transform,
            shapes: &self.shapes,
            coordinates: &self.coordinates,
        }
    }
}

layout! {
    /// A point's position.
    pub struct Coordinate {
        pub x: f64,
        pub y: f64,
    }
}

layout! {
    /// One contour of a component glyph at one master, before placement.
    pub struct SourceContour {
        pub closed: bool,
        pub points: Vec<Coordinate>,
    }
}

layout! {
    /// One master's outline of a component occurrence and where that master places it.
    pub struct PlacedMaster {
        /// The occurrence's placement in the root glyph at this master.
        pub transform: Transform => matrix,
        pub contours: Vec<SourceContour>,
    }
}

layout! {
    /// One component occurrence of a decomposed glyph, at each of the glyph's masters.
    pub struct PlacedOccurrence {
        pub masters: Vec<PlacedMaster>,
    }
}

layout! {
    /// Every component occurrence of a decomposed glyph, and its masters' weights.
    pub struct DecomposedGlyph {
        pub occurrences: Vec<PlacedOccurrence>,
        /// One source weight per master, in order.
        pub weights: Vec<f64>,
    }
}

foreign_layout! {
    /// One point of a blended occurrence.
    BlendedPoint => BlendedPoint {
        /// The point's index in the first master's contour, which gives it identity and type.
        source_index: usize,
        x: f64,
        y: f64,
    }
}
