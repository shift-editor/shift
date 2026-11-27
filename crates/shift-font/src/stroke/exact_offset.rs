//! Constant-width outline from a skeleton path via kurbo's parallel-curve stroke.
//!
//! This is parallel expansion plus caps and joins (Nehab-style), not a full
//! evolute sweep. It is the F0.3 `ExactOffset` backend before nib sweep exists.
//! [`outline`] is the one entry point: the style's `position` decides whether
//! the stroke is centred on the skeleton or lies on a side of it.

use kurbo::{BezPath, Cap, Join, PathEl, Point, Rect, Shape, Stroke, StrokeOpts, stroke};

/// Default flattening tolerance passed to kurbo `stroke` (font units).
pub const DEFAULT_TOLERANCE: f64 = 0.25;

/// CP0 quality bar (F0.4): maximum on-curve points per expanded outline at
/// [`DEFAULT_TOLERANCE`]. B6 may tighten after LTTR/INK comparison.
pub const MAX_ON_CURVE_POINTS: usize = 64;

/// Width, caps, joins, miter limit, and position for [`outline`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ExactStrokeStyle {
    pub width: f64,
    pub cap: Cap,
    pub join: Join,
    pub miter_limit: f64,
    /// Where the stroke lies, from `-1` (entirely left of the direction of
    /// travel) through `0` (centred) to `1` (entirely right).
    pub position: f64,
}

impl ExactStrokeStyle {
    pub const DEFAULT_MITER_LIMIT: f64 = 4.0;

    /// A round-cap, round-join style at `width`.
    pub fn round(width: f64) -> Self {
        Self {
            width,
            cap: Cap::Round,
            join: Join::Round,
            miter_limit: Self::DEFAULT_MITER_LIMIT,
            position: 0.0,
        }
    }
}

/// How near an outline's end must be to its start to count as closed.
const CLOSE_EPSILON: f64 = 1e-6;

/// Expands `skeleton` to a closed fill path at constant width, placed by
/// `style.position` (see [`super::position`]).
///
/// Open skeletons become closed outlines via the style's caps; closed skeletons
/// stay closed. `tolerance` is forwarded to kurbo's stroke flattener.
pub fn outline(skeleton: &BezPath, style: &ExactStrokeStyle, tolerance: f64) -> BezPath {
    super::position::aligned_outline(skeleton, style, tolerance)
}

/// The stroke centred on `skeleton`, by kurbo's stroker.
pub(super) fn centred_outline(
    skeleton: &BezPath,
    style: &ExactStrokeStyle,
    tolerance: f64,
) -> BezPath {
    let stroke_style = Stroke::new(style.width)
        .with_caps(style.cap)
        .with_join(style.join)
        .with_miter_limit(style.miter_limit);
    let stroked = stroke(
        skeleton.elements().iter().copied(),
        &stroke_style,
        &StrokeOpts::default(),
        tolerance,
    );

    close_returning_subpaths(&stroked)
}

/// Ends every subpath that returns to its start with an explicit `ClosePath`.
///
/// kurbo finishes the outline of an open skeleton on its start point without
/// a `ClosePath`, which would read back as an open contour that no fill draws.
fn close_returning_subpaths(path: &BezPath) -> BezPath {
    let mut closed = BezPath::new();
    let mut start = Point::ZERO;
    let mut current = Point::ZERO;
    let mut open_subpath = false;

    for element in path.elements() {
        match *element {
            PathEl::MoveTo(point) => {
                close_if_returned(&mut closed, open_subpath, start, current);
                closed.move_to(point);
                start = point;
                current = point;
                open_subpath = true;
            }
            PathEl::LineTo(point) => {
                closed.line_to(point);
                current = point;
            }
            PathEl::QuadTo(control, point) => {
                closed.quad_to(control, point);
                current = point;
            }
            PathEl::CurveTo(first, second, point) => {
                closed.curve_to(first, second, point);
                current = point;
            }
            PathEl::ClosePath => {
                closed.close_path();
                open_subpath = false;
            }
        }
    }
    close_if_returned(&mut closed, open_subpath, start, current);

    closed
}

fn close_if_returned(path: &mut BezPath, open_subpath: bool, start: Point, current: Point) {
    if open_subpath && current.distance(start) <= CLOSE_EPSILON {
        path.close_path();
    }
}

/// Whether `path` is closed within `epsilon` or ends with `ClosePath`.
pub fn path_is_closed(path: &BezPath, epsilon: f64) -> bool {
    if path
        .elements()
        .last()
        .is_some_and(|el| matches!(el, PathEl::ClosePath))
    {
        return true;
    }

    let mut start = None;
    let mut current = Point::ZERO;
    for el in path.elements() {
        match el {
            PathEl::MoveTo(point) => {
                start = Some(*point);
                current = *point;
            }
            PathEl::LineTo(point) | PathEl::QuadTo(_, point) | PathEl::CurveTo(_, _, point) => {
                current = *point;
            }
            PathEl::ClosePath => return true,
        }
    }
    match start {
        Some(start_point) => current.distance(start_point) <= epsilon,
        None => false,
    }
}

/// Counts on-curve points: move, line, and cubic end points.
pub fn count_on_curve(path: &BezPath) -> usize {
    path.elements()
        .iter()
        .filter(|el| {
            matches!(
                el,
                PathEl::MoveTo(_) | PathEl::LineTo(_) | PathEl::CurveTo(_, _, _)
            )
        })
        .count()
}

/// Counts cubic segments in `path`.
pub fn count_cubics(path: &BezPath) -> usize {
    path.elements()
        .iter()
        .filter(|el| matches!(el, PathEl::CurveTo(_, _, _)))
        .count()
}

