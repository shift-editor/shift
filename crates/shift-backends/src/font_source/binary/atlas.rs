use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use shift_slug::VariableAtlasBuilder;
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::tables::gvar::GlyphDelta;
use skrifa::raw::tables::variations::TupleVariation;
use skrifa::raw::types::GlyphId;
use skrifa::raw::types::MajorMinor;
use skrifa::raw::{ReadError, TableProvider};
use skrifa::{FontRef, MetadataProvider};

use crate::font_source::atlas::{
    AtlasAxis, AtlasRegion, RegionAxis, RegionRegistry, SourceAtlasError, SourceAtlasPage,
};
use crate::font_source::{
    inferred_smooth_point_indices, FontReadError, FontSource, GlyphComponent,
    GlyphDelta as ProjectedDelta, GlyphIndex, GlyphPointKind, GlyphProjection, GlyphShape,
    GlyphShapeContour, GlyphShapePoint, GlyphVariation, PointProvenance, ProjectedGlyph,
    VariationAxisKind, VariationRegion, VariationSupport,
};

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

/// Compiles one selected glyph and its component closure directly from glyf/gvar semantics.
pub(super) fn project_binary_glyph(
    source: &BinaryFont,
    root: GlyphIndex,
) -> Result<ProjectedGlyph, FontReadError> {
    validate_roots(source, &[root]).map_err(source_atlas_read_error)?;
    let font = FontRef::new(source.bytes().as_ref()).map_err(|error| {
        malformed(
            &source.path,
            format!("failed to reopen retained font: {error}"),
        )
    })?;
    reject_unsupported_binary_tables(source, &font)?;
    let loca = match font.loca(None) {
        Ok(loca) => loca,
        Err(ReadError::TableIsMissing(_)) => return project_static_cff_glyph(source, &font, root),
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read loca table: {error}"),
            ))
        }
    };
    let glyf = font.glyf().map_err(|error| match error {
        ReadError::TableIsMissing(_) => FontReadError::UnsupportedProjection {
            details: "location-independent selected glyphs require glyf outlines",
        },
        error => malformed(&source.path, format!("failed to read glyf table: {error}")),
    })?;
    let gvar = match font.gvar() {
        Ok(gvar) => Some(gvar),
        Err(ReadError::TableIsMissing(_)) => None,
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read gvar table: {error}"),
            ))
        }
    };
    // Validate avar support now; projection supports are post-mapping coordinates.
    atlas_axes(source, &font).map_err(source_atlas_read_error)?;
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
    let mut pending = Vec::with_capacity(glyphs.len());
    for glyph in glyphs {
        let (advance, advance_deltas) = metrics::advance_contributions(
            &source.path,
            &font,
            loca.clone(),
            glyf.clone(),
            gvar.clone(),
            &mut registry,
            glyph.glyph,
        )
        .map_err(source_atlas_read_error)?;
        pending.push((glyph, f64::from(advance), advance_deltas));
    }
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

fn reject_unsupported_binary_tables(
    source: &BinaryFont,
    font: &FontRef<'_>,
) -> Result<(), FontReadError> {
    match font.cff2() {
        Ok(_) => {
            return Err(FontReadError::UnsupportedProjection {
                details: "CFF2 projection is not supported",
            })
        }
        Err(ReadError::TableIsMissing(_)) => {}
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read CFF2 table: {error}"),
            ))
        }
    }
    match font.varc() {
        Ok(_) => {
            return Err(FontReadError::UnsupportedProjection {
                details: "VARC projection is not supported",
            })
        }
        Err(ReadError::TableIsMissing(_)) => {}
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read VARC table: {error}"),
            ))
        }
    }
    match font.avar() {
        Ok(avar) if avar.version() != MajorMinor::VERSION_1_0 => {
            Err(FontReadError::UnsupportedProjection {
                details: "avar version 2 projection is not supported",
            })
        }
        Ok(_) | Err(ReadError::TableIsMissing(_)) => Ok(()),
        Err(error) => Err(malformed(
            &source.path,
            format!("failed to read avar table: {error}"),
        )),
    }
}

