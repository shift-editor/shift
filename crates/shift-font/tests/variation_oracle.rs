//! Differential test of axis mapping and interpolation against fontdrasil,
//! the library fontc compiles variable fonts with.
//!
//! A fixed-seed generator builds one- and two-axis fonts whose mappings put
//! the default at either end, reverse, rescale, or flatten the axis, places
//! masters at the design values the mapping gives the axis ends, and checks
//! that Shift maps and normalizes like fontdrasil and that every master
//! interpolates to itself. A failure prints the case so it can become a
//! focused test.

#![allow(
    clippy::cast_possible_truncation,
    reason = "test and benchmark arithmetic on small known values"
)]

use fontdrasil::coords::{CoordConverter, DesignCoord, UserCoord};
use shift_font::{
    Axis, AxisId, AxisMapping, AxisMappingPoint, Contour, DesignLocation, ExternalLocation, Font,
    Glyph, GlyphLayer, LayerId, Location, PointType, Source,
};

/// Cases per run. The generator is deterministic, so a failure reproduces.
const CASES: usize = 400;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn pick(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    /// A value in `lo..hi`, usually a whole number.
    fn value(&mut self, lo: f64, hi: f64) -> f64 {
        let value = lo + (hi - lo) * self.unit();
        if self.pick(3) == 0 {
            value
        } else {
            value.round().clamp(lo, hi)
        }
    }
}

#[derive(Debug)]
struct AxisCase {
    tag: &'static str,
    min: f64,
    default: f64,
    max: f64,
    /// User to design points, sorted by user value; empty for no mapping.
    map: Vec<(f64, f64)>,
}

impl AxisCase {
    fn random(rng: &mut Rng, tag: &'static str) -> Self {
        let scale = [1.0, 10.0, 100.0, 1000.0][rng.pick(4)];
        let mut ends = [rng.value(-scale, scale), rng.value(-scale, scale)];
        ends.sort_by(f64::total_cmp);
        let (min, max) = (ends[0], ends[1].max(ends[0] + scale * 0.01));
        let default = match rng.pick(3) {
            0 => min,
            1 => max,
            _ => rng.value(min, max),
        };
        let mut users = vec![min, default, max];
        for _ in 0..rng.pick(4) {
            users.push(rng.value(min, max));
        }
        users.sort_by(f64::total_cmp);
        users.dedup();

        let design_scale = [0.01, 0.1, 1.0, 3.0][rng.pick(4)] * scale;
        let offset = (rng.unit() * 4.0 - 2.0) * scale;
        let direction = if rng.pick(2) == 0 { 1.0 } else { -1.0 };
        let map = match rng.pick(3) {
            0 => Vec::new(),
            1 => users.iter().map(|user| (*user, *user)).collect(),
            _ => {
                let mut design = 0.0;
                users
                    .iter()
                    .map(|user| {
                        design += (0.1 + 0.9 * rng.unit()) * design_scale;
                        (*user, offset + direction * design)
                    })
                    .collect()
            }
        };
        Self {
            tag,
            min,
            default,
            max,
            map,
        }
    }

    fn converter(&self) -> CoordConverter {
        if self.map.is_empty() {
            return CoordConverter::unmapped(
                UserCoord::new(self.min),
                UserCoord::new(self.default),
                UserCoord::new(self.max),
            );
        }
        let default = self
            .map
            .iter()
            .position(|(user, _)| *user == self.default)
            .unwrap();
        CoordConverter::new(
            self.map
                .iter()
                .map(|(user, design)| (UserCoord::new(*user), DesignCoord::new(*design)))
                .collect(),
            default,
        )
        .unwrap()
    }

    fn to_design(&self, user: f64) -> f64 {
        UserCoord::new(user).to_design(&self.converter()).to_f64()
    }

    fn normalized(&self, design: f64) -> f64 {
        DesignCoord::new(design)
            .to_normalized(&self.converter())
            .to_f64()
    }
}

fn square(source_id: shift_font::SourceId, size: f64) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, size + 100.0);
    let mut contour = Contour::new();
    for (x, y) in [(0.0, 0.0), (0.0, size), (size, size), (size, 0.0)] {
        contour.add_point(x, y, PointType::OnCurve, false);
    }
    contour.close();
    layer.add_contour(contour);
    layer
}

/// A generated font with its axes and each master's expected glyph width.
struct Built {
    font: Font,
    axes: Vec<AxisId>,
    masters: Vec<(shift_font::SourceId, f64)>,
}

