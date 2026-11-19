mod support;

use serde_json::{Value, json};
use support::{load_font, shift, shift_with_stdin};

/// A `Solenoid.shift` with Bleed (0–100, default 0) and Resolution (0–100,
/// default 100) axes, a Bled master at Bleed 100, and on both masters: `dot`,
/// `dollar.bled`, `dollar.heavy` and `dollar` (`$`), which is two `dot`
/// components, the second moved 50 right.
struct DollarFont {
    path: String,
    _dir: tempfile::TempDir,
}

impl DollarFont {
    fn new() -> std::io::Result<Self> {
        let dir = tempfile::tempdir()?;
        let path = dir
            .path()
            .join("Solenoid.shift")
            .to_string_lossy()
            .into_owned();
        let font = Self { path, _dir: dir };
        font.ok("font create", &[]);
        let axis = ["--min", "0", "--max", "100", "--default"];
        font.ok(
            "axis add",
            &[&axis[..], &["0", "--tag", "BLED", "--name", "Bleed"]].concat(),
        );
        font.ok(
            "axis add",
            &[&axis[..], &["100", "--tag", "RSLN", "--name", "Resolution"]].concat(),
        );
        font.ok("source add", &["--name", "Bled", "--location", "BLED=100"]);
        font.set_glyphs(&json!({"format": 1, "glyphs": Self::glyphs()}));
        Ok(font)
    }

    fn glyphs() -> Vec<Value> {
        let shape = json!({"advance": 100, "svgPath": "M0 0 L10 0 L10 10 Z"});
        let moved = json!({"base": "dot", "transform": [1, 0, 0, 1, 50, 0]});
        let dollar = json!({"advance": 100, "components": [{"base": "dot"}, moved]});
        let mut glyphs = Vec::new();
        for source in ["Regular", "Bled"] {
            for name in ["dot", "dollar.bled", "dollar.heavy"] {
                glyphs.push(json!({"name": name, "source": source, "layer": shape}));
            }
            glyphs.push(json!({
                "name": "dollar",
                "unicodes": ["U+0024"],
                "source": source,
                "layer": dollar,
            }));
        }
        glyphs
    }

    /// Runs `command` (such as `glyph alternate add`) on the font with
    /// `args` after its path.
    fn run(&self, command: &str, args: &[&str]) -> std::process::Output {
        let mut full: Vec<&str> = command.split(' ').collect();
        full.push(&self.path);
        full.extend(args);
        shift(&full)
    }

