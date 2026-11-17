//! Open corners erased in the atlas as export erases them, so the glyph grid
//! and previews show what the compiled font draws.

use shift_font::composite::ResolvedContour;
use shift_font::kurbo::BezPath;
use shift_font::{Contour, Contours, open_corners};

/// Each master's contours with their open corners erased, a contour erased
/// in every master or in none: `open_corners::erase_open_corners_in_masters`,
/// as export erases a glyph's masters. `None` when nothing erases, so the
/// caller keeps its authored contours and their ids.
///
/// The atlas blends the erased masters, as a compiled font's variations do;
/// between masters that differs slightly from erasing the blended outline.
pub(super) fn erased_masters(masters: &[&[ResolvedContour]]) -> Option<Vec<Vec<ResolvedContour>>> {
    let authored: Vec<Vec<BezPath>> = masters
        .iter()
        .map(|contours| contours.iter().map(path).collect())
        .collect();
    let mut erased = authored.clone();
    open_corners::erase_open_corners_in_masters(&mut erased);
    if erased == authored {
        return None;
    }
    let masters = masters
        .iter()
        .zip(authored.iter().zip(erased))
        .map(|(contours, (authored, erased))| {
            contours
                .iter()
                .zip(authored.iter().zip(erased))
                .map(|(contour, (authored, erased))| {
                    if *authored == erased {
                        return contour.clone();
                    }
                    resolved_contour(&erased, contour.closed).unwrap_or_else(|| contour.clone())
                })
                .collect()
        })
        .collect();
    Some(masters)
}

/// `contours` as resolved contours, for [`erased_masters`].
pub(super) fn resolved<'a>(
    contours: impl IntoIterator<Item = &'a Contour>,
) -> Vec<ResolvedContour> {
    contours
        .into_iter()
        .map(|contour| ResolvedContour {
            points: contour.points().to_vec(),
            closed: contour.is_closed(),
        })
        .collect()
}

fn path(contour: &ResolvedContour) -> BezPath {
    let mut drawn = Contour::new();
    for point in &contour.points {
        drawn.add_point(point.x(), point.y(), point.point_type(), point.is_smooth());
    }
    if contour.closed {
        drawn.close();
    }
    BezPath::from(&drawn)
}

fn resolved_contour(path: &BezPath, closed: bool) -> Option<ResolvedContour> {
    let Contours(contours) = Contours::from(path);
    let [contour] = <[Contour; 1]>::try_from(contours).ok()?;
    let mut points = contour.points().to_vec();
    // The path ends with a line back to its start; a closed contour closes there on its own.
    if let (true, Some(first), Some(last)) = (closed, points.first(), points.last())
        && points.len() > 1
        && (first.x(), first.y()) == (last.x(), last.y())
    {
        points.pop();
    }
    Some(ResolvedContour { points, closed })
}
