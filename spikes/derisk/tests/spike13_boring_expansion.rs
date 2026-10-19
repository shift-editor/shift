//! Spike 13: sizing boring expansion's riskiest parts before building it.
//!
//! fontc 1.0 can't compile VARC or glyph-local axes, so until it does, Shift
//! exports parts by flattening each component into outlines per font master.
//! The preview interpolates the *parameters* (part location, transform), but a
//! decomposed font interpolates the flattened *outlines* linearly. This measures
//! the gap on real outlines, how many intermediate masters close it to 1 unit,
//! and what resolving a part per occurrence costs.
//!
//! `cargo test --release --test spike13_boring_expansion -- --nocapture --test-threads=1`

use std::time::Instant;

use shift_font::{DecomposedTransform, Font, Glyph};
use shift_workspace::FontWorkspace;

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

type Outline = Vec<(f64, f64)>;

fn font() -> (Font, tempfile::TempDir) {
    let store = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(MUTATOR, store.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    (workspace.font().clone(), store)
}

/// The glyph's outline at the named font source, as a flat point list.
fn outline(font: &Font, glyph: &Glyph, source_name: &str) -> Outline {
    let source = font.sources().iter().find(|s| s.name() == source_name).unwrap().id();
    let layer = glyph.layer_for_source(source).unwrap();
    layer.contours_iter().flat_map(|c| c.points().iter().map(|p| (p.x(), p.y()))).collect()
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn lerp_outline(a: &Outline, b: &Outline, t: f64) -> Outline {
    a.iter().zip(b).map(|(p, q)| (lerp(p.0, q.0, t), lerp(p.1, q.1, t))).collect()
}

fn lerp_transform(a: &DecomposedTransform, b: &DecomposedTransform, t: f64) -> DecomposedTransform {
    let (a, b) = (a.to_values(), b.to_values());
    let mut out = [0.0; DecomposedTransform::VALUE_COUNT];
    for i in 0..out.len() {
        out[i] = lerp(a[i], b[i], t);
    }
    DecomposedTransform::from_values(out)
}

fn apply(transform: &DecomposedTransform, outline: &Outline) -> Outline {
    let m = transform.to_matrix();
    outline.iter().map(|&(x, y)| m.transform_point(x, y)).collect()
}

/// [tx, ty, rotation°, sx, sy, skx, sky, cx, cy]
fn tf(values: [f64; 9]) -> DecomposedTransform {
    DecomposedTransform::from_values(values)
}

/// One use of a part along one font axis t ∈ [0, 1]: the part's own axis
/// location and the component transform both go from their t=0 to t=1 values.
/// `outer` optionally wraps it in a second, nested component.
struct Scenario {
    name: &'static str,
    location: (f64, f64),
    transform: (DecomposedTransform, DecomposedTransform),
    outer: Option<(DecomposedTransform, DecomposedTransform)>,
}

impl Scenario {
    /// What the editor shows: interpolate parameters, then resolve.
    fn preview(&self, part: &(Outline, Outline), t: f64) -> Outline {
        let w = lerp(self.location.0, self.location.1, t);
        let inner = apply(&lerp_transform(&self.transform.0, &self.transform.1, t), &lerp_outline(&part.0, &part.1, w));
        match &self.outer {
            Some((a, b)) => apply(&lerp_transform(a, b, t), &inner),
            None => inner,
        }
    }
}

fn max_distance(a: &Outline, b: &Outline) -> f64 {
    a.iter().zip(b).map(|(p, q)| ((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt()).fold(0.0, f64::max)
}

/// The decomposed font: exact outlines at the masters (`knots`), linear between.
/// Returns the worst gap over t and where it happens.
fn worst_gap(scenario: &Scenario, part: &(Outline, Outline), knots: &[f64]) -> (f64, f64) {
    let exact: Vec<Outline> = knots.iter().map(|&t| scenario.preview(part, t)).collect();
    let mut worst = (0.0, 0.0);
    for step in 0..=200 {
        let t = step as f64 / 200.0;
        let i = knots.windows(2).position(|w| t >= w[0] && t <= w[1]).unwrap();
        let local = (t - knots[i]) / (knots[i + 1] - knots[i]);
        let decomposed = lerp_outline(&exact[i], &exact[i + 1], local);
        let gap = max_distance(&scenario.preview(part, t), &decomposed);
        if gap > worst.0 {
            worst = (gap, t);
        }
    }
    worst
}

#[test]
fn decomposed_export_versus_preview() {
    let (font, _store) = font();
    let identity = tf([0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
    // Rotations turn about the same center at both ends.
    let centered = tf([0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 250.0, 350.0]);
    let scenarios = vec![
        Scenario { name: "translate only", location: (0.0, 0.0), transform: (identity, tf([120.0, -40.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0])), outer: None },
        Scenario { name: "part location only", location: (0.0, 1.0), transform: (identity, identity), outer: None },
        Scenario { name: "location + translate", location: (0.0, 1.0), transform: (identity, tf([120.0, -40.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0])), outer: None },
        Scenario { name: "location + scale 1.0→0.9", location: (0.0, 1.0), transform: (identity, tf([0.0, 0.0, 0.0, 0.9, 0.9, 0.0, 0.0, 0.0, 0.0])), outer: None },
        Scenario { name: "location + scale 1.0→0.7", location: (0.0, 1.0), transform: (identity, tf([0.0, 0.0, 0.0, 0.7, 0.7, 0.0, 0.0, 0.0, 0.0])), outer: None },
        Scenario { name: "location + scale 1.0→0.5", location: (0.0, 1.0), transform: (identity, tf([0.0, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 0.0])), outer: None },
        Scenario { name: "rotation 0→10°", location: (0.0, 0.0), transform: (centered, tf([0.0, 0.0, 10.0, 1.0, 1.0, 0.0, 0.0, 250.0, 350.0])), outer: None },
        Scenario { name: "rotation 0→45°", location: (0.0, 0.0), transform: (centered, tf([0.0, 0.0, 45.0, 1.0, 1.0, 0.0, 0.0, 250.0, 350.0])), outer: None },
        Scenario { name: "rotation 0→90° + location", location: (0.0, 1.0), transform: (centered, tf([0.0, 0.0, 90.0, 1.0, 1.0, 0.0, 0.0, 250.0, 350.0])), outer: None },
        Scenario {
            name: "nested: both scale 1.0→0.8 + location",
            location: (0.0, 1.0),
            transform: (identity, tf([0.0, 0.0, 0.0, 0.8, 0.8, 0.0, 0.0, 0.0, 0.0])),
            outer: Some((identity, tf([60.0, 0.0, 0.0, 0.8, 0.8, 0.0, 0.0, 0.0, 0.0]))),
        },
    ];

    for name in ["I", "S", "O"] {
        let glyph = font.glyphs().find(|g| g.name() == name).unwrap();
        let part = (outline(&font, glyph, "LightCondensed"), outline(&font, glyph, "BoldCondensed"));
        assert_eq!(part.0.len(), part.1.len(), "{name} masters are compatible");
        eprintln!("\npart {name} ({} points), font axis t from 0 to 1:", part.0.len());
        for scenario in &scenarios {
            let (first, at) = worst_gap(scenario, &part, &[0.0, 1.0]);
            // Fewest evenly spaced intermediate masters that bring the gap under 1 unit.
            let needed = (0..=16).find(|&n| {
                let knots: Vec<f64> = (0..=n + 1).map(|i| i as f64 / (n + 1) as f64).collect();
                worst_gap(scenario, &part, &knots).0 <= 1.0
            });
            let needed = needed.map_or("more than 16".to_string(), |n| n.to_string());
            eprintln!("  {:<40} worst gap {:>7.2} units at t={at:.2}; intermediate masters for ≤1 unit: {needed}", scenario.name, first);
        }
    }
}

/// Two independent font axes: the part's location follows weight, the
/// component's scale follows width. A decomposed font with masters at the four
/// corners interpolates bilinearly, which is exactly this product.
#[test]
fn independent_axes_decompose_exactly() {
    let (font, _store) = font();
    let glyph = font.glyphs().find(|g| g.name() == "S").unwrap();
    let part = (outline(&font, glyph, "LightCondensed"), outline(&font, glyph, "BoldCondensed"));
    let preview = |wght: f64, wdth: f64| {
        let scale = lerp(1.0, 0.7, wdth);
        apply(&tf([0.0, 0.0, 0.0, scale, scale, 0.0, 0.0, 0.0, 0.0]), &lerp_outline(&part.0, &part.1, wght))
    };
    let corners = [preview(0.0, 0.0), preview(1.0, 0.0), preview(0.0, 1.0), preview(1.0, 1.0)];
    let mut worst: f64 = 0.0;
    for i in 0..=20 {
        for j in 0..=20 {
            let (u, v) = (i as f64 / 20.0, j as f64 / 20.0);
            let bottom = lerp_outline(&corners[0], &corners[1], u);
            let top = lerp_outline(&corners[2], &corners[3], u);
            worst = worst.max(max_distance(&preview(u, v), &lerp_outline(&bottom, &top, v)));
        }
    }
    eprintln!("weight drives location, width drives scale: worst gap with 4 corner masters {worst:.6} units");
    assert!(worst < 1e-6);
}

/// Resolving a part per occurrence: interpolate its masters at the occurrence's
/// location and apply the transform. A lower bound for the engine's cost.
#[test]
fn per_occurrence_resolution_cost() {
    let (font, _store) = font();
    let glyph = font.glyphs().find(|g| g.name() == "S").unwrap();
    let part = (outline(&font, glyph, "LightCondensed"), outline(&font, glyph, "BoldCondensed"));
    let occurrences = 200_000;
    let start = Instant::now();
    let mut checksum = 0.0;
    for i in 0..occurrences {
        let w = (i % 1000) as f64 / 1000.0;
        let transform = tf([i as f64 % 300.0, 0.0, 0.0, 0.8, 0.8, 0.0, 0.0, 0.0, 0.0]);
        let resolved = apply(&transform, &lerp_outline(&part.0, &part.1, w));
        checksum += resolved[0].0;
    }
    let elapsed = start.elapsed();
    eprintln!(
        "{occurrences} occurrences of a {}-point part: {:.0} ns each ({:.1} ns per point); a 65k-glyph CJK font with 3 parts per glyph: {:.0} ms (checksum {checksum:.0})",
        part.0.len(),
        elapsed.as_nanos() as f64 / occurrences as f64,
        elapsed.as_nanos() as f64 / occurrences as f64 / part.0.len() as f64,
        elapsed.as_secs_f64() * 1000.0 * (65_535.0 * 3.0) / occurrences as f64
    );
}