/// Builds the font, or `None` when Shift rightly rejects the axis setup.
fn build(cases: &[AxisCase]) -> Option<Built> {
    let mut font = Font::new();
    let mut ids = Vec::new();
    for case in cases {
        let axis = Axis::new(
            case.tag.into(),
            case.tag.into(),
            case.min,
            case.default,
            case.max,
        );
        ids.push(axis.id());
        font.add_axis(axis).ok()?;
    }
    let mappings = cases
        .iter()
        .zip(&ids)
        .filter(|(case, _)| !case.map.is_empty())
        .map(|(case, id)| {
            AxisMapping::new(
                format!("{} mapping", case.tag),
                vec![id.clone()],
                vec![id.clone()],
                case.map
                    .iter()
                    .map(|(user, design)| AxisMappingPoint {
                        description: None,
                        input: Location::from([(id.clone(), *user)]),
                        output: Location::from([(id.clone(), *design)]),
                    })
                    .collect(),
            )
        })
        .collect();
    font.set_axis_mappings(mappings).ok()?;

    let mut placements: Vec<Vec<f64>> = vec![cases.iter().map(|case| case.default).collect()];
    for (index, case) in cases.iter().enumerate() {
        for end in [case.min, case.max] {
            if end != case.default {
                let mut user: Vec<f64> = cases.iter().map(|case| case.default).collect();
                user[index] = end;
                placements.push(user);
            }
        }
    }

    let default_id = font.default_source_id().unwrap();
    let mut glyph = Glyph::new("square");
    let mut masters = Vec::new();
    for (index, user) in placements.iter().enumerate() {
        let location: DesignLocation = cases
            .iter()
            .zip(&ids)
            .zip(user)
            .map(|((case, id), value)| (id.clone(), case.to_design(*value)))
            .collect();
        let source_id = if index == 0 {
            font.source_mut(&default_id).unwrap().set_location(location);
            default_id.clone()
        } else {
            font.add_source(Source::new(format!("Master {index}"), location))
        };
        let width = 100.0 + 50.0 * index as f64;
        glyph.set_layer(square(source_id.clone(), width));
        masters.push((source_id, width + 100.0));
    }
    font.insert_glyph(glyph).ok()?;
    Some(Built {
        font,
        axes: ids,
        masters,
    })
}

fn failures(cases: &[AxisCase]) -> Vec<String> {
    let Some(Built {
        font,
        axes: ids,
        masters,
    }) = build(cases)
    else {
        return Vec::new();
    };
    let mut failures = Vec::new();
    let normalization = font.design_normalization().unwrap();

    for (index, case) in cases.iter().enumerate() {
        for step in 0..=8 {
            let user = case.min + (case.max - case.min) * step as f64 / 8.0;
            let external = ExternalLocation::from([(ids[index].clone(), user)]);
            let ours = font
                .mapped_location(&external)
                .unwrap()
                .get(&ids[index])
                .unwrap();
            let theirs = case.to_design(user);
            if (ours - theirs).abs() > 1e-6 * (1.0 + theirs.abs()) {
                failures.push(format!(
                    "{} user {user} maps to {ours}, fontdrasil {theirs}",
                    case.tag
                ));
            }
            let (ours, theirs) = (
                normalization[index].normalize(theirs),
                case.normalized(theirs),
            );
            if (ours - theirs).abs() > 1e-6 {
                failures.push(format!(
                    "{} normalizes to {ours}, fontdrasil {theirs}",
                    case.tag
                ));
            }
        }
    }

    let glyph = font.glyph_by_name("square").unwrap();
    let Some(interpolation) = font.glyph_interpolation(&glyph.id()).unwrap() else {
        failures.push("the glyph can't be interpolated".into());
        return failures;
    };
    for (source_id, width) in masters {
        let source = font.source(&source_id).unwrap();
        let layer = interpolation
            .resolve(source.location(), font.axes())
            .unwrap();
        if (layer.width() - width).abs() > 1e-6 {
            failures.push(format!(
                "master '{}' interpolates to width {} instead of {width}",
                source.name(),
                layer.width()
            ));
        }
    }
    failures
}

#[test]
fn shift_maps_normalizes_and_interpolates_like_fontdrasil() {
    let mut rng = Rng(0x5eed);
    for case_index in 0..CASES {
        let cases = if rng.pick(3) == 0 {
            vec![
                AxisCase::random(&mut rng, "wght"),
                AxisCase::random(&mut rng, "wdth"),
            ]
        } else {
            vec![AxisCase::random(&mut rng, "wght")]
        };
        let found = failures(&cases);
        assert!(found.is_empty(), "case {case_index} {cases:?}: {found:#?}");
    }
}
