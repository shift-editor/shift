//! Outlines read back from compiled fonts as paths, and how far apart two
//! outlines run, for the tests that compare export with another drawing.

use kurbo::{BezPath, ParamCurve, ParamCurveNearest, PathSeg, Point, Rect, Shape};
use skrifa::outline::OutlinePen;

/// A glyph's outline as a path.
#[derive(Default)]
pub(crate) struct Outline(pub(crate) BezPath);

impl OutlinePen for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to((f64::from(x), f64::from(y)));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to((f64::from(x), f64::from(y)));
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.0.quad_to(
            (f64::from(cx0), f64::from(cy0)),
            (f64::from(x), f64::from(y)),
        );
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.curve_to(
            (f64::from(cx0), f64::from(cy0)),
            (f64::from(cx1), f64::from(cy1)),
            (f64::from(x), f64::from(y)),
        );
    }
    fn close(&mut self) {
        self.0.close_path();
    }
}

/// The farthest any of 16 points along each segment of `from` lies from
/// the outline `to`.
fn farthest_from(from: &BezPath, to: &BezPath) -> f64 {
    let targets: Vec<(PathSeg, Rect)> = to
        .segments()
        .map(|segment| (segment, segment.bounding_box()))
        .collect();
    let nearest = |point: Point| {
        let mut nearest = f64::MAX;
        for (segment, bounds) in &targets {
            // A segment whose bounds are farther than the nearest so far can't be nearer.
            let outside = Point::new(
                point.x.clamp(bounds.x0, bounds.x1),
                point.y.clamp(bounds.y0, bounds.y1),
            );
            if point.distance(outside) >= nearest {
                continue;
            }
            nearest = nearest.min(segment.nearest(point, 1e-3).distance_sq.sqrt());
        }
        nearest
    };
    from.segments()
        .flat_map(|segment| (0..=16).map(move |step| segment.eval(f64::from(step) / 16.0)))
        .map(nearest)
        .fold(0.0, f64::max)
}

/// The farthest any point of either outline lies from the other outline.
pub(crate) fn outline_distance(a: &BezPath, b: &BezPath) -> f64 {
    farthest_from(a, b).max(farthest_from(b, a))
}
