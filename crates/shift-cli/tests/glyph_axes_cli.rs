//! A Solenoid-like font built entirely through the CLI: a Bleed axis with
//! Regular and Bled masters; `dot`, a two-point line with axes of its own
//! (Spread and Strike), drawn on both masters, at Spread 100 and at Strike
//! 100; and `H`, two `dot` components on both masters (the first at Spread
//! 60) plus a brace drawing at Bleed 50 on no source (the first at Spread
//! 80).
//!
//! At Bleed `b`, Spread `s` and Strike `k`, `dot` draws (0.2b, 0.5k) to
//! (10 + 0.2b + s, 0.5k).

mod support;

use std::process::Output;

use serde_json::{Value, json};
use shift_font::{DesignLocation, Font, GlyphAxis};
use support::{load_font, shift, shift_with_stdin};

type BuildResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

/// The built font's document, kept alive with its directory.
struct Solenoid {
    _temp: tempfile::TempDir,
    path: String,
}

impl Solenoid {
    fn build() -> BuildResult<Self> {
        let temp = tempfile::tempdir()?;
        let path = build_solenoid(&temp)?;
        Ok(Self { _temp: temp, path })
    }

    /// Runs `args` with this font's path in place of `{}`.
    fn shift(&self, args: &[&str]) -> Output {
        let args: Vec<&str> = args
            .iter()
            .map(|arg| {
                if *arg == "{}" {
                    self.path.as_str()
                } else {
                    arg
                }
            })
            .collect();
        shift(&args)
    }

    fn font(&self) -> Font {
        load_font(&self.path)
    }
}

/// Runs the CLI, failing with its error output when it fails.
fn shift_ok(args: &[&str]) -> BuildResult<Output> {
    let output = shift(args);
    if !output.status.success() {
        return Err(format!("{args:?}: {}", String::from_utf8_lossy(&output.stderr)).into());
    }
    Ok(output)
}

fn svg_line(from: (i32, i32), to: (i32, i32)) -> String {
    format!("M{} {} L{} {}", from.0, from.1, to.0, to.1)
}

fn h_layer(spread: f64) -> Value {
    json!({"advance": 720, "components": [
        {"base": "dot", "location": {"SPRD": spread}},
        {"base": "dot", "transform": [1, 0, 0, 1, 500, 0]},
    ]})
}

/// Builds the font in `temp` and returns its path.
fn build_solenoid(temp: &tempfile::TempDir) -> BuildResult<String> {
    let path = temp
        .path()
        .join("Solenoid.shift")
        .to_string_lossy()
        .into_owned();
    let p = path.as_str();
    let range = ["--min", "0", "--default", "0", "--max", "100"];
    shift_ok(&["font", "create", p])?;
    shift_ok(
        &[
            &["axis", "add", p, "--tag", "BLED", "--name", "Bleed"][..],
            &range,
        ]
        .concat(),
    )?;
    shift_ok(&[
        "source",
        "add",
        p,
        "--name",
        "Bled",
        "--location",
        "BLED=100",
    ])?;
    shift_ok(&["glyph", "add", p, "dot"])?;
    shift_ok(&["glyph", "add", p, "H"])?;
    for name in ["Spread", "Strike"] {
        shift_ok(
            &[
                &["glyph", "axis", "add", p, "dot", "--name", name][..],
                &range,
            ]
            .concat(),
        )?;
    }

    let dot = |from, to| json!({"advance": 0, "svgPath": svg_line(from, to)});
    let batch = json!({"format": 1, "glyphs": [
        {"name": "dot", "source": "Regular", "layer": dot((0, 0), (10, 0))},
        {"name": "dot", "source": "Bled", "layer": dot((20, 0), (30, 0))},
        {"name": "dot", "source": "Regular", "location": {"SPRD": 100}, "layer": dot((0, 0), (110, 0))},
        {"name": "H", "source": "Regular", "layer": h_layer(60.0)},
        {"name": "H", "source": "Bled", "layer": h_layer(60.0)},
    ]});
    let output = shift_with_stdin(&["glyph", "set", p, "--input", "-"], &batch.to_string());
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }

    let strike = temp.path().join("strike.json");
    std::fs::write(&strike, dot((0, 50), (10, 50)).to_string())?;
    let strike = strike.to_str().ok_or("non-UTF-8 path")?;
    shift_ok(&[
        "layer",
        "add",
        p,
        "--glyph",
        "dot",
        "--source",
        "Regular",
        "--location",
        "STRK=100",
        "--input",
        strike,
    ])?;
    let brace = temp.path().join("brace.json");
    std::fs::write(&brace, h_layer(80.0).to_string())?;
    let brace = brace.to_str().ok_or("non-UTF-8 path")?;
    shift_ok(&[
        "layer",
        "add",
        p,
        "--glyph",
        "H",
        "--location",
        "BLED=50",
        "--input",
        brace,
    ])?;
    Ok(path)
}

