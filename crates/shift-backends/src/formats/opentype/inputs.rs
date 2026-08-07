use std::collections::BTreeMap;

use shift_slug::retained::PageCompiler;
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::tables::gvar::GlyphDelta;
use skrifa::raw::tables::variations::TupleVariation;
use skrifa::raw::types::{F2Dot14, GlyphId};
use skrifa::raw::{ReadError, TableProvider};
use skrifa::{FontRef, MetadataProvider};

use crate::font_source::atlas::{
    validate_roots, AtlasAxis, AtlasRegion, RegionAxis, RegionRegistry, SourceAtlasError,
    SourceAtlasPage,
};
use crate::font_source::{
    inferred_smooth_point_indices, malformed, FontReadError, FontSource, GlyphComponent,
    GlyphDelta as ProjectedDelta, GlyphIndex, GlyphPointKind, GlyphProjection, GlyphShape,
    GlyphShapeContour, GlyphShapePoint, GlyphVariation, PointProvenance, ProjectedGlyph,
    VariationAxisKind, VariationRegion, VariationSupport,
};

use super::{geometry, metrics, tables, OpenTypeFont};

/// Compiles one selected glyph and its component closure directly from glyf/gvar semantics.
pub(super) fn project_binary_glyph(
    source: &OpenTypeFont,
    root: GlyphIndex,
) -> Result<ProjectedGlyph, FontReadError> {
    validate_roots(source.directory(), &[root]).map_err(source_atlas_read_error)?;
    let (font, variable_tables) = tables::variable_tables(source)?;
    let Some((loca, glyf, gvar)) = variable_tables else {
        return project_static_cff_glyph(source, &font, root);
    };
    // Validate avar support now; projection supports are post-mapping coordinates.
    atlas_axes(source).map_err(source_atlas_read_error)?;
    let mut registry = RegionRegistry::default();
    let glyphs = geometry::resolve_variable_glyphs(
        &source.path,
        loca.clone(),
        glyf.clone(),
        gvar.clone(),
        &mut registry,
        root,
    )
    .map_err(source_atlas_read_error)?;
    let glyph_indices = glyphs.iter().map(|glyph| glyph.glyph).collect::<Vec<_>>();
    let advances = metrics::advance_contributions(
        &source.path,
        &font,
        loca.clone(),
        glyf.clone(),
        gvar.clone(),
        &mut registry,
        &glyph_indices,
    )
    .map_err(source_atlas_read_error)?;
    let pending = glyphs
        .into_iter()
        .zip(advances)
        .map(|(glyph, advance)| (glyph, f64::from(advance.base), advance.deltas))
        .collect::<Vec<_>>();
    let regions = registry.regions();
    let mut projections = pending
        .iter()
        .map(|(glyph, advance, advance_deltas)| {
            variable_glyph_projection(glyph, *advance, advance_deltas, regions)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let root = projections.remove(0);
    Ok(ProjectedGlyph {
        root,
        components: projections.into_boxed_slice(),
    })
}

#[derive(Clone)]
struct CffProjectionContour {
    points: Vec<geometry::VariablePoint>,
    closed: bool,
}

#[derive(Default)]
struct CffProjectionPen {
    contours: Vec<CffProjectionContour>,
    current: Vec<geometry::VariablePoint>,
}

impl CffProjectionPen {
    fn finish_contour(&mut self, closed: bool) {
        if self.current.is_empty() {
            return;
        }
        if closed && self.current.len() > 1 {
            let first = &self.current[0].position;
            let last = &self.current[self.current.len() - 1].position;
            if first.x == last.x && first.y == last.y {
                self.current.pop();
            }
        }
        for index in inferred_smooth_point_indices(
            &self.current,
            closed,
            |point| (point.position.x, point.position.y),
            |point| point.kind == GlyphPointKind::OnCurve,
        ) {
            self.current[index].smooth = true;
        }
        self.contours.push(CffProjectionContour {
            points: std::mem::take(&mut self.current),
            closed,
        });
    }

    fn push(&mut self, x: f32, y: f32, kind: GlyphPointKind) {
        self.current.push(geometry::VariablePoint {
            position: geometry::VariablePosition {
                x: f64::from(x),
                y: f64::from(y),
                deltas: BTreeMap::new(),
            },
            kind,
            smooth: false,
            provenance: PointProvenance::Native {
                ttf_point_index: None,
            },
        });
    }

    fn shape(&self, advance: f64) -> GlyphShape {
        let mut values = vec![advance];
        let contours = self
            .contours
            .iter()
            .map(|contour| {
                for point in &contour.points {
                    values.extend([point.position.x, point.position.y]);
                }
                GlyphShapeContour {
                    points: contour
                        .points
                        .iter()
                        .map(|point| GlyphShapePoint {
                            kind: point.kind,
                            smooth: point.smooth,
                            provenance: point.provenance,
                        })
                        .collect(),
                    closed: contour.closed,
                }
            })
            .collect();
        GlyphShape {
            contours,
            anchors: Box::new([]),
            components: Box::new([]),
            values: values.into_boxed_slice(),
        }
    }

    fn curves(&self) -> Result<geometry::VariableCurves, SourceAtlasError> {
        geometry::static_curves(
            self.contours
                .iter()
                .map(|contour| geometry::VariableContour {
                    points: contour.points.clone(),
                })
                .collect(),
        )
    }
}

impl OutlinePen for CffProjectionPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish_contour(false);
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.push(cx0, cy0, GlyphPointKind::QuadraticControl);
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.push(cx0, cy0, GlyphPointKind::CubicControl);
        self.push(cx1, cy1, GlyphPointKind::CubicControl);
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn close(&mut self) {
        self.finish_contour(true);
    }
}

fn project_static_cff_glyph(
    source: &OpenTypeFont,
    font: &FontRef<'_>,
    glyph: GlyphIndex,
) -> Result<ProjectedGlyph, FontReadError> {
    validate_static_cff(source, font)?;
    let (pen, advance) = draw_static_cff_glyph(source, font, glyph)?;
    let root = GlyphProjection {
        glyph,
        fallback: pen.shape(f64::from(advance)),
        variation: None,
        exact_shapes: Box::new([]),
    };
    root.validate(source.directory.axes.len(), source.directory.sources.len())?;
    Ok(ProjectedGlyph {
        root,
        components: Box::new([]),
    })
}

fn validate_static_cff(source: &OpenTypeFont, font: &FontRef<'_>) -> Result<(), FontReadError> {
    if !source.directory.axes.is_empty() {
        return Err(FontReadError::UnsupportedProjection {
            details: "variable CFF projection is not supported",
        });
    }
    match font.cff() {
        Ok(_) => Ok(()),
        Err(ReadError::TableIsMissing(_)) => Err(FontReadError::UnsupportedProjection {
            details: "binary font has neither glyf nor CFF outlines",
        }),
        Err(error) => Err(malformed(
            &source.path,
            format!("failed to read CFF table: {error}"),
        )),
    }
}

fn draw_static_cff_glyph(
    source: &OpenTypeFont,
    font: &FontRef<'_>,
    glyph: GlyphIndex,
) -> Result<(CffProjectionPen, f32), FontReadError> {
    let raw_glyph = GlyphId::new(glyph.to_u32());
    let mut pen = CffProjectionPen::default();
    if let Some(outline) = font.outline_glyphs().get(raw_glyph) {
        outline
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut pen,
            )
            .map_err(|error| {
                malformed(
                    &source.path,
                    format!("failed to draw CFF glyph {raw_glyph}: {error}"),
                )
            })?;
    }
    pen.finish_contour(false);
    let advance = font
        .glyph_metrics(Size::unscaled(), LocationRef::default())
        .advance_width(raw_glyph)
        .ok_or_else(|| {
            malformed(
                &source.path,
                format!("missing advance width for glyph {raw_glyph}"),
            )
        })?;
    Ok((pen, advance))
}

