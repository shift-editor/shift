use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use shift_slug::VariableAtlasBuilder;
use skrifa::raw::tables::gvar::GlyphDelta;
use skrifa::raw::tables::variations::TupleVariation;
use skrifa::raw::types::MajorMinor;
use skrifa::raw::{ReadError, TableProvider};
use skrifa::FontRef;

use crate::font_source::atlas::{
    AtlasAxis, AtlasRegion, RegionAxis, RegionRegistry, SourceAtlasError, SourceAtlasPage,
};
use crate::font_source::{GlyphIndex, RandomAccessFont};

use super::{malformed, BinaryFont};

mod geometry;
mod metrics;

struct PendingGlyph {
    root: GlyphIndex,
    curves: geometry::VariableCurves,
    base_advance: f32,
    advance_deltas: BTreeMap<u32, f32>,
    source_weights: BTreeSet<u32>,
}

/// Compiles one deterministic root batch directly from retained glyf/gvar semantics.
pub fn build_binary_atlas_page(
    source: &BinaryFont,
    roots: &[GlyphIndex],
    band_count: u32,
) -> Result<SourceAtlasPage, SourceAtlasError> {
    source.verify_source()?;
    validate_roots(source, roots)?;
    let font = FontRef::new(source.bytes().as_ref()).map_err(|error| {
        malformed(
            &source.path,
            format!("failed to reopen retained font: {error}"),
        )
    })?;
    let loca = font.loca(None).map_err(|error| match error {
        ReadError::TableIsMissing(_) => SourceAtlasError::UnsupportedBinary {
            details: "the first direct atlas slice supports glyf outlines only",
        },
        error => malformed(&source.path, format!("failed to read loca table: {error}")).into(),
    })?;
    let glyf = font.glyf().map_err(|error| match error {
        ReadError::TableIsMissing(_) => SourceAtlasError::UnsupportedBinary {
            details: "the first direct atlas slice supports glyf outlines only",
        },
        error => malformed(&source.path, format!("failed to read glyf table: {error}")).into(),
    })?;
    let gvar = match font.gvar() {
        Ok(gvar) => Some(gvar),
        Err(ReadError::TableIsMissing(_)) => None,
        Err(error) => {
            return Err(
                malformed(&source.path, format!("failed to read gvar table: {error}")).into(),
            )
        }
    };
    let axes = atlas_axes(source, &font)?;
    let mut registry = RegionRegistry::default();
    let mut pending = Vec::with_capacity(roots.len());

    for root in roots {
        let curves = geometry::resolve_variable_curves(
            &source.path,
            loca.clone(),
            glyf.clone(),
            gvar.clone(),
            &mut registry,
            *root,
        )?;
        let (base_advance, advance_deltas) = metrics::advance_contributions(
            &source.path,
            &font,
            loca.clone(),
            glyf.clone(),
            gvar.clone(),
            &mut registry,
            *root,
        )?;
        let source_weights = curves
            .sources
            .keys()
            .chain(advance_deltas.keys())
            .copied()
            .collect();
        pending.push(PendingGlyph {
            root: *root,
            curves,
            base_advance,
            advance_deltas,
            source_weights,
        });
    }

    let complement_start = u32::try_from(registry.len())
        .map_err(|_| shift_slug::SlugError::LengthOverflow)?
        .checked_add(1)
        .ok_or(shift_slug::SlugError::LengthOverflow)?;
    let mut complement_indices = HashMap::<Vec<u32>, u32>::new();
    let mut complements = Vec::<Box<[u32]>>::new();
    let mut builder = VariableAtlasBuilder::new(band_count)?;
    let mut glyphs = Vec::with_capacity(pending.len());

    for pending in pending {
        let source_weights = pending.source_weights.into_iter().collect::<Vec<_>>();
        let base_weight = if source_weights.is_empty() {
            0
        } else if let Some(weight) = complement_indices.get(&source_weights) {
            *weight
        } else {
            let weight = complement_start
                .checked_add(
                    u32::try_from(complements.len())
                        .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
                )
                .ok_or(shift_slug::SlugError::LengthOverflow)?;
            complements.push(source_weights.clone().into_boxed_slice());
            complement_indices.insert(source_weights.clone(), weight);
            weight
        };
        let mut variable_sources = pending.curves.sources;
        let base_curves = pending.curves.base;
        let source_curves = source_weights
            .iter()
            .map(|weight| {
                (
                    *weight,
                    variable_sources
                        .remove(weight)
                        .unwrap_or_else(|| base_curves.clone()),
                )
            })
            .collect::<Vec<_>>();
        let atlas_glyph = builder.add_curve_glyph_with_sources_and_lines(
            base_curves,
            pending.curves.line_flags,
            base_weight,
            source_curves,
        )?;
        builder.set_glyph_source_advances(
            atlas_glyph,
            std::iter::once(pending.base_advance).chain(source_weights.iter().map(|weight| {
                pending.base_advance + pending.advance_deltas.get(weight).copied().unwrap_or(0.0)
            })),
        )?;
        glyphs.push((pending.root, atlas_glyph));
    }

    Ok(SourceAtlasPage::new(
        builder.finish(),
        glyphs,
        axes,
        registry.into_regions(),
        complements,
    ))
}

