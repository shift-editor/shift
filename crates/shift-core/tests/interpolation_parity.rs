//! Parity-test fixture writer.
//!
//! Loads the real MutatorSans designspace, builds variation data for a glyph,
//! computes the expected interpolated values via fontdrasil at a known target,
//! and writes a JSON fixture for the TS parity test (in
//! `apps/desktop/src/renderer/src/lib/interpolation/interpolate.test.ts`) to
//! read back and assert the TS port agrees to within f64 precision.
//!
//! Run: `cargo test -p shift-core --test interpolation_parity`.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::types::Tag;
use fontdrasil::variations::VariationModel;
use serde::Serialize;

use shift_core::font_loader::FontLoader;
use shift_core::interpolation::{
    build_master_snapshots, get_glyph_variation_data, GlyphVariationData,
};
use shift_core::snapshot::GlyphGeometry;
use shift_ir::variation::to_fd_location;
use shift_ir::Location;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn fixture_designspace() -> PathBuf {
    workspace_root().join("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace")
}

fn fixture_output() -> PathBuf {
    workspace_root().join("packages/types/__fixtures__/variation_parity.json")
}

/// Local copy of the `flatten` walk used by `get_glyph_variation_data`.
/// Kept private to the test so production `flatten` can stay private.
/// Order MUST match shift-core::interpolation::flatten exactly.
fn flatten_geometry(g: &GlyphGeometry) -> Vec<f64> {
    let mut v = vec![g.x_advance];
    for c in &g.contours {
        for p in &c.points {
            v.push(p.x);
            v.push(p.y);
        }
    }
    for a in &g.anchors {
        v.push(a.x);
        v.push(a.y);
    }
    v
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterEntry {
    source_name: String,
    is_default_source: bool,
    designspace_location: BTreeMap<String, f64>,
    normalised_location: BTreeMap<String, f64>,
    /// Flat values at this master, in `flatten()` order.
    /// `interpolate(data, normalisedLocation)` must equal this within 1e-9.
    expected: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    /// For diagnostics — which glyph we sampled.
    glyph_name: String,

    /// Mid-designspace target (for the headline parity assertion).
    designspace_target: BTreeMap<String, f64>,
    normalised_location: BTreeMap<String, f64>,

    /// What the TS `interpolate()` consumes — same shape Rust ships over NAPI.
    data: GlyphVariationData,

    /// Ground truth from fontdrasil's `interpolate_from_deltas` at the mid target.
    /// TS port must match within ~1e-9.
    expected: Vec<f64>,

    /// Per-master round-trip data: at each master's location, interpolation must
    /// recover that master's exact flat values. Catches unpacking drift between
    /// Rust's flatten() and TS's applyValues walk.
    masters: Vec<MasterEntry>,
}

#[test]
fn write_parity_fixture() {
    let designspace = fixture_designspace();
    let loader = FontLoader::new();
    let font = loader
        .read_font(designspace.to_str().unwrap())
        .expect("load MutatorSans designspace");

    // "A" is present in all four corner masters of MutatorSans — safe choice.
    const GLYPH: &str = "A";
    let glyph = font.glyph(GLYPH).expect("glyph A missing");

    let masters = build_master_snapshots(&font, glyph).expect("not variable / no masters");
    assert!(
        masters.len() >= 4,
        "expected ≥ 4 masters for A, got {}",
        masters.len()
    );

    let axes = font.axes();
    let data = get_glyph_variation_data(&masters, axes).expect("variation data");

    // Pick a non-trivial target — middle of designspace on each axis.
    let mut target = Location::new();
    for axis in axes {
        let mid = (axis.minimum() + axis.maximum()) / 2.0;
        target.set(axis.tag().to_string(), mid);
    }
    let target_norm = to_fd_location(&target, axes);

    // Compute expected via fontdrasil directly — this is the ground truth.
    let ordered_axes: Vec<Tag> = axes
        .iter()
        .filter_map(|a| Tag::from_str(a.tag()).ok())
        .collect();

    let mut points: HashMap<NormalizedLocation, Vec<f64>> = HashMap::new(); // fontdrasil API takes HashMap
    for m in &masters {
        let loc = to_fd_location(&m.location, axes);
        points.insert(loc, flatten_geometry(&m.geometry));
    }
    let model = VariationModel::new(points.keys().cloned().collect(), ordered_axes);
    let model_deltas = model.deltas::<f64, f64>(&points).expect("compute deltas");
    let expected: Vec<f64> = model.interpolate_from_deltas(&target_norm, &model_deltas);

    let designspace_target: BTreeMap<String, f64> = target
        .iter()
        .map(|(tag, value)| (tag.clone(), *value))
        .collect();
    let normalised_location: BTreeMap<String, f64> = target_norm
        .iter()
        .map(|(tag, coord)| (tag.to_string(), coord.into_inner().into_inner()))
        .collect();

    // Per-master round-trip data — at each master's location, interpolation
    // must equal that master's flat values.
    let master_entries: Vec<MasterEntry> = masters
        .iter()
        .map(|m| {
            let m_norm = to_fd_location(&m.location, axes);
            let m_expected = model.interpolate_from_deltas(&m_norm, &model_deltas);
            MasterEntry {
                source_name: m.source_name.clone(),
                is_default_source: m.is_default_source,
                designspace_location: m
                    .location
                    .iter()
                    .map(|(k, v)| (k.clone(), *v))
                    .collect::<BTreeMap<_, _>>(),
                normalised_location: m_norm
                    .iter()
                    .map(|(t, c)| (t.to_string(), c.into_inner().into_inner()))
                    .collect::<BTreeMap<_, _>>(),
                expected: m_expected,
            }
        })
        .collect();

    let fixture = Fixture {
        glyph_name: GLYPH.to_string(),
        designspace_target,
        normalised_location,
        data,
        expected,
        masters: master_entries,
    };

    let out = fixture_output();
    // Trailing newline to match what pre-commit's end-of-file-fixer expects;
    // without it the fixer would re-add it, breaking idempotency on re-runs.
    let new_json = format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap());

    // Idempotent: only write when content actually changes. This keeps the
    // fixture stable across CI runs and pre-commit hooks (which run cargo
    // test) — without it, every run would rewrite the file and the hook
    // would flag "files modified after staging."
    let needs_write = match fs::read_to_string(&out) {
        Ok(existing) => existing != new_json,
        Err(_) => true,
    };
    if needs_write {
        fs::create_dir_all(out.parent().unwrap()).expect("mkdir __fixtures__");
        fs::write(&out, &new_json).expect("write fixture");
        println!("wrote parity fixture → {}", out.display());
    } else {
        println!("parity fixture up to date ({})", out.display());
    }
}