fn project_static_cff_glyph(
    source: &BinaryFont,
    font: &FontRef<'_>,
    glyph: GlyphIndex,
) -> Result<ProjectedGlyph, FontReadError> {
    if !source.directory.axes.is_empty() {
        return Err(FontReadError::UnsupportedProjection {
            details: "variable CFF projection is not supported",
        });
    }
    match font.cff() {
        Ok(_) => {}
        Err(ReadError::TableIsMissing(_)) => {
            return Err(FontReadError::UnsupportedProjection {
                details: "binary font has neither glyf nor CFF outlines",
            })
        }
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read CFF table: {error}"),
            ))
        }
    }

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
    source: &BinaryFont,
    roots: &[GlyphIndex],
    band_count: u32,
) -> Result<SourceAtlasPage, SourceAtlasError> {
    validate_roots(source, roots)?;
    let font = FontRef::new(source.bytes().as_ref()).map_err(|error| {
        malformed(
            &source.path,
            format!("failed to reopen retained font: {error}"),
        )
    })?;
    reject_unsupported_binary_tables(source, &font).map_err(SourceAtlasError::from)?;
    let loca = match font.loca(None) {
        Ok(loca) => loca,
        Err(ReadError::TableIsMissing(_)) => {
            return build_static_cff_atlas_page(source, &font, roots, band_count)
        }
        Err(error) => {
            return Err(
                malformed(&source.path, format!("failed to read loca table: {error}")).into(),
            )
        }
    };
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
        Vec::new(),
        axes,
        registry.into_regions(),
        complements,
    ))
}

fn build_static_cff_atlas_page(
    source: &BinaryFont,
    font: &FontRef<'_>,
    roots: &[GlyphIndex],
    band_count: u32,
) -> Result<SourceAtlasPage, SourceAtlasError> {
    if !source.directory.axes.is_empty() {
        return Err(SourceAtlasError::UnsupportedBinary {
            details: "variable CFF atlas projection is not supported",
        });
    }
    match font.cff() {
        Ok(_) => {}
        Err(ReadError::TableIsMissing(_)) => {
            return Err(SourceAtlasError::UnsupportedBinary {
                details: "binary font has neither glyf nor CFF outlines",
            })
        }
        Err(error) => {
            return Err(
                malformed(&source.path, format!("failed to read CFF table: {error}")).into(),
            )
        }
    }

    let glyph_metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
    let mut builder = VariableAtlasBuilder::new(band_count)?;
    let mut glyphs = Vec::with_capacity(roots.len());
    for root in roots {
        let raw_glyph = GlyphId::new(root.to_u32());
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
        let curves = pen.curves()?;
        let atlas_glyph = builder.add_curve_glyph_with_sources_and_lines(
            curves.base,
            curves.line_flags,
            0,
            std::iter::empty(),
        )?;
        let advance = glyph_metrics.advance_width(raw_glyph).ok_or_else(|| {
            malformed(
                &source.path,
                format!("missing advance width for glyph {raw_glyph}"),
            )
        })?;
        builder.set_glyph_source_advances(atlas_glyph, std::iter::once(advance))?;
        glyphs.push((*root, atlas_glyph));
    }

    Ok(SourceAtlasPage::new(
        builder.finish(),
        glyphs,
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
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
            return Err(crate::font_source::FontReadError::InvalidProjection {
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
    source
        .directory
        .axes
        .iter()
        .cloned()
        .zip(mappings)
        .map(|(axis, mapping)| {
            let VariationAxisKind::Continuous {
                minimum,
                default,
                maximum,
            } = axis.kind
            else {
                return Err(SourceAtlasError::UnsupportedBinary {
                    details: "binary variation axes must be continuous",
                });
            };
            Ok(AtlasAxis::new(
                axis,
                Vec::new(),
                minimum,
                default,
                maximum,
                mapping,
            ))
        })
        .collect()
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

    use super::{build_binary_atlas_page, BinaryFont};
    use crate::font_source::{FontSource, VariationAxisKind, VariationCoordinate};

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
                let font = FontRef::new(source.bytes().as_ref()).unwrap();
                let raw_glyph = GlyphId::new(glyph.to_u32());
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
    fn binary_projection_retains_avar_mappings_and_empty_glyphs() {
        let source =
            BinaryFont::open(&repository_root().join(
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
    fn static_cff_projection_and_page_match_skrifa() {
        let source = BinaryFont::open(&fixture("MutatorSans.otf")).unwrap();
        let root = source.directory().glyphs[0].index;
        let projected = source.glyph(root).unwrap();
        assert_eq!(projected.root.glyph, root);
        assert!(projected.components.is_empty());

        let page = build_binary_atlas_page(&source, &[root], DEFAULT_BAND_COUNT).unwrap();
        let weights = page.weights(source.directory().default_location()).unwrap();
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
        source: &BinaryFont,
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
        source: &BinaryFont,
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
