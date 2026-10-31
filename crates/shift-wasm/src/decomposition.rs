//! Component outlines between masters of a glyph compilers decompose.

use pack::Pack;
use shift_font::Transform;
use shift_font::placed_blend::{self, BlendedPoint, ContourShape, blend_decomposed_glyph};
use wasm_bindgen::prelude::wasm_bindgen;

/// Component outlines between masters, as compilers interpolate a glyph
/// they decompose.
#[pack::interface]
pub trait Decomposition {
    /// Blends every component occurrence of a decomposed glyph as each master
    /// places it: each occurrence's blended points in placed order, contour
    /// after contour, or null when any occurrence's masters don't line up
    /// point for point.
    fn blend_decomposed_glyph(&self, glyph: DecomposedGlyph) -> Option<Vec<Vec<BlendedPoint>>>;
}

/// The blending rule [`Decomposition`] calls.
pub struct DecompositionRules;

impl Decomposition for DecompositionRules {
    fn blend_decomposed_glyph(&self, glyph: DecomposedGlyph) -> Option<Vec<Vec<BlendedPoint>>> {
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
    }
}

/// Runs one [`Decomposition`] method for the editor's generated
/// `Decomposition` class.
#[wasm_bindgen(js_name = decompositionRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        decomposition_request(&DecompositionRules, method, input, blobs, names)
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

/// A point's position.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct Coordinate {
    pub x: f64,
    pub y: f64,
}

/// One contour of a component glyph at one master, before placement.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct SourceContour {
    pub closed: bool,
    pub points: Vec<Coordinate>,
}

/// One master's outline of a component occurrence and where that master places it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PlacedMaster {
    /// The occurrence's placement in the root glyph at this master.
    #[pack(rename = "matrix")]
    pub transform: Transform,
    pub contours: Vec<SourceContour>,
}

/// One component occurrence of a decomposed glyph, at each of the glyph's masters.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PlacedOccurrence {
    pub masters: Vec<PlacedMaster>,
}

/// Every component occurrence of a decomposed glyph, and its masters' weights.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct DecomposedGlyph {
    pub occurrences: Vec<PlacedOccurrence>,
    /// One source weight per master, in order.
    pub weights: Vec<f64>,
}