fn validate_roots(source: &BinaryFont, roots: &[GlyphIndex]) -> Result<(), SourceAtlasError> {
    let mut unique = HashSet::with_capacity(roots.len());
    for root in roots {
        if source.directory().glyphs.get(root.to_usize()).is_none() {
            return Err(crate::font_source::FontReadError::GlyphOutOfRange {
                glyph: *root,
                glyph_count: source.directory().glyphs.len() as u32,
            }
            .into());
        }
        if !unique.insert(*root) {
            return Err(crate::font_source::FontReadError::InvalidDisplayGlyph {
                details: format!("source atlas page repeats glyph {root:?}"),
            }
            .into());
        }
    }
    Ok(())
}

fn atlas_axes(source: &BinaryFont, font: &FontRef<'_>) -> Result<Vec<AtlasAxis>, SourceAtlasError> {
    let mappings = match font.avar() {
        Ok(avar) => {
            if avar.version() != MajorMinor::VERSION_1_0 {
                return Err(SourceAtlasError::UnsupportedBinary {
                    details:
                        "avar version 2 requires a location mapping model in the resident page",
                });
            }
            if avar.axis_count() as usize != source.directory.axes.len() {
                return Err(
                    malformed(&source.path, "avar axis count does not match fvar".into()).into(),
                );
            }
            avar.axis_segment_maps()
                .iter()
                .map(|mapping| {
                    let mapping = mapping.map_err(|error| {
                        malformed(
                            &source.path,
                            format!("failed to read avar segment map: {error}"),
                        )
                    })?;
                    Ok(mapping
                        .axis_value_maps()
                        .iter()
                        .map(|value| {
                            (
                                value.from_coordinate().to_bits(),
                                value.to_coordinate().to_bits(),
                            )
                        })
                        .collect::<Vec<_>>())
                })
                .collect::<Result<Vec<_>, SourceAtlasError>>()?
        }
        Err(ReadError::TableIsMissing(_)) => vec![Vec::new(); source.directory.axes.len()],
        Err(error) => {
            return Err(
                malformed(&source.path, format!("failed to read avar table: {error}")).into(),
            )
        }
    };
    Ok(source
        .directory
        .axes
        .iter()
        .cloned()
        .zip(mappings)
        .map(|(axis, mapping)| AtlasAxis::new(axis, mapping))
        .collect())
}

