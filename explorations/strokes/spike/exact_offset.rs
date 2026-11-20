//! F0.3 spike: expand a skeleton path to a constant-width outline with kurbo `stroke`.
//!
//! ## Caps and joins (kurbo 0.13)
//!
//! - **Round cap** (`Cap::Round`): semicircular end caps with radius `width / 2` on open
//!   subpaths. Adds cubic segments at each open end (visible in point count vs `Cap::Butt`).
//! - **Round join** (`Join::Round`): circular fillet between consecutive segments when the
//!   skeleton turns. At the L-stroke corner this adds arc/cubic geometry instead of a miter peak.
//!
//! This is parallel-curve expansion + caps/joins (Nehab-style), not a rigorous evolute sweep.
//! Matches the F0.3 `ExactOffset` direction before shift-font integration.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use kurbo::{stroke, BezPath, Cap, Join, PathEl, Point, Rect, Shape, Stroke, StrokeOpts};

const DEFAULT_TOLERANCE: f64 = 0.25;

struct Fixture {
    name: String,
    skeleton: BezPath,
    stroke_width: f64,
}

struct OutlineReport {
    fixture: String,
    stroke_width: f64,
    cap: Cap,
    join: Join,
    tolerance: f64,
    element_count: usize,
    on_curve_count: usize,
    cubic_count: usize,
    subpaths: usize,
    bbox: Rect,
    closed: bool,
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixtures_dir() -> PathBuf {
    manifest_dir().join("fixtures")
}

/// Minimal JSON field extractor (keeps the crate on kurbo only).
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
        .find(|c: char| c == ',' || c == '}' || c == '\n')
        .unwrap_or(rest.len());
    rest[..end].trim().parse().ok()
}

fn load_json_fixture(path: &Path) -> Result<Fixture, String> {
    let body = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let name = json_string_field(&body, "name").unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string()
    });
    let path_d = json_string_field(&body, "path_d")
        .ok_or_else(|| format!("missing path_d in {}", path.display()))?;
    let stroke_width = json_number_field(&body, "stroke_width").unwrap_or(20.0);
    let skeleton =
        BezPath::from_svg(&path_d).map_err(|err| format!("invalid path_d in {name}: {err}"))?;
    Ok(Fixture {
        name,
        skeleton,
        stroke_width,
    })
}

fn load_fixtures() -> Result<Vec<Fixture>, String> {
    let dir = fixtures_dir();
    let mut fixtures = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            fixtures.push(load_json_fixture(&path)?);
        }
    }
    fixtures.sort_by(|a, b| a.name.cmp(&b.name));
    if fixtures.is_empty() {
        return Err(format!("no JSON fixtures in {}", dir.display()));
    }
    Ok(fixtures)
}

fn count_subpaths(path: &BezPath) -> usize {
    path.elements()
        .iter()
        .filter(|el| matches!(el, PathEl::MoveTo(_)))
        .count()
        .max(1)
}

fn outline_is_closed(path: &BezPath, epsilon: f64) -> bool {
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
            PathEl::MoveTo(p) => {
                start = Some(*p);
                current = *p;
            }
            PathEl::LineTo(p) => current = *p,
            PathEl::QuadTo(_, p) => current = *p,
            PathEl::CurveTo(_, _, p) => current = *p,
            PathEl::ClosePath => return true,
        }
    }
    match start {
        Some(s) => current.distance(s) <= epsilon,
        None => false,
    }
}

