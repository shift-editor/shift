//! Contours from pasted SVG path data, as shift-font parses them. The export
//! is built into the engine module only: the parser is about 40 KB, too much
//! for the module every window embeds. The interface and its types are
//! declared either way, so the generated class is the same in every build.

use pack::Pack;

use crate::geometry::ContourPoints;

/// Contours from SVG path data, as shift-font parses them.
#[pack::interface]
pub trait SvgPaths {
    /// The contours SVG path data draws, one per subpath, as
    /// `svg_path::contours_from_svg_path` parses them; null when the path
    /// data is malformed. The editor mints the points' ids.
    fn svg_path_contours(&self, path: SvgPathData) -> Option<Vec<ContourPoints>>;
}

/// SVG path data as UTF-16 code units. A string travels as code units,
/// not through the name table, because this module's names are its own.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct SvgPathData {
    pub code_units: Vec<f64>,
}

#[cfg(feature = "engine")]
mod exports {
    use shift_font::svg_path::contours_from_svg_path;
    use shift_font::{Contour, Point};
    use wasm_bindgen::prelude::wasm_bindgen;

    use super::{SvgPathData, SvgPaths, svg_paths_request};
    use crate::geometry::ContourPoints;
    use crate::names::with_names;
    use crate::numbers::whole;

    /// The parser [`SvgPaths`] calls.
    pub struct SvgPathParser;

    impl SvgPaths for SvgPathParser {
        fn svg_path_contours(&self, path: SvgPathData) -> Option<Vec<ContourPoints>> {
            contours_from_svg_path(&path.text())
                .ok()
                .map(|contours| contours.iter().map(ContourPoints::of).collect())
        }
    }

    /// Runs one [`SvgPaths`] method for the editor's generated `SvgPaths`
    /// class.
    #[wasm_bindgen(js_name = svgPathsRequest)]
    pub fn request(method: u32, input: &[f64]) -> Vec<f64> {
        with_names(|names| svg_paths_request(&SvgPathParser, method, input, names))
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