pub(super) fn tuple_region(tuple: &TupleVariation<'_, GlyphDelta>) -> AtlasRegion {
    let peak = tuple.peak();
    let start = tuple.intermediate_start();
    let end = tuple.intermediate_end();
    AtlasRegion::new(
        peak.values()
            .iter()
            .enumerate()
            .map(|(index, peak)| {
                let peak = peak.get().to_bits();
                match (&start, &end) {
                    (Some(start), Some(end)) => RegionAxis {
                        start: start.values()[index].get().to_bits(),
                        peak,
                        end: end.values()[index].get().to_bits(),
                    },
                    _ if peak < 0 => RegionAxis {
                        start: peak,
                        peak,
                        end: 0,
                    },
                    _ => RegionAxis {
                        start: 0,
                        peak,
                        end: peak,
                    },
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use shift_slug::{AtlasBuilder, Curve, OutlineCommand, DEFAULT_BAND_COUNT};
    use skrifa::outline::pen::PathStyle;
    use skrifa::outline::{DrawSettings, OutlinePen};
    use skrifa::prelude::{LocationRef, Size};
    use skrifa::{FontRef, MetadataProvider};

    use super::{build_binary_atlas_page, BinaryFont, SourceAtlasError};
    use crate::font_source::{RandomAccessFont, VariationAxisKind, VariationCoordinate};

    #[derive(Default)]
    struct CommandPen(Vec<OutlineCommand<f32>>);

    impl OutlinePen for CommandPen {
        fn move_to(&mut self, x: f32, y: f32) {
            self.0.push(OutlineCommand::Move { x, y });
        }

        fn line_to(&mut self, x: f32, y: f32) {
            self.0.push(OutlineCommand::Line { x, y });
        }

        fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
            self.0.push(OutlineCommand::Quad { cx, cy, x, y });
        }

        fn curve_to(&mut self, c1x: f32, c1y: f32, c2x: f32, c2y: f32, x: f32, y: f32) {
            self.0.push(OutlineCommand::Cubic {
                c1x,
                c1y,
                c2x,
                c2y,
                x,
                y,
            });
        }

        fn close(&mut self) {
            self.0.push(OutlineCommand::Close);
        }
    }

    fn repository_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    fn fixture(name: &str) -> PathBuf {
        repository_root()
            .join("fixtures/fonts/mutatorsans")
            .join(name)
    }

    #[test]
    fn direct_page_matches_variable_simple_and_composite_outlines() {
        let source =
            BinaryFont::open(&repository_root().join(
                "apps/desktop/src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf",
            ))
            .unwrap();
        let roots = ["A", "Aacute", "space"].map(|name| {
            source
                .directory()
                .glyphs
                .iter()
                .find(|glyph| glyph.name == name)
                .unwrap()
                .index
        });
        assert!(!source
            .read_glyph(roots[1], source.directory().default_location())
            .unwrap()
            .components
            .is_empty());
        let page = build_binary_atlas_page(&source, &roots, DEFAULT_BAND_COUNT).unwrap();
        let axis = &source.directory().axes[0];
        let (default, maximum) = match axis.kind {
            VariationAxisKind::Continuous {
                default, maximum, ..
            } => (default, maximum),
            VariationAxisKind::Discrete { .. } => panic!("fixture axis should be continuous"),
        };
        let midpoint_location = source
            .directory()
            .location(&[VariationCoordinate {
                axis: axis.index,
                value: (default + maximum) * 0.5,
            }])
            .unwrap();
        let maximum_location = source
            .directory()
            .location(&[VariationCoordinate {
                axis: axis.index,
                value: maximum,
            }])
            .unwrap();

        for location in [
            source.directory().default_location(),
            &midpoint_location,
            &maximum_location,
        ] {
            let weights = page.weights(location).unwrap();
            for (glyph, atlas_glyph) in page.glyphs() {
                let actual = page
                    .atlas()
                    .resolve_glyph_with_weights(*atlas_glyph, &weights)
                    .unwrap();
                let expected = skrifa_curves(&source, *glyph, location);
                assert_curves_close(&actual, &expected);
                let actual_advance = page
                    .atlas()
                    .resolve_advance_with_weights(*atlas_glyph, &weights)
                    .unwrap();
                let expected_advance = source
                    .read_glyph(*glyph, location)
                    .unwrap()
                    .metrics
                    .x_advance;
                assert!((f64::from(actual_advance) - expected_advance).abs() < 0.001);
            }
        }
    }

    #[test]
    fn direct_pages_cover_every_host_grotesk_glyph() {
        let source =
            BinaryFont::open(&repository_root().join(
                "apps/desktop/src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf",
            ))
            .unwrap();
        let location = source.directory().default_location();

        for roots in source
            .directory()
            .glyphs
            .iter()
            .map(|glyph| glyph.index)
            .collect::<Vec<_>>()
            .chunks(256)
        {
            let page = build_binary_atlas_page(&source, roots, DEFAULT_BAND_COUNT).unwrap();
            assert_eq!(page.glyphs().len(), roots.len());
            let weights = page.weights(location).unwrap();
            for (glyph, atlas_glyph) in page.glyphs() {
                let actual = page
                    .atlas()
                    .resolve_glyph_with_weights(*atlas_glyph, &weights)
                    .unwrap();
                assert_curves_close(&actual, &skrifa_curves(&source, *glyph, location));
            }
        }
    }

    #[test]
    fn direct_page_matches_a_uniform_host_grotesk_sample() {
        let source =
            BinaryFont::open(&repository_root().join(
                "apps/desktop/src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf",
            ))
            .unwrap();
        let roots = source
            .directory()
            .glyphs
            .iter()
            .step_by(17)
            .map(|glyph| glyph.index)
            .collect::<Vec<_>>();
        let page = build_binary_atlas_page(&source, &roots, DEFAULT_BAND_COUNT).unwrap();
        let axis = &source.directory().axes[0];
        let (default, maximum) = match axis.kind {
            VariationAxisKind::Continuous {
                default, maximum, ..
            } => (default, maximum),
            VariationAxisKind::Discrete { .. } => panic!("fixture axis should be continuous"),
        };
        let location = source
            .directory()
            .location(&[VariationCoordinate {
                axis: axis.index,
                value: (default + maximum) * 0.5,
            }])
            .unwrap();
        let weights = page.weights(&location).unwrap();

        for (glyph, atlas_glyph) in page.glyphs() {
            let actual = page
                .atlas()
                .resolve_glyph_with_weights(*atlas_glyph, &weights)
                .unwrap();
            assert_curves_close(&actual, &skrifa_curves(&source, *glyph, &location));
        }
    }

    #[test]
    fn direct_page_rejects_cff_sources_explicitly() {
        let source = BinaryFont::open(&fixture("MutatorSans.otf")).unwrap();
        let error = build_binary_atlas_page(
            &source,
            &[source.directory().glyphs[0].index],
            DEFAULT_BAND_COUNT,
        )
        .unwrap_err();

        assert!(matches!(error, SourceAtlasError::UnsupportedBinary { .. }));
    }

    fn skrifa_curves(
        source: &BinaryFont,
        glyph: crate::font_source::GlyphIndex,
        location: &crate::font_source::VariationLocation,
    ) -> Vec<Curve> {
        let font = FontRef::new(source.bytes().as_ref()).unwrap();
        let location = source.skrifa_location(&font, location).unwrap();
        let mut pen = CommandPen::default();
        if let Some(outline) = font
            .outline_glyphs()
            .get(skrifa::GlyphId::new(glyph.to_u32()))
        {
            outline
                .draw(
                    DrawSettings::unhinted(Size::unscaled(), LocationRef::from(&location))
                        .with_path_style(PathStyle::HarfBuzz),
                    &mut pen,
                )
                .unwrap();
        }
        let mut builder = AtlasBuilder::new(DEFAULT_BAND_COUNT).unwrap();
        builder.add_glyph(pen.0).unwrap();
        builder.finish().curves().to_vec()
    }

    fn assert_curves_close(actual: &[Curve], expected: &[Curve]) {
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected) {
            for (actual, expected) in [
                (actual.p0, expected.p0),
                (actual.p1, expected.p1),
                (actual.p2, expected.p2),
            ] {
                assert!(
                    (actual.x - expected.x).abs() < 0.001,
                    "x mismatch: actual={} expected={} delta={}",
                    actual.x,
                    expected.x,
                    actual.x - expected.x
                );
                assert!(
                    (actual.y - expected.y).abs() < 0.001,
                    "y mismatch: actual={} expected={} delta={}",
                    actual.y,
                    expected.y,
                    actual.y - expected.y
                );
            }
        }
    }
}