/// Each contour of `glyph` drawn at `coordinates`, as its points.
fn points_drawn(
    font: &Font,
    glyph: &str,
    coordinates: &[(&str, f64)],
) -> BuildResult<Vec<Vec<(f64, f64)>>> {
    let location: DesignLocation = coordinates
        .iter()
        .map(|(tag, value)| {
            Some((
                font.axis_id_in_glyph_space(font.glyph_id_by_name("dot"), tag)?,
                *value,
            ))
        })
        .collect::<Option<_>>()
        .ok_or("unknown axis tag")?;
    let glyph_id = font.glyph_by_name(glyph).ok_or("no such glyph")?.id();
    let projected = font
        .projection(&location)
        .glyph(glyph_id)?
        .ok_or("the glyph draws nothing")?;
    Ok(projected
        .contours()
        .iter()
        .map(|contour| {
            contour
                .points
                .iter()
                .map(|point| (point.x(), point.y()))
                .collect()
        })
        .collect())
}

/// Every Spread value `H`'s components set, in ascending order.
fn component_spreads(font: &Font) -> Vec<f64> {
    let (Some(spread), Some(h)) = (
        font.axis_id_in_glyph_space(font.glyph_id_by_name("dot"), "SPRD"),
        font.glyph_by_name("H"),
    ) else {
        return Vec::new();
    };
    let mut values: Vec<f64> = h
        .layers()
        .values()
        .flat_map(|layer| layer.components_iter())
        .filter_map(|component| component.location().get(&spread))
        .collect();
    values.sort_by(f64::total_cmp);
    values
}

fn error_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn a_font_built_through_the_cli_draws_its_glyph_axes_after_reopening() {
    let font = Solenoid::build().unwrap().font();

    // `dot` along its own axes, and with Bleed.
    let spread = points_drawn(&font, "dot", &[("SPRD", 50.0)]).unwrap();
    let strike = points_drawn(&font, "dot", &[("STRK", 100.0)]).unwrap();
    let both = points_drawn(&font, "dot", &[("BLED", 50.0), ("SPRD", 50.0)]).unwrap();
    assert_eq!(spread, [[(0.0, 0.0), (60.0, 0.0)]]);
    assert_eq!(strike, [[(0.0, 50.0), (10.0, 50.0)]]);
    assert_eq!(both, [[(10.0, 0.0), (70.0, 0.0)]]);
    // H's first component sets Spread 60: a dot between the two drawings.
    let h = points_drawn(&font, "H", &[("BLED", 0.0)]).unwrap();
    assert_eq!(h, [[(0.0, 0.0), (70.0, 0.0)], [(500.0, 0.0), (510.0, 0.0)]]);
}

#[test]
fn a_brace_drawing_on_no_source_is_drawn_where_it_sits() {
    let font = Solenoid::build().unwrap().font();

    let h = font.glyph_by_name("H").unwrap();
    let brace = h
        .layers()
        .values()
        .find(|layer| layer.is_located())
        .unwrap();
    assert_eq!(brace.source_id(), None);
    // At Bleed 50 the brace drawing's first component draws dot at Spread 80.
    let at_brace = points_drawn(&font, "H", &[("BLED", 50.0)]).unwrap();
    assert_eq!(at_brace[0], [(10.0, 0.0), (100.0, 0.0)]);
}

#[test]
fn rescaling_moves_drawings_and_component_locations_on_disk() {
    let solenoid = Solenoid::build().unwrap();
    let before = points_drawn(&solenoid.font(), "H", &[("BLED", 0.0)]).unwrap();

    let output = solenoid.shift(&[
        "glyph",
        "axis",
        "edit",
        "{}",
        "dot",
        "SPRD",
        "--max",
        "1000",
        "--rescale",
    ]);

    assert!(output.status.success(), "{}", error_text(&output));
    let font = solenoid.font();
    assert_eq!(component_spreads(&font), [600.0, 600.0, 800.0]);
    let spread = points_drawn(&font, "dot", &[("SPRD", 1000.0)]).unwrap();
    assert_eq!(spread, [[(0.0, 0.0), (110.0, 0.0)]]);
    assert_eq!(points_drawn(&font, "H", &[("BLED", 0.0)]).unwrap(), before);
}