fn variable_glyph_projection(
    glyph: &geometry::VariableGlyph,
    advance: f64,
    advance_deltas: &BTreeMap<u32, f32>,
    regions: &[AtlasRegion],
) -> Result<GlyphProjection, FontReadError> {
    let mut values = vec![advance];
    for contour in &glyph.contours {
        for point in &contour.points {
            values.extend([point.position.x, point.position.y]);
        }
    }
    for component in &glyph.components {
        values.extend([
            component.transform.xx,
            component.transform.xy,
            component.transform.yx,
            component.transform.yy,
            component.translation.x,
            component.translation.y,
        ]);
    }
    let fallback = GlyphShape {
        contours: glyph
            .contours
            .iter()
            .map(|contour| GlyphShapeContour {
                points: contour
                    .points
                    .iter()
                    .map(|point| GlyphShapePoint {
                        kind: point.kind,
                        smooth: point.smooth,
                        provenance: point.provenance,
                    })
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
                closed: true,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        anchors: Box::new([]),
        components: glyph
            .components
            .iter()
            .map(|component| GlyphComponent {
                glyph: component.glyph,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        values: values.into_boxed_slice(),
    };
    let mut deltas = Vec::new();
    for (region_index, region) in regions.iter().enumerate() {
        let weight =
            u32::try_from(region_index + 1).map_err(|_| FontReadError::InvalidProjection {
                details: "binary projection region index exceeds u32".into(),
            })?;
        let mut values = vec![0.0; fallback.values.len()];
        values[0] = f64::from(advance_deltas.get(&weight).copied().unwrap_or(0.0));
        let mut cursor = 1;
        for contour in &glyph.contours {
            for point in &contour.points {
                let (x, y) = point
                    .position
                    .deltas
                    .get(&weight)
                    .copied()
                    .unwrap_or_default();
                values[cursor] = x;
                values[cursor + 1] = y;
                cursor += 2;
            }
        }
        for component in &glyph.components {
            cursor += 4;
            let (x, y) = component
                .translation
                .deltas
                .get(&weight)
                .copied()
                .unwrap_or_default();
            values[cursor] = x;
            values[cursor + 1] = y;
            cursor += 2;
        }
        if values.iter().all(|value| *value == 0.0) {
            continue;
        }
        let supports = region
            .axes()
            .iter()
            .enumerate()
            .filter(|(_, axis)| axis.peak != 0)
            .map(|(axis, support)| VariationSupport {
                axis: crate::font_source::AxisIndex::new(axis as u32),
                lower: f64::from(support.start) / 16384.0,
                peak: f64::from(support.peak) / 16384.0,
                upper: f64::from(support.end) / 16384.0,
            })
            .collect::<Vec<_>>();
        deltas.push(ProjectedDelta {
            region: VariationRegion {
                supports: supports.into_boxed_slice(),
            },
            values: values.into_boxed_slice(),
        });
    }
    let projection = GlyphProjection {
        glyph: glyph.glyph,
        fallback,
        variation: (!deltas.is_empty()).then_some(GlyphVariation {
            deltas: deltas.into_boxed_slice(),
        }),
        exact_shapes: Box::new([]),
    };
    projection.validate(regions.first().map_or(0, |region| region.axes().len()), 1)?;
    Ok(projection)
}

fn source_atlas_read_error(error: SourceAtlasError) -> FontReadError {
    match error {
        SourceAtlasError::Read(error) => error,
        SourceAtlasError::UnsupportedBinary { details } => {
            FontReadError::UnsupportedProjection { details }
        }
        SourceAtlasError::Slug(error) => FontReadError::InvalidProjection {
            details: error.to_string(),
        },
    }
}

/// Compiles one deterministic root batch directly from retained glyf/gvar semantics.
pub fn build_binary_atlas_page(
    source: &OpenTypeFont,
    roots: &[GlyphIndex],
    band_count: u32,
) -> Result<SourceAtlasPage, SourceAtlasError> {
    validate_roots(source.directory(), roots)?;
    let (font, variable_tables) =
        tables::variable_tables(source).map_err(SourceAtlasError::from)?;
    let Some((loca, glyf, gvar)) = variable_tables else {
        return build_static_cff_atlas_page(source, &font, roots, band_count);
    };
    let axes = atlas_axes(source)?;
    let mut registry = RegionRegistry::default();
    let curves = roots
        .iter()
        .map(|root| {
            geometry::resolve_variable_curves(
                &source.path,
                loca.clone(),
                glyf.clone(),
                gvar.clone(),
                &mut registry,
                *root,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let advances = metrics::advance_contributions(
        &source.path,
        &font,
        loca,
        glyf,
        gvar,
        &mut registry,
        roots,
    )?;
    let mut compiler = PageCompiler::new(band_count, axes, registry.into_regions())?;
    for ((root, mut curves), advance) in roots.iter().zip(curves).zip(advances) {
        let mut source_weights = curves
            .sources
            .keys()
            .chain(advance.deltas.keys())
            .copied()
            .collect::<Vec<_>>();
        source_weights.sort_unstable();
        source_weights.dedup();
        let sources = source_weights
            .into_iter()
            .map(|weight| {
                let source_curves = curves
                    .sources
                    .remove(&weight)
                    .unwrap_or_else(|| curves.base.clone());
                let source_advance =
                    advance.base + advance.deltas.get(&weight).copied().unwrap_or(0.0);
                (weight, source_curves, source_advance)
            })
            .collect();
        compiler.add_glyph(
            root.to_u32(),
            curves.base,
            curves.line_flags,
            advance.base,
            sources,
        )?;
    }
    Ok(compiler.finish())
}

fn build_static_cff_atlas_page(
    source: &OpenTypeFont,
    font: &FontRef<'_>,
    roots: &[GlyphIndex],
    band_count: u32,
) -> Result<SourceAtlasPage, SourceAtlasError> {
    validate_static_cff(source, font).map_err(SourceAtlasError::from)?;

    let mut compiler = PageCompiler::new(band_count, Vec::new(), Vec::new())?;
    for root in roots {
        let (pen, advance) = draw_static_cff_glyph(source, font, *root)?;
        let curves = pen.curves()?;
        compiler.add_glyph(
            root.to_u32(),
            curves.base,
            curves.line_flags,
            advance,
            Vec::new(),
        )?;
    }
    Ok(compiler.finish())
}

fn atlas_axes(source: &OpenTypeFont) -> Result<Vec<AtlasAxis>, SourceAtlasError> {
    source
        .directory
        .axes
        .iter()
        .map(|axis| {
            let VariationAxisKind::Continuous {
                minimum,
                default,
                maximum,
            } = &axis.kind
            else {
                return Err(SourceAtlasError::UnsupportedBinary {
                    details: "binary variation axes must be continuous",
                });
            };
            let normalized_mapping = source
                .directory
                .axis_mappings
                .iter()
                .find(|mapping| mapping.axis == axis.index)
                .map(|mapping| {
                    mapping
                        .points
                        .iter()
                        .map(|(input, output)| {
                            (
                                normalize_user_coordinate(*input, *minimum, *default, *maximum),
                                normalize_user_coordinate(*output, *minimum, *default, *maximum),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(AtlasAxis::new(
                Vec::new(),
                *minimum,
                *default,
                *maximum,
                normalized_mapping,
            ))
        })
        .collect()
}

fn normalize_user_coordinate(value: f64, minimum: f64, default: f64, maximum: f64) -> i16 {
    let normalized = if value == default {
        0.0
    } else if value < default {
        if default == minimum {
            0.0
        } else {
            (value - default) / (default - minimum)
        }
    } else if maximum == default {
        0.0
    } else {
        (value - default) / (maximum - default)
    };
    F2Dot14::from_f32(normalized as f32).to_bits()
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
    use skrifa::{FontRef, GlyphId, MetadataProvider};

    use super::{build_binary_atlas_page, OpenTypeFont};
    use crate::font_source::{FontSource, GlyphIndex, VariationAxisKind, VariationCoordinate};

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
            OpenTypeFont::open(&repository_root().join(
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
        let composite = source.glyph(roots[1]).unwrap();
        assert!(!composite.root.fallback.components.is_empty());
        assert!(composite
            .root
            .fallback
            .components
            .iter()
            .all(|component| composite
                .components
                .iter()
                .any(|projection| projection.glyph == component.glyph)));
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
            let weights = page.weights(location.coordinates()).unwrap();
            for (glyph, atlas_glyph) in page.glyphs() {
                let actual = page
                    .atlas()
                    .resolve_glyph_with_weights(*atlas_glyph, &weights)
                    .unwrap();
                let expected = skrifa_curves(&source, GlyphIndex::new(*glyph), location);
                assert_curves_close(&actual, &expected);
                let actual_advance = page
                    .atlas()
                    .resolve_advance_with_weights(*atlas_glyph, &weights)
                    .unwrap();
                let font = FontRef::new(source.bytes().as_ref()).unwrap();
                let raw_glyph = GlyphId::new(*glyph);
                let expected_advance = font
                    .glyph_metrics(
                        Size::unscaled(),
                        LocationRef::from(&skrifa_location(&font, &source, location)),
                    )
                    .advance_width(raw_glyph)
                    .unwrap();
                assert!((actual_advance - expected_advance).abs() < 0.001);
            }
        }
    }

    #[test]
    fn rotated_skewed_composite_matches_skrifa() {
        let source = OpenTypeFont::open(&fixture("RotatedSkewedComposite.ttf")).unwrap();
        let root = source.directory().glyphs[34].index;
        let page = build_binary_atlas_page(&source, &[root], DEFAULT_BAND_COUNT).unwrap();
        let preview_extents = page.preview_extents().unwrap();
        assert!(preview_extents.maximum_y > preview_extents.minimum_y);
        let weights = page
            .weights(source.directory().default_location().coordinates())
            .unwrap();
        let actual = page
            .atlas()
            .resolve_glyph_with_weights(page.glyphs()[0].1, &weights)
            .unwrap();

        assert_curves_close(
            &actual,
            &skrifa_curves(&source, root, source.directory().default_location()),
        );
    }

    #[test]
    fn binary_projection_retains_avar_mappings_and_empty_glyphs() {
        let source =
            OpenTypeFont::open(&repository_root().join(
                "apps/desktop/src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf",
            ))
            .unwrap();
        assert_eq!(
            source.directory().axis_mappings.len(),
            source.directory().axes.len()
        );
        assert!(source
            .directory()
            .axis_mappings
            .iter()
            .all(|mapping| !mapping.points.is_empty()));

        let space = source
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "space")
            .unwrap();
        let projection = source.glyph(space.index).unwrap();
        assert!(projection.root.fallback.contours.is_empty());
        assert!(projection.root.fallback.components.is_empty());
        assert!(projection.root.fallback.values[0] > 0.0);
    }

    #[test]
    fn direct_pages_cover_every_host_grotesk_glyph() {
        let source =
            OpenTypeFont::open(&repository_root().join(
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
            let weights = page.weights(location.coordinates()).unwrap();
            for (glyph, atlas_glyph) in page.glyphs() {
                let actual = page
                    .atlas()
                    .resolve_glyph_with_weights(*atlas_glyph, &weights)
                    .unwrap();
                assert_curves_close(
                    &actual,
                    &skrifa_curves(&source, GlyphIndex::new(*glyph), location),
                );
            }
        }
    }

    #[test]
    fn direct_page_matches_a_uniform_host_grotesk_sample() {
        let source =
            OpenTypeFont::open(&repository_root().join(
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
        let weights = page.weights(location.coordinates()).unwrap();

        for (glyph, atlas_glyph) in page.glyphs() {
            let actual = page
                .atlas()
                .resolve_glyph_with_weights(*atlas_glyph, &weights)
                .unwrap();
            assert_curves_close(
                &actual,
                &skrifa_curves(&source, GlyphIndex::new(*glyph), &location),
            );
        }
    }

    #[test]
    fn static_cff_projection_and_page_match_skrifa() {
        let source = OpenTypeFont::open(&fixture("MutatorSans.otf")).unwrap();
        let root = source.directory().glyphs[0].index;
        let projected = source.glyph(root).unwrap();
        assert_eq!(projected.root.glyph, root);
        assert!(projected.components.is_empty());

        let page = build_binary_atlas_page(&source, &[root], DEFAULT_BAND_COUNT).unwrap();
        let weights = page
            .weights(source.directory().default_location().coordinates())
            .unwrap();
        let actual = page
            .atlas()
            .resolve_glyph_with_weights(page.glyphs()[0].1, &weights)
            .unwrap();
        assert_curves_close(
            &actual,
            &skrifa_curves(&source, root, source.directory().default_location()),
        );
    }

    fn skrifa_curves(
        source: &OpenTypeFont,
        glyph: crate::font_source::GlyphIndex,
        location: &crate::font_source::VariationLocation,
    ) -> Vec<Curve> {
        let font = FontRef::new(source.bytes().as_ref()).unwrap();
        let location = skrifa_location(&font, source, location);
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

    fn skrifa_location(
        font: &FontRef<'_>,
        source: &OpenTypeFont,
        location: &crate::font_source::VariationLocation,
    ) -> skrifa::instance::Location {
        font.axes().location(
            source
                .directory()
                .axes
                .iter()
                .zip(location.coordinates())
                .map(|(axis, value)| (axis.tag.as_str(), *value as f32)),
        )
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
