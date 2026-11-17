//! Open corners: a drawing convention where a corner has no point. The two
//! edges overshoot the corner and are joined by a short line, so they cross,
//! and the crossing is the corner the reader sees. The small triangle beyond
//! it is an "ear".
//!
//! Glyphs, fontmake and fontc erase outside ears before display and export.
//! The rule is fontc's, `fontir::ir::erase_open_corners`; Shift calls it here
//! and keeps no copy of it.

use std::mem::discriminant;

use kurbo::{BezPath, PathEl};

/// The path with its outside open corners erased, as fontc erases them:
/// `fontir::ir::erase_open_corners`. `None` when the path has none.
///
/// The authored contour stays the source of truth; this is a derived outline
/// for fill and export.
pub fn erase_open_corners(path: &BezPath) -> Option<BezPath> {
    fontir::ir::erase_open_corners(path)
}

/// Erases open corners in one glyph's masters, each the same glyph's contours
/// in contour order, so the masters still interpolate.
///
/// A contour is erased in every master or in none. fontc erases each master
/// on its own, so a corner that is open in one master and not in another
/// gives masters with different point structures, and the font fails to
/// compile. Shift keeps such a contour as authored in every master instead.
pub fn erase_open_corners_in_masters(masters: &mut [Vec<BezPath>]) {
    let contour_count = masters.iter().map(Vec::len).min().unwrap_or(0);
    for index in 0..contour_count {
        let erased: Option<Vec<BezPath>> = masters
            .iter()
            .map(|contours| contours.get(index).and_then(erase_open_corners))
            .collect();
        let Some(erased) = erased else { continue };
        if !same_structure(&erased) {
            continue;
        }
        for (contours, path) in masters.iter_mut().zip(erased) {
            if let Some(contour) = contours.get_mut(index) {
                *contour = path;
            }
        }
    }
}

fn same_structure(paths: &[BezPath]) -> bool {
    let Some((first, rest)) = paths.split_first() else {
        return true;
    };
    rest.iter().all(|path| {
        path.elements().len() == first.elements().len()
            && path
                .elements()
                .iter()
                .zip(first.elements())
                .all(|(a, b): (&PathEl, &PathEl)| discriminant(a) == discriminant(b))
    })
}

#[cfg(test)]
mod tests;