/// Bounding box of `path`; empty paths return a zero rect at the origin.
pub fn path_bbox(path: &BezPath) -> Rect {
    path.bounding_box()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::*;

    struct Fixture {
        name: String,
        skeleton: BezPath,
        stroke_width: f64,
    }

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stroke")
    }

    fn json_string_field(body: &str, key: &str) -> Option<String> {
        let needle = format!("\"{key}\"");
        let key_start = body.find(&needle)?;
        let after_key = &body[key_start + needle.len()..];
        let colon = after_key.find(':')?;
        let rest = after_key[colon + 1..].trim_start();
        if !rest.starts_with('"') {
            return None;
        }
        let inner = &rest[1..];
        let end = inner.find('"')?;
        Some(inner[..end].to_string())
    }

    fn json_number_field(body: &str, key: &str) -> Option<f64> {
        let needle = format!("\"{key}\"");
        let key_start = body.find(&needle)?;
        let after_key = &body[key_start + needle.len()..];
        let colon = after_key.find(':')?;
        let rest = after_key[colon + 1..].trim_start();
        let end = rest
            .find(|character: char| [',', '}', '\n'].contains(&character))
            .unwrap_or(rest.len());
        rest[..end].trim().parse().ok()
    }

    fn load_json_fixture(path: &Path) -> Fixture {
        let body = fs::read_to_string(path).unwrap_or_else(|error| {
            panic!("read {}: {error}", path.display());
        });
        let name = json_string_field(&body, "name").unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("unknown")
                .to_string()
        });
        let path_d = json_string_field(&body, "path_d")
            .unwrap_or_else(|| panic!("missing path_d in {}", path.display()));
        let stroke_width = json_number_field(&body, "stroke_width").unwrap_or(20.0);
        let skeleton = BezPath::from_svg(&path_d)
            .unwrap_or_else(|error| panic!("invalid path_d in {name}: {error}"));
        Fixture {
            name,
            skeleton,
            stroke_width,
        }
    }

    fn load_fixtures() -> Vec<Fixture> {
        let dir = fixtures_dir();
        let mut fixtures = Vec::new();
        for entry in fs::read_dir(&dir).unwrap_or_else(|error| {
            panic!("read fixtures dir {}: {error}", dir.display());
        }) {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
                fixtures.push(load_json_fixture(&path));
            }
        }
        fixtures.sort_by(|left, right| left.name.cmp(&right.name));
        assert!(
            fixtures.len() >= 4,
            "expected at least four stroke fixtures in {}",
            dir.display()
        );
        fixtures
    }

    #[test]
    fn outline_ends_every_subpath_with_close_path() {
        let mut skeleton = BezPath::new();
        skeleton.move_to((0.0, 0.0));
        skeleton.line_to((100.0, 0.0));

        let expanded = outline(&skeleton, &ExactStrokeStyle::round(20.0), DEFAULT_TOLERANCE);

        let move_tos = expanded
            .elements()
            .iter()
            .filter(|element| matches!(element, PathEl::MoveTo(_)))
            .count();
        let close_paths = expanded
            .elements()
            .iter()
            .filter(|element| matches!(element, PathEl::ClosePath))
            .count();
        assert_eq!(move_tos, close_paths);
        assert!(matches!(
            expanded.elements().last(),
            Some(PathEl::ClosePath)
        ));
    }

    #[test]
    fn strokes_all_json_fixtures_with_round_cap_join() {
        let fixtures = load_fixtures();

        for fixture in &fixtures {
            let style = ExactStrokeStyle::round(fixture.stroke_width);
            let expanded = outline(&fixture.skeleton, &style, DEFAULT_TOLERANCE);
            let closed = path_is_closed(&expanded, 1e-6);
            let on_curve = count_on_curve(&expanded);
            let cubics = count_cubics(&expanded);
            let bbox = path_bbox(&expanded);

            assert!(
                closed,
                "{} outline should be a closed fill path",
                fixture.name
            );
            assert!(
                on_curve >= 4,
                "{} should have several outline points",
                fixture.name
            );
            assert!(
                on_curve <= MAX_ON_CURVE_POINTS,
                "{} expanded to {on_curve} on-curve points (ceiling {MAX_ON_CURVE_POINTS})",
                fixture.name
            );
            assert!(bbox.width() > 0.0 && bbox.height() > 0.0);

            match fixture.name.as_str() {
                "open-line" => {
                    let height = bbox.height();
                    assert!(
                        (height - fixture.stroke_width).abs() < 2.0,
                        "round caps: height {height} should track width {}",
                        fixture.stroke_width
                    );
                    let butt_style = ExactStrokeStyle {
                        width: fixture.stroke_width,
                        cap: Cap::Butt,
                        join: Join::Round,
                        miter_limit: ExactStrokeStyle::DEFAULT_MITER_LIMIT,
                        position: 0.0,
                    };
                    let butt = outline(&fixture.skeleton, &butt_style, DEFAULT_TOLERANCE);
                    assert!(
                        count_on_curve(&butt) < on_curve,
                        "round caps should add more points than butt caps"
                    );
                }
                "icon-l-stroke" => {
                    assert!(cubics >= 2, "L join + round caps should emit cubics");
                }
                "roman-stem" | "italic-stem" => {
                    assert!(
                        cubics >= 1,
                        "{} vertical or slanted stem should flatten to cubics",
                        fixture.name
                    );
                }
                "blackletter-stub" => {
                    assert!(cubics >= 2, "stub turn should flatten to multiple cubics");
                }
                _ => {}
            }
        }
    }
}