fn count_on_curve(path: &BezPath) -> usize {
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

fn count_cubics(path: &BezPath) -> usize {
    path.elements()
        .iter()
        .filter(|el| matches!(el, PathEl::CurveTo(_, _, _)))
        .count()
}

fn expand_skeleton(
    skeleton: &BezPath,
    width: f64,
    cap: Cap,
    join: Join,
    tolerance: f64,
) -> BezPath {
    let style = Stroke::new(width)
        .with_caps(cap)
        .with_join(join);
    stroke(
        skeleton.elements().iter().copied(),
        &style,
        &StrokeOpts::default(),
        tolerance,
    )
}

fn report_outline(
    fixture: &Fixture,
    outline: &BezPath,
    cap: Cap,
    join: Join,
    tolerance: f64,
) -> OutlineReport {
    OutlineReport {
        fixture: fixture.name.clone(),
        stroke_width: fixture.stroke_width,
        cap,
        join,
        tolerance,
        element_count: outline.elements().len(),
        on_curve_count: count_on_curve(outline),
        cubic_count: count_cubics(outline),
        subpaths: count_subpaths(outline),
        bbox: outline.bounding_box(),
        closed: outline_is_closed(outline, 1e-6),
    }
}

fn print_report(report: &OutlineReport) {
    let Rect {
        x0,
        y0,
        x1,
        y1,
    } = report.bbox;
    println!("--- {} ---", report.fixture);
    println!("  skeleton stroke width: {}", report.stroke_width);
    println!("  cap: {:?}, join: {:?}", report.cap, report.join);
    println!("  tolerance: {}", report.tolerance);
    println!(
        "  outline: {} elements, {} on-curve points, {} cubics, {} subpath(s), closed={}",
        report.element_count,
        report.on_curve_count,
        report.cubic_count,
        report.subpaths,
        report.closed
    );
    println!(
        "  bbox: ({x0:.2}, {y0:.2}) – ({x1:.2}, {y1:.2})  size {:.2} × {:.2}",
        x1 - x0,
        y1 - y0
    );
    if report.fixture == "open-line" {
        let height = y1 - y0;
        println!(
            "  open-path note: round caps expect bbox height ≈ stroke width ({:.2}); got {height:.2}",
            report.stroke_width
        );
    }
}

fn run_demo() -> Result<(), String> {
    let fixtures = load_fixtures()?;
    println!("kurbo exact-offset spike (stroke expansion)");
    println!("fixtures dir: {}", fixtures_dir().display());
    println!();

    for fixture in &fixtures {
        let outline = expand_skeleton(
            &fixture.skeleton,
            fixture.stroke_width,
            Cap::Round,
            Join::Round,
            DEFAULT_TOLERANCE,
        );
        let report = report_outline(
            fixture,
            &outline,
            Cap::Round,
            Join::Round,
            DEFAULT_TOLERANCE,
        );
        print_report(&report);

        if fixture.name == "open-line" {
            let butt = expand_skeleton(
                &fixture.skeleton,
                fixture.stroke_width,
                Cap::Butt,
                Join::Round,
                DEFAULT_TOLERANCE,
            );
            let butt_report = report_outline(
                fixture,
                &butt,
                Cap::Butt,
                Join::Round,
                DEFAULT_TOLERANCE,
            );
            println!("  cap comparison (Butt vs Round on open-line):");
            println!(
                "    Butt: {} on-curve, {} cubics",
                butt_report.on_curve_count, butt_report.cubic_count
            );
            println!(
                "    Round: {} on-curve, {} cubics",
                report.on_curve_count, report.cubic_count
            );
        }
        println!();
    }

    Ok(())
}

fn main() {
    if let Err(err) = run_demo() {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strokes_all_json_fixtures_with_round_cap_join() {
        let fixtures = load_fixtures().expect("fixtures");
        assert!(fixtures.len() >= 2);

        for fixture in &fixtures {
            let outline = expand_skeleton(
                &fixture.skeleton,
                fixture.stroke_width,
                Cap::Round,
                Join::Round,
                DEFAULT_TOLERANCE,
            );
            let report = report_outline(
                &fixture,
                &outline,
                Cap::Round,
                Join::Round,
                DEFAULT_TOLERANCE,
            );

            assert!(
                report.closed,
                "{} outline should be a closed fill path",
                fixture.name
            );
            assert!(
                report.on_curve_count >= 4,
                "{} should have several outline points",
                fixture.name
            );
            assert!(report.bbox.width() > 0.0 && report.bbox.height() > 0.0);

            match fixture.name.as_str() {
                "open-line" => {
                    let height = report.bbox.height();
                    assert!(
                        (height - fixture.stroke_width).abs() < 2.0,
                        "round caps: height {height} should track width {}",
                        fixture.stroke_width
                    );
                    let round_count = report.on_curve_count;
                    let butt = expand_skeleton(
                        &fixture.skeleton,
                        fixture.stroke_width,
                        Cap::Butt,
                        Join::Round,
                        DEFAULT_TOLERANCE,
                    );
                    assert!(
                        count_on_curve(&butt) < round_count,
                        "round caps should add more points than butt caps"
                    );
                }
                "icon-l-stroke" => {
                    assert!(
                        report.cubic_count >= 2,
                        "L join + round caps should emit cubics"
                    );
                }
                _ => {}
            }
        }
    }

    #[test]
    fn json_and_svg_skeletons_agree() {
        let json = load_json_fixture(&fixtures_dir().join("icon-l-stroke.json")).unwrap();
        let svg_body =
            fs::read_to_string(fixtures_dir().join("icon-l-stroke.svg")).unwrap();
        let marker = " d=\"";
        let d_start = svg_body.find(marker).unwrap() + marker.len();
        let d_end = svg_body[d_start..].find('"').unwrap() + d_start;
        let path_d = &svg_body[d_start..d_end];
        let from_svg = BezPath::from_svg(path_d).unwrap();
        assert_eq!(json.skeleton.elements().len(), from_svg.elements().len());
    }
}