    /// Runs `command` and returns its output, which must succeed.
    fn ok(&self, command: &str, args: &[&str]) -> String {
        let output = self.run(command, args);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{command} {args:?}: {stderr}");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// Runs `command` and returns its error, which it must fail with.
    fn refused(&self, command: &str, args: &[&str]) -> String {
        let output = self.run(command, args);
        assert!(!output.status.success(), "{command} {args:?} succeeded");
        String::from_utf8_lossy(&output.stderr).into_owned()
    }

    /// Applies `batch` with `glyph set`, plus `flags`; returns its report.
    fn set_glyphs_with(&self, batch: &Value, flags: &[&str]) -> String {
        let args = [&["glyph", "set", &self.path, "--input", "-"][..], flags].concat();
        let output = shift_with_stdin(&args, &batch.to_string());
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{stderr}");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn set_glyphs(&self, batch: &Value) -> String {
        self.set_glyphs_with(batch, &[])
    }

    /// `glyph inspect --json` of `dollar`, at `location` when one is given.
    fn inspect_dollar(&self, location: Option<&str>) -> Option<Value> {
        let mut args = vec!["dollar", "--json"];
        args.extend(
            location
                .iter()
                .flat_map(|location| ["--location", location]),
        );
        serde_json::from_str(&self.ok("glyph inspect", &args)).ok()
    }

    /// `dollar`'s alternates, as `glyph inspect` lists them: the glyph each
    /// draws and its condition text.
    fn alternates(&self) -> Option<Vec<(String, Vec<String>)>> {
        let text = |value: &Value| value.as_str().map(str::to_string);
        self.inspect_dollar(None)?
            .get("alternates")?
            .as_array()?
            .iter()
            .map(|alternate| {
                let when = alternate.get("when")?.as_array()?;
                let when = when.iter().map(text).collect::<Option<Vec<_>>>()?;
                Some((text(alternate.get("glyph")?)?, when))
            })
            .collect()
    }

    /// The glyph text draws for `dollar` at `location`.
    fn drawn_at(&self, location: &str) -> Option<String> {
        let inspection = self.inspect_dollar(Some(location))?;
        Some(inspection.get("drawnGlyph")?.as_str()?.to_string())
    }

    /// How many contours `dollar` resolves to at `location`.
    fn dollar_contours_at(&self, location: &str) -> Option<u64> {
        self.inspect_dollar(Some(location))?
            .pointer("/summary/resolvedContourCount")?
            .as_u64()
    }
}

fn texts(values: &[&str]) -> Vec<String> {
    values.iter().map(ToString::to_string).collect()
}

#[test]
fn the_first_alternate_whose_condition_holds_is_drawn() {
    let font = DollarFont::new().unwrap();

    font.ok(
        "glyph alternate add",
        &["dollar", "dollar.bled", "--when", "Bleed >= 70"],
    );
    let heavy = [
        "dollar",
        "dollar.heavy",
        "--when",
        "BLED 90-100",
        "--at",
        "1",
    ];
    font.ok("glyph alternate add", &heavy);

    assert_eq!(font.drawn_at("BLED=95").unwrap(), "dollar.heavy");
    assert_eq!(font.drawn_at("BLED=80").unwrap(), "dollar.bled");
    assert_eq!(font.drawn_at("BLED=60").unwrap(), "dollar");
}

#[test]
fn alternates_are_moved_set_and_removed() {
    let font = DollarFont::new().unwrap();
    font.ok(
        "glyph alternate add",
        &["dollar", "dollar.heavy", "--when", "BLED 90-100"],
    );
    font.ok(
        "glyph alternate add",
        &["dollar", "dollar.bled", "--when", "BLED>=70"],
    );

    font.ok(
        "glyph alternate move",
        &["dollar", "dollar.heavy", "--to", "2"],
    );
    font.ok(
        "glyph alternate set",
        &["dollar", "1", "--when", "BLED<=20"],
    );
    let moved_and_set = font.alternates().unwrap();
    font.ok("glyph alternate remove", &["dollar", "1"]);

    assert_eq!(
        moved_and_set,
        [
            ("dollar.bled".into(), texts(&["Bleed ≤ 20"])),
            ("dollar.heavy".into(), texts(&["Bleed 90–100"])),
        ]
    );
    let left = font.alternates().unwrap();
    assert_eq!(left, [("dollar.heavy".into(), texts(&["Bleed 90–100"]))]);
    assert!(load_font(&font.path).glyph_by_name("dollar.bled").is_some());
}

#[test]
fn an_alternate_an_earlier_one_covers_is_reported_as_never_used() {
    let font = DollarFont::new().unwrap();
    font.ok(
        "glyph alternate add",
        &["dollar", "dollar.bled", "--when", "BLED>=70"],
    );

    let report = font.ok(
        "glyph alternate add",
        &["dollar", "dollar.heavy", "--when", "BLED>=80"],
    );
    let check = String::from_utf8_lossy(&font.run("check", &[]).stdout).into_owned();

    let warning = "2. dollar.heavy  when Bleed ≥ 80\n     warning: never used";
    assert!(report.contains(warning), "{report}");
    let finding =
        "A001 warning[never-used-alternate]: dollar: dollar.heavy (alternate 2) is never used";
    assert!(check.contains(finding), "{check}");
}

/// What `glyph alternate add` says when it refuses `dollar.bled` as an
/// alternate of `glyph` where `when` holds.
fn add_refusal(font: &DollarFont, glyph: &str, when: &str) -> String {
    font.refused(
        "glyph alternate add",
        &[glyph, "dollar.bled", "--when", when],
    )
}

#[test]
fn an_alternate_is_refused_on_a_glyph_axis_or_a_reversed_range() {
    let font = DollarFont::new().unwrap();
    let spread = [
        "dot",
        "--name",
        "Spread",
        "--min",
        "0",
        "--default",
        "0",
        "--max",
        "100",
    ];
    font.ok("glyph axis add", &spread);

    let on_glyph_axis = add_refusal(&font, "dot", "SPRD>=50");
    let reversed = add_refusal(&font, "dollar", "BLED 80-20");
    let unknown = add_refusal(&font, "dollar", "wght>=7");

    assert!(
        on_glyph_axis.contains("which is not a font axis"),
        "{on_glyph_axis}"
    );
    assert!(
        reversed.contains("the range 80 to 20 runs downwards"),
        "{reversed}"
    );
    assert!(
        unknown.contains("no axis is named or tagged \"wght\""),
        "{unknown}"
    );
    assert_eq!(font.alternates(), Some(Vec::new()));
}

#[test]
fn a_component_condition_is_set_in_every_master_and_hides_the_component() {
    let font = DollarFont::new().unwrap();

    font.ok(
        "component condition set",
        &["dollar", "2", "--when", "RSLN >= 50"],
    );

    let stored = load_font(&font.path);
    let dollar = stored.glyph_by_name("dollar").unwrap();
    let conditioned: Vec<usize> = dollar
        .layers()
        .values()
        .map(|layer| {
            layer
                .components_iter()
                .filter(|c| !c.condition().is_always())
                .count()
        })
        .collect();
    assert_eq!(conditioned, [1, 1]);
    assert_eq!(font.dollar_contours_at("RSLN=100").unwrap(), 2);
    assert_eq!(font.dollar_contours_at("RSLN=49,BLED=100").unwrap(), 1);
}

#[test]
fn a_component_condition_set_to_always_draws_everywhere_again() {
    let font = DollarFont::new().unwrap();
    font.ok(
        "component condition set",
        &["dollar", "2", "--when", "RSLN >= 50"],
    );

    font.ok("component condition set", &["dollar", "2", "--always"]);

    assert_eq!(font.dollar_contours_at("RSLN=0").unwrap(), 2);
}

#[test]
fn a_component_condition_may_not_read_the_axes_of_the_glyph_it_draws() {
    let font = DollarFont::new().unwrap();
    let spread = [
        "dot",
        "--name",
        "Spread",
        "--min",
        "0",
        "--default",
        "0",
        "--max",
        "100",
    ];
    font.ok("glyph axis add", &spread);

    let refused = font.refused(
        "component condition set",
        &["dollar", "1", "--when", "SPRD>=50"],
    );

    let reason = "neither a font axis nor an axis of the glyph it is placed in";
    assert!(refused.contains(reason), "{refused}");
}

#[test]
fn alternates_and_component_conditions_round_trip_through_glyph_set_and_export() {
    let font = DollarFont::new().unwrap();
    let moved =
        json!({"base": "dot", "transform": [1, 0, 0, 1, 50, 0], "condition": ["RSLN >= 50"]});
    let alternate = json!({"glyph": "dollar.bled", "when": ["Bleed ≥ 70", "RSLN<=50"]});
    let dollar = json!({"name": "dollar", "alternates": [alternate],
        "layer": {"advance": 100, "components": [{"base": "dot"}, moved]}});
    font.set_glyphs(&json!({"format": 1, "glyphs": [dollar]}));

    let exported: Value =
        serde_json::from_str(&font.ok("glyph export", &["--glyphs", "dollar"])).unwrap();
    let dollar = exported["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["name"] == "dollar")
        .unwrap();

    let written = json!([{"glyph": "dollar.bled", "when": ["BLED ≥ 70", "RSLN ≤ 50"]}]);
    assert_eq!(dollar["alternates"], written);
    assert_eq!(
        dollar["layer"]["components"][1]["condition"],
        json!(["RSLN ≥ 50"])
    );
    // What export wrote, glyph set reads back as the same.
    let again = font.set_glyphs_with(&json!({"format": 1, "glyphs": [dollar]}), &["--dry-run"]);
    assert!(
        again.contains("No files written") && !again.contains("alternates"),
        "{again}"
    );
}

#[test]
fn a_proof_draws_conditional_components_everywhere_and_warns() {
    let font = DollarFont::new().unwrap();
    font.ok(
        "component condition set",
        &["dollar", "2", "--when", "RSLN >= 50"],
    );
    let image = font._dir.path().join("dollar.png");

    let output = shift(&[
        "proof",
        &font.path,
        "--output",
        image.to_str().unwrap(),
        "--text",
        "$",
        "--json",
    ]);

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        report["warnings"],
        json!([{
            "code": "component-conditions-drawn-everywhere",
            "message": "compiled fonts can't hold component conditions yet, so this proof draws 1 conditional component everywhere: dollar: component 2 (dot)",
            "components": [{"glyph": "dollar", "position": 2, "base": "dot"}],
        }])
    );
    assert_eq!(
        stderr.trim(),
        "warning: compiled fonts can't hold component conditions yet, so this proof draws 1 conditional component everywhere: dollar: component 2 (dot)"
    );
}

#[test]
fn compile_still_refuses_conditional_components() {
    let font = DollarFont::new().unwrap();
    font.ok(
        "component condition set",
        &["dollar", "2", "--when", "RSLN >= 50"],
    );
    let output = font._dir.path().join("Solenoid.ttf");

    let error = font.refused("compile", &["--output", output.to_str().unwrap()]);

    assert!(error.contains("dollar: component 2 (dot)"), "{error}");
}
