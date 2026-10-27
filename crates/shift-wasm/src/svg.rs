//! Contours from pasted SVG path data, as shift-font parses them. The export
//! is built into the engine module only: the parser is about 40 KB, too much
//! for the module every window embeds. The layouts below are declared either
//! way, so the generated wrapper is the same in every build.

use crate::layout::layout;

layout! {
    /// SVG path data as UTF-16 code units. A string travels as code units,
    /// not through the name table, because this module's names are its own.
    pub struct SvgPathData {
        pub code_units: Vec<f64>,
    }
}

#[cfg(feature = "engine")]
mod exports {
    use shift_font::svg_path::contours_from_svg_path;
    use shift_font::{Contour, Point};
    use wasm_bindgen::prelude::wasm_bindgen;

    use super::SvgPathData;
    use crate::geometry::ContourPoints;
    use crate::layout::{call, whole};

    /// The contours SVG path data draws: `svg_path::contours_from_svg_path`.
    ///
    /// Input: [`SvgPathData`]. Output: one [`ContourPoints`] per subpath,
    /// or none when the path data is malformed. The editor mints the points'
    /// ids.
    #[wasm_bindgen(js_name = svgPathContours)]
    pub fn svg_path_contours(input: &[f64]) -> Vec<f64> {
        call(input, |path: SvgPathData| {
            contours_from_svg_path(&path.text())
                .ok()
                .map(|contours| contours.iter().map(ContourPoints::of).collect::<Vec<_>>())
        })
    }

    impl SvgPathData {
        /// The path data; a unit that is not a UTF-16 code unit is skipped.
        fn text(&self) -> String {
            let code_units: Vec<u16> = self
                .code_units
                .iter()
                .filter_map(|&unit| u16::try_from(whole(unit)?).ok())
                .collect();
            String::from_utf16_lossy(&code_units)
        }
    }

    impl ContourPoints {
        fn of(contour: &Contour) -> Self {
            Self {
                closed: contour.is_closed(),
                point_types: contour.points().iter().map(Point::point_type).collect(),
                coordinates: contour
                    .points()
                    .iter()
                    .flat_map(|point| [point.x(), point.y()])
                    .collect(),
            }
        }
    }
}