#[test]
fn a_range_that_strands_values_is_refused_naming_them() {
    let solenoid = Solenoid::build().unwrap();
    let before = solenoid.font();

    let output = solenoid.shift(&["glyph", "axis", "edit", "{}", "dot", "SPRD", "--max", "70"]);

    assert!(!output.status.success());
    let stderr = error_text(&output);
    assert!(
        stderr.contains("dot drawing at Regular + SPRD=100: SPRD=100"),
        "{stderr}"
    );
    assert!(stderr.contains("H component"), "{stderr}");
    assert!(stderr.contains("SPRD=80"), "{stderr}");
    assert!(!stderr.contains("SPRD=60"), "{stderr}");
    assert_eq!(solenoid.font(), before);
}

#[test]
fn an_axis_in_use_is_not_removed() {
    let solenoid = Solenoid::build().unwrap();

    let output = solenoid.shift(&["glyph", "axis", "remove", "{}", "dot", "STRK"]);

    assert!(!output.status.success());
    let stderr = error_text(&output);
    assert!(
        stderr.contains("dot drawing at Regular + STRK=100"),
        "{stderr}"
    );
    assert_eq!(
        solenoid.font().glyph_by_name("dot").unwrap().axes().len(),
        2
    );
}

#[test]
fn an_axis_is_removed_once_its_drawing_is_gone() {
    let solenoid = Solenoid::build().unwrap();

    let removed = solenoid.shift(&[
        "layer",
        "remove",
        "{}",
        "--glyph",
        "dot",
        "--source",
        "Regular",
        "--location",
        "STRK=100",
    ]);
    let output = solenoid.shift(&["glyph", "axis", "remove", "{}", "dot", "STRK"]);

    assert!(removed.status.success(), "{}", error_text(&removed));
    assert!(output.status.success(), "{}", error_text(&output));
    let font = solenoid.font();
    let dot = font.glyph_by_name("dot").unwrap();
    let tags: Vec<&str> = dot.axes().iter().map(GlyphAxis::tag).collect();
    assert_eq!(tags, ["SPRD"]);
    assert_eq!(dot.layers().len(), 3);
}

#[test]
fn a_drawing_moves_to_a_new_location() {
    let solenoid = Solenoid::build().unwrap();

    let output = solenoid.shift(&[
        "layer",
        "move",
        "{}",
        "--glyph",
        "dot",
        "--source",
        "Regular",
        "--location",
        "STRK=100",
        "--to-location",
        "STRK=50",
    ]);

    assert!(output.status.success(), "{}", error_text(&output));
    let font = solenoid.font();
    // Moved off any source, the drawing now sits at Strike 50 and Bleed 0.
    let at_50 = points_drawn(&font, "dot", &[("STRK", 50.0)]).unwrap();
    let at_25 = points_drawn(&font, "dot", &[("STRK", 25.0)]).unwrap();
    assert_eq!(at_50, [[(0.0, 50.0), (10.0, 50.0)]]);
    assert_eq!(at_25, [[(0.0, 25.0), (10.0, 25.0)]]);
}

#[test]
fn a_component_location_on_an_axis_its_base_lacks_is_refused() {
    let solenoid = Solenoid::build().unwrap();
    let batch = json!({"glyphs": [
        {"name": "dot", "source": "Regular", "layer": {"advance": 0, "components": [
            {"base": "H", "location": {"SPRD": 10}},
        ]}},
    ]});

    let output = shift_with_stdin(
        &["glyph", "set", &solenoid.path, "--input", "-"],
        &batch.to_string(),
    );

    assert!(!output.status.success());
    let stderr = error_text(&output);
    assert!(stderr.contains("no axis tagged \"SPRD\""), "{stderr}");
}

#[test]
fn inspect_reports_glyph_axes_and_drawing_locations() {
    let solenoid = Solenoid::build().unwrap();

    let output = solenoid.shift(&["inspect", "--json", "{}"]);

    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let glyphs = report["glyphs"].as_array().unwrap();
    let dot = glyphs.iter().find(|glyph| glyph["name"] == "dot").unwrap();
    let tags: Vec<&Value> = dot["axes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|axis| &axis["tag"])
        .collect();
    assert_eq!(tags, ["SPRD", "STRK"]);
    let h = glyphs.iter().find(|glyph| glyph["name"] == "H").unwrap();
    let brace = h["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|layer| layer["sourceId"].is_null())
        .unwrap();
    assert_eq!(brace["location"][0]["axisTag"], "BLED");
    assert_eq!(brace["location"][0]["value"], 50.0);
}
