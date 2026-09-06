use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::{parse, BridgeParse};
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{
  build_binary_atlas_page, font_loader::FontLoader, variable_glyph_inputs,
  AxisIndex as SourceAxisIndex, ExportFormat, FontDirectory, FontExportRequest, FontExportResult,
  FontExporter, FontSource, FontView, GlyphIndex, GlyphPointKind as SourceGlyphPointKind,
  GlyphProjection as SourceGlyphProjection, GlyphShape as SourceGlyphShape, OpenedFont,
  ProjectedGlyph as SourceProjectedGlyph, SourceAtlasDescriptor, VariationAxisKind,
};
use shift_font::composite::resolved_contours_to_svg_path;
use shift_font::{
  AnchorId, AnchorSeed, Axis as FontAxis, AxisId, AxisLabel, AxisLabelId, AxisLabelRange,
  AxisMapping as FontAxisMapping, AxisMappingId, AxisMappingPoint as FontAxisMappingPoint,
  AxisRole, BooleanOp, ComponentId, ContourId, Font, FontChange, FontIntent, FontIntentSet,
  FontMetadata as FontMetadataModel, Glyph, GlyphId, LayerId, Location as FontLocation,
  MetricDefinition as FontMetricDefinition, MetricId, MetricKind, MetricValue,
  NamedInstance as FontNamedInstance, NamedInstanceId, PointId, PointSeed, SourceId,
};
use shift_slug::{
  build_authored_atlas_page_profiled, build_authored_atlas_profiled,
  retained::compile_page as compile_retained_page, AuthoredAtlas, AuthoredAtlasProfile,
  Section as SlugSection, VariableAtlas, VariableLayout,
};
use shift_wire::{
  bridges::napi::{
    NapiAnchorSeed, NapiAppliedChange, NapiAxis, NapiAxisMapping, NapiAxisMappingBasis,
    NapiAxisRole, NapiAxisType, NapiCatalogAtlasGlyph, NapiCatalogAtlasPage,
    NapiCatalogAtlasWeights, NapiFontIntent, NapiFontMetadata, NapiFontMetrics,
    NapiFontReplacement, NapiFontSnapshot, NapiGlyphPreview, NapiGlyphProjection, NapiGlyphRecord,
    NapiGlyphSnapshot, NapiGlyphSnapshotRequest, NapiInterpolationBasis, NapiLayerReplaced,
    NapiLocation, NapiMetricDefinition, NapiMetricKind, NapiNamedInstance, NapiPointSeed,
    NapiSlugAtlas, NapiSlugExactSource, NapiSlugGlyph, NapiSlugLayout, NapiSlugPreviewExtents,
    NapiSlugSection, NapiSlugWeightSet, NapiSource, NapiSourceMetricsInterpolationReplacement,
    NapiSourceMetricsInterpolationSnapshot,
  },
  AnchorData, Axis, AxisMapping, AxisMappingBasis, ComponentData, ComponentGlyph,
  ComponentTransformKind, ContourData, FontMetadata, FontMetrics, FontSnapshot,
  GlyphChangedEntities, GlyphComponents, GlyphEntry, GlyphLayerShape, GlyphLayerSnapshot,
  GlyphProjection, GlyphRecord, GlyphSnapshot, GlyphSnapshotRequest, GlyphSourceComponents,
  GlyphSourceShape, GlyphState, GlyphStructure, GlyphVariation,
  InterpolationBasis as WireInterpolationBasis, InterpolationSupport, Location as WireLocation,
  MetricDefinition, MetricKind as WireMetricKind, NamedInstance, PointData, PointType, Source,
  SourceMetricValue, SourceMetricsInterpolationSnapshot, VariationBasis, VariationDelta,
};
use shift_workspace::{
  AcquireScope, DocumentIdentity, FontWorkspace, LedgerEntryId, NewWorkspace, WorkspaceError,
  WorkspaceSource,
};
use std::{
  collections::{BTreeMap, HashMap, HashSet, VecDeque},
  path::Path,
  sync::Arc,
  time::{Duration, Instant},
};

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NapiFontExportRequest {
  pub path: String,
  pub format: String,
}

#[napi(object)]
pub struct NapiFontExportResult {
  pub path: String,
  pub format: String,
}

#[napi(object)]
pub struct NapiNewWorkspace {
  pub family_name: Option<String>,
  pub units_per_em: Option<i64>,
}

#[napi(object)]
#[derive(Debug)]
pub struct NapiDocumentState {
  pub source_kind: String,
  pub document_id: Option<String>,
  pub save_target: Option<String>,
  pub dirty: bool,
  pub needs_save_as: bool,
}

#[napi(object)]
pub struct NapiDocumentIdentity {
  pub document_id: String,
  pub canonical_path: String,
}

struct SlugAtlasGeneration {
  generation: u32,
  alignment: usize,
  atlas: VariableAtlas,
}

fn new_workspace_from_options(options: Option<NapiNewWorkspace>) -> NewWorkspace {
  let Some(options) = options else {
    return NewWorkspace::default();
  };

  let mut new_workspace = NewWorkspace::default();
  if let Some(family_name) = options.family_name {
    new_workspace.family_name = family_name;
  }
  if let Some(units_per_em) = options.units_per_em {
    new_workspace.units_per_em = units_per_em;
  }

  new_workspace
}

impl TryFrom<NapiFontExportRequest> for FontExportRequest {
  type Error = Error;

  fn try_from(request: NapiFontExportRequest) -> Result<Self> {
    let format = ExportFormat::try_from(request.format.as_str())
      .map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;

    Ok(Self {
      path: request.path.into(),
      format,
    })
  }
}

impl From<FontExportResult> for NapiFontExportResult {
  fn from(result: FontExportResult) -> Self {
    Self {
      path: result.path.to_string_lossy().into_owned(),
      format: result.format.as_str().to_string(),
    }
  }
}

impl TryFrom<DocumentIdentity> for NapiDocumentIdentity {
  type Error = BridgeError;

  fn try_from(identity: DocumentIdentity) -> BridgeResult<Self> {
    Ok(Self {
      document_id: identity.document_id.to_string(),
      canonical_path: path_to_string(&identity.canonical_path)?,
    })
  }
}

fn napi_slug_section(section: SlugSection) -> BridgeResult<NapiSlugSection> {
  Ok(NapiSlugSection {
    offset: u32::try_from(section.offset).map_err(|_| shift_slug::SlugError::LengthOverflow)?,
    length: u32::try_from(section.length).map_err(|_| shift_slug::SlugError::LengthOverflow)?,
  })
}

fn napi_slug_layout(layout: VariableLayout) -> BridgeResult<NapiSlugLayout> {
  Ok(NapiSlugLayout {
    base_curves: napi_slug_section(layout.base_curves)?,
    curve_deltas: napi_slug_section(layout.curve_deltas)?,
    sparse_deltas: napi_slug_section(layout.sparse_deltas)?,
    glyphs: napi_slug_section(layout.glyphs)?,
    sources: napi_slug_section(layout.sources)?,
    source_advances: napi_slug_section(layout.source_advances)?,
    component_glyphs: napi_slug_section(layout.component_glyphs)?,
    component_parts: napi_slug_section(layout.component_parts)?,
    components: napi_slug_section(layout.components)?,
    component_sources: napi_slug_section(layout.component_sources)?,
    anchor_sources: napi_slug_section(layout.anchor_sources)?,
    line_bits: napi_slug_section(layout.line_bits)?,
    total_length: u32::try_from(layout.total_length)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
  })
}

fn slug_atlas_profile_enabled() -> bool {
  std::env::var("SHIFT_PROFILE_SLUG_ATLAS").is_ok_and(|value| value != "0")
}

fn milliseconds(duration: Duration) -> f64 {
  duration.as_secs_f64() * 1_000.0
}

fn log_slug_atlas_profile(
  scope: &str,
  acquisition: Duration,
  profile: AuthoredAtlasProfile,
  layout: Duration,
  total: Duration,
) {
  if !slug_atlas_profile_enabled() {
    return;
  }

  eprintln!(
    "[slug-atlas] scope={scope} acquisition_ms={:.3} projection_preparation_ms={:.3} weight_set_collection_ms={:.3} component_preparation_ms={:.3} fallback_bounds_ms={:.3} exact_source_preparation_ms={:.3} atlas_addition_ms={:.3} layout_ms={:.3} total_ms={:.3}",
    milliseconds(acquisition),
    milliseconds(profile.projection_preparation),
    milliseconds(profile.weight_set_collection),
    milliseconds(profile.component_preparation),
    milliseconds(profile.fallback_bounds),
    milliseconds(profile.exact_source_preparation),
    milliseconds(profile.atlas_addition),
    milliseconds(layout),
    milliseconds(total),
  );
}

fn wire_font_snapshot(
  source: &dyn FontSource,
  identity: &SourceIdentity,
) -> BridgeResult<FontSnapshot> {
  let directory = source.directory();
  let metadata = FontMetadata {
    family_name: directory.family_name().map(str::to_string),
    style_name: directory.style_name().map(str::to_string),
    version_major: None,
    version_minor: None,
    copyright: None,
    trademark: None,
    designer: None,
    designer_url: None,
    manufacturer: None,
    manufacturer_url: None,
    license: None,
    license_url: None,
    description: None,
    note: None,
  };
  let metric_rows = |metrics: &shift_backends::FontMetrics| {
    [
      (WireMetricKind::Ascender, "Ascender", metrics.ascender),
      (
        WireMetricKind::CapHeight,
        "Cap Height",
        metrics.cap_height.unwrap_or(metrics.units_per_em * 0.7),
      ),
      (
        WireMetricKind::XHeight,
        "x-Height",
        metrics.x_height.unwrap_or(metrics.units_per_em * 0.5),
      ),
      (WireMetricKind::Baseline, "Baseline", 0.0),
      (WireMetricKind::Descender, "Descender", metrics.descender),
    ]
  };
  let default_metric_rows = metric_rows(&directory.metrics());
  let metric_definitions = default_metric_rows
    .iter()
    .zip(identity.metric_ids.iter())
    .map(|((kind, name, _), id)| MetricDefinition {
      id: id.clone(),
      kind: *kind,
      name: (*name).into(),
    })
    .collect::<Vec<_>>();
  let font_axes = identity.font_axes.to_vec();
  let axes = font_axes.iter().map(Axis::from).collect::<Vec<_>>();
  let sources = directory
    .sources()
    .iter()
    .zip(identity.source_ids.iter())
    .map(|(source, id)| {
      let values = identity
        .axis_ids
        .iter()
        .cloned()
        .zip(source.location.iter().copied())
        .collect::<HashMap<_, _>>();
      Source {
        id: id.clone(),
        name: source.name.clone(),
        location: WireLocation { values },
        filename: source.filename.clone(),
        metric_values: metric_rows(&source.metrics)
          .iter()
          .zip(identity.metric_ids.iter())
          .map(|((_, _, position), metric_id)| SourceMetricValue {
            metric_id: metric_id.clone(),
            position: *position,
            overshoot: 0.0,
          })
          .collect(),
        italic_angle: source.metrics.italic_angle,
        line_gap: Some(source.metrics.line_gap),
        underline_position: source.metrics.underline_position,
        underline_thickness: source.metrics.underline_thickness,
      }
    })
    .collect::<Vec<_>>();
  let font_axis_mappings = source_axis_mappings(directory, identity)?;
  let axis_mappings = font_axis_mappings
    .iter()
    .map(AxisMapping::from)
    .collect::<Vec<_>>();
  let axis_mapping_bases = identity
    .mapping_bases
    .iter()
    .map(AxisMappingBasis::from)
    .collect();
  let named_instances = directory
    .instances()
    .iter()
    .zip(identity.instance_ids.iter())
    .map(|(instance, id)| NamedInstance {
      id: id.clone(),
      name: instance.name.clone(),
      location: WireLocation {
        values: identity
          .axis_ids
          .iter()
          .cloned()
          .zip(instance.location.iter().copied())
          .collect(),
      },
      postscript_name: instance.postscript_name.clone(),
    })
    .collect();
  Ok(FontSnapshot {
    metadata,
    metrics: FontMetrics {
      units_per_em: directory.metrics().units_per_em,
    },
    metric_definitions,
    source_metrics_interpolation: None,
    glyphs: directory
      .glyphs()
      .iter()
      .zip(identity.glyph_ids.iter())
      .map(|(glyph, id)| GlyphEntry {
        id: id.clone(),
        name: glyph.name.clone().into(),
        unicodes: glyph.unicodes.to_vec(),
      })
      .collect(),
    sources,
    axes,
    axis_mappings,
    axis_mapping_bases,
    named_instances,
  })
}

fn source_font_axes(directory: &FontDirectory, identity: &SourceIdentity) -> Vec<FontAxis> {
  directory
    .axes()
    .iter()
    .zip(identity.axis_ids.iter())
    .map(|(axis, id)| {
      let mut mapped = match &axis.kind {
        VariationAxisKind::Continuous {
          minimum,
          default,
          maximum,
        } => FontAxis::continuous_with_id(
          id.clone(),
          axis.tag.clone(),
          axis.name.clone(),
          *minimum,
          *default,
          *maximum,
        ),
        VariationAxisKind::Discrete { values, default } => FontAxis::discrete_with_id(
          id.clone(),
          axis.tag.clone(),
          axis.name.clone(),
          values.to_vec(),
          *default,
        ),
      };
      mapped.set_hidden(axis.hidden);
      mapped
    })
    .collect()
}

fn source_axis_mappings(
  directory: &FontDirectory,
  identity: &SourceIdentity,
) -> BridgeResult<Vec<FontAxisMapping>> {
  directory
    .mappings()
    .iter()
    .zip(identity.mapping_ids.iter())
    .map(|(mapping, mapping_id)| {
      let input_axis_ids = mapping
        .input_axes
        .iter()
        .map(|axis| source_axis_id(identity, *axis))
        .collect::<BridgeResult<Vec<_>>>()?;
      let output_axis_ids = mapping
        .output_axes
        .iter()
        .map(|axis| source_axis_id(identity, *axis))
        .collect::<BridgeResult<Vec<_>>>()?;
      let points = mapping
        .points
        .iter()
        .map(|point| FontAxisMappingPoint {
          description: point.description.clone(),
          input: FontLocation::from_map(
            input_axis_ids
              .iter()
              .cloned()
              .zip(point.input.iter().copied())
              .collect(),
          ),
          output: FontLocation::from_map(
            output_axis_ids
              .iter()
              .cloned()
              .zip(point.output.iter().copied())
              .collect(),
          ),
        })
        .collect();
      let mut mapped = FontAxisMapping::with_id(
        mapping_id.clone(),
        mapping.name.clone(),
        input_axis_ids,
        output_axis_ids,
        points,
      );
      mapped.set_description(mapping.description.clone());
      Ok(mapped)
    })
    .collect()
}

fn source_axis_id(identity: &SourceIdentity, axis: SourceAxisIndex) -> BridgeResult<AxisId> {
  identity
    .axis_ids
    .get(axis.to_usize())
    .cloned()
    .ok_or_else(|| BridgeError::InvalidInput {
      kind: "source axis mapping",
      value: axis.to_u32().to_string(),
    })
}

fn source_location(
  directory: &FontDirectory,
  identity: &SourceIdentity,
  coordinates: Vec<f64>,
) -> BridgeResult<Vec<f64>> {
  if coordinates.len() != directory.axes().len() {
    return Err(BridgeError::InvalidInput {
      kind: "catalog location coordinate count",
      value: coordinates.len().to_string(),
    });
  }

  let external = shift_font::ExternalLocation::from_map(
    identity.axis_ids.iter().cloned().zip(coordinates).collect(),
  );
  let design = shift_font::ir::variation::map_location_with_bases(
    &external,
    &identity.font_axes,
    &identity.mapping_bases,
  )?;
  Ok(
    identity
      .font_axes
      .iter()
      .map(|axis| design.get(&axis.id()).unwrap_or(axis.default()))
      .collect(),
  )
}

fn wire_source_glyph(
  projected: SourceProjectedGlyph,
  directory: &FontDirectory,
  identity: &SourceIdentity,
) -> BridgeResult<Vec<GlyphSnapshot>> {
  let mut projections = Vec::with_capacity(projected.components.len() + 1);
  projections.push(projected.root);
  projections.extend(projected.components);
  let by_index = projections
    .iter()
    .map(|projection| (projection.glyph, projection))
    .collect::<HashMap<_, _>>();
  let component_glyph_ids = projections
    .iter()
    .skip(1)
    .map(|projection| identity.glyph_id(projection.glyph))
    .collect::<BridgeResult<Vec<_>>>()?;
  let exact_sources = projections
    .iter()
    .flat_map(|projection| projection.exact_shapes.iter().map(|shape| shape.source))
    .collect::<HashSet<_>>();

  projections
    .iter()
    .map(|projection| {
      let glyph_id = identity.glyph_id(projection.glyph)?;
      let fallback = wire_source_shape(
        &projection.fallback,
        projection.glyph,
        "fallback",
        directory,
        identity,
      )?;
      let variation = projection
        .variation
        .as_ref()
        .map(|variation| {
          let deltas = variation
            .deltas
            .iter()
            .map(|delta| {
              let region = delta
                .region
                .supports
                .iter()
                .map(|support| {
                  let axis_id = identity
                    .axis_ids
                    .get(support.axis.to_usize())
                    .cloned()
                    .ok_or_else(|| BridgeError::InvalidInput {
                      kind: "source projection axis",
                      value: support.axis.to_u32().to_string(),
                    })?;
                  Ok(InterpolationSupport {
                    axis_id,
                    lower: support.lower,
                    peak: support.peak,
                    upper: support.upper,
                  })
                })
                .collect::<BridgeResult<Vec<_>>>()?;
              Ok(VariationDelta {
                region,
                values: delta.values.to_vec(),
              })
            })
            .collect::<BridgeResult<Vec<_>>>()?;
          Ok::<_, BridgeError>(GlyphVariation {
            basis: VariationBasis { deltas },
          })
        })
        .transpose()?;
      let exact_source_shapes = projection
        .exact_shapes
        .iter()
        .map(|exact| {
          let source_id = identity
            .source_ids
            .get(exact.source.to_usize())
            .cloned()
            .ok_or_else(|| BridgeError::InvalidInput {
              kind: "source projection exact source",
              value: exact.source.to_u32().to_string(),
            })?;
          Ok(GlyphSourceShape {
            source_id,
            shape: wire_source_shape(
              &exact.shape,
              projection.glyph,
              &format!("source{}", exact.source.to_u32()),
              directory,
              identity,
            )?,
          })
        })
        .collect::<BridgeResult<Vec<_>>>()?;
      let components = wire_source_components(projection.glyph, None, &by_index, identity)?;
      let exact_source_components = exact_sources
        .iter()
        .map(|source| {
          let source_id = identity
            .source_ids
            .get(source.to_usize())
            .cloned()
            .ok_or_else(|| BridgeError::InvalidInput {
              kind: "source projection exact components",
              value: source.to_u32().to_string(),
            })?;
          Ok(GlyphSourceComponents {
            source_id,
            components: wire_source_components(
              projection.glyph,
              Some(*source),
              &by_index,
              identity,
            )?,
          })
        })
        .collect::<BridgeResult<Vec<_>>>()?;
      Ok(GlyphSnapshot {
        glyph_id: glyph_id.clone(),
        projection: Some(GlyphProjection {
          glyph_id,
          fallback,
          interpolation: None,
          variation,
          exact_source_shapes,
          components,
          exact_source_components,
          component_glyph_ids: component_glyph_ids.clone(),
        }),
        layers: Vec::new(),
      })
    })
    .collect()
}

fn wire_source_shape(
  shape: &SourceGlyphShape,
  glyph: GlyphIndex,
  selector: &str,
  directory: &FontDirectory,
  identity: &SourceIdentity,
) -> BridgeResult<GlyphLayerShape> {
  let glyph_id = identity.glyph_id(glyph)?;
  let mut point_index = 0_usize;
  let contours = shape
    .contours
    .iter()
    .enumerate()
    .map(|(contour_index, contour)| {
      let contour_id = ContourId::from_raw(format!("{glyph_id}-{selector}-c{contour_index}"));
      let points = contour
        .points
        .iter()
        .map(|point| {
          let id = PointId::from_raw(format!("{glyph_id}-{selector}-p{point_index}"));
          point_index += 1;
          PointData {
            id: id.to_string(),
            point_type: match point.kind {
              SourceGlyphPointKind::OnCurve => PointType::OnCurve,
              SourceGlyphPointKind::QuadraticControl | SourceGlyphPointKind::CubicControl => {
                PointType::OffCurve
              }
            },
            smooth: point.smooth,
          }
        })
        .collect();
      ContourData {
        id: contour_id.to_string(),
        closed: contour.closed,
        points,
      }
    })
    .collect();
  let anchors = shape
    .anchors
    .iter()
    .enumerate()
    .map(|(index, name)| AnchorData {
      id: AnchorId::from_raw(format!("{glyph_id}-{selector}-a{index}")).to_string(),
      name: name.clone(),
    })
    .collect();
  let components = shape
    .components
    .iter()
    .enumerate()
    .map(|(index, component)| {
      let base_glyph_id = identity.glyph_id(component.glyph)?;
      let base_glyph_name = directory
        .glyphs()
        .get(component.glyph.to_usize())
        .ok_or_else(|| BridgeError::InvalidInput {
          kind: "source component glyph",
          value: component.glyph.to_u32().to_string(),
        })?
        .name
        .clone()
        .into();
      Ok(ComponentData {
        id: ComponentId::from_raw(format!("{glyph_id}-{selector}-m{index}")).to_string(),
        base_glyph_id,
        base_glyph_name,
      })
    })
    .collect::<BridgeResult<Vec<_>>>()?;
  Ok(GlyphLayerShape {
    structure: GlyphStructure {
      contours,
      anchors,
      components,
    },
    values: shape.values.to_vec(),
    component_transform_kind: ComponentTransformKind::Affine,
  })
}

fn wire_source_components(
  root: GlyphIndex,
  exact_source: Option<shift_backends::SourceIndex>,
  projections: &HashMap<GlyphIndex, &SourceGlyphProjection>,
  identity: &SourceIdentity,
) -> BridgeResult<GlyphComponents> {
  fn visit(
    glyph: GlyphIndex,
    exact_source: Option<shift_backends::SourceIndex>,
    parent_path: Vec<ComponentId>,
    output: &mut Vec<ComponentGlyph>,
    visiting: &mut HashSet<GlyphIndex>,
    projections: &HashMap<GlyphIndex, &SourceGlyphProjection>,
    identity: &SourceIdentity,
  ) -> BridgeResult<()> {
    if !visiting.insert(glyph) {
      return Err(BridgeError::InvalidInput {
        kind: "source component graph",
        value: format!("cycle at glyph {}", glyph.to_u32()),
      });
    }
    let projection = projections
      .get(&glyph)
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source component closure",
        value: glyph.to_u32().to_string(),
      })?;
    let selector = exact_source.and_then(|source| {
      projection
        .exact_shapes
        .iter()
        .find(|shape| shape.source == source)
        .map(|shape| (source, &shape.shape))
    });
    let (selector_name, shape) = match selector {
      Some((source, shape)) => (format!("source{}", source.to_u32()), shape),
      None => ("fallback".into(), &projection.fallback),
    };
    let parent_glyph_id = identity.glyph_id(glyph)?;
    for (index, component) in shape.components.iter().enumerate() {
      let component_id =
        ComponentId::from_raw(format!("{parent_glyph_id}-{selector_name}-m{index}"));
      let mut component_path = parent_path.clone();
      component_path.push(component_id.clone());
      output.push(ComponentGlyph {
        parent_glyph_id: parent_glyph_id.clone(),
        component_id,
        component_index: index,
        base_glyph_id: identity.glyph_id(component.glyph)?,
        parent_path: parent_path.clone(),
        component_path: component_path.clone(),
        attachment: None,
      });
      visit(
        component.glyph,
        exact_source,
        component_path,
        output,
        visiting,
        projections,
        identity,
      )?;
    }
    visiting.remove(&glyph);
    Ok(())
  }

  let mut components = Vec::new();
  visit(
    root,
    exact_source,
    Vec::new(),
    &mut components,
    &mut HashSet::new(),
    projections,
    identity,
  )?;
  Ok(GlyphComponents {
    root_glyph_id: identity.glyph_id(root)?,
    components,
  })
}

fn napi_source_atlas_page(
  generation: u32,
  page_index: u32,
  atlas: &VariableAtlas,
  descriptor: &SourceAtlasDescriptor,
  location: &[f64],
  layout: VariableLayout,
  identity: &SourceIdentity,
) -> BridgeResult<NapiCatalogAtlasPage> {
  let statistics = atlas.statistics();
  let weights = descriptor
    .design_weights(location)?
    .into_iter()
    .map(f64::from)
    .collect::<Vec<_>>();
  let preview_extents = descriptor.preview_extents(atlas)?;

  Ok(NapiCatalogAtlasPage {
    generation,
    page_index,
    band_count: atlas.band_count(),
    weight_count: u32::try_from(weights.len())
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
    layout: napi_slug_layout(layout)?,
    preview_extents: NapiSlugPreviewExtents {
      horizontal: f64::from(preview_extents.horizontal),
      minimum_y: f64::from(preview_extents.minimum_y),
      maximum_y: f64::from(preview_extents.maximum_y),
    },
    glyphs: descriptor
      .glyphs()
      .iter()
      .map(|(glyph, default_glyph)| {
        Ok(NapiCatalogAtlasGlyph {
          glyph_id: identity.glyph_id(GlyphIndex::new(*glyph))?.to_string(),
          default_glyph: *default_glyph,
          exact_sources: descriptor
            .exact_glyphs()
            .iter()
            .filter(|(root, _, _)| root == glyph)
            .map(|(_, source, glyph_index)| {
              let source_id = identity
                .source_ids
                .get(*source as usize)
                .cloned()
                .ok_or_else(|| BridgeError::InvalidInput {
                  kind: "source atlas exact source",
                  value: source.to_string(),
                })?;
              Ok(NapiSlugExactSource {
                source_id: source_id.to_string(),
                glyph_index: *glyph_index,
              })
            })
            .collect::<BridgeResult<Vec<_>>>()?,
        })
      })
      .collect::<BridgeResult<Vec<_>>>()?,
    weights,
    atlas_glyph_count: u32::try_from(statistics.glyph_count)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
    curve_count: u32::try_from(statistics.curve_count)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
    component_count: u32::try_from(statistics.component_count)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
  })
}

fn napi_slug_atlas(
  generation: u32,
  authored: &AuthoredAtlas,
  layout: VariableLayout,
) -> BridgeResult<NapiSlugAtlas> {
  let statistics = authored.atlas().statistics();
  let glyphs = authored
    .glyphs()
    .iter()
    .map(|glyph| NapiSlugGlyph {
      glyph_id: glyph.glyph_id.to_string(),
      default_glyph: glyph.authored.default_glyph,
      exact_sources: glyph
        .authored
        .exact_sources
        .iter()
        .map(|source| NapiSlugExactSource {
          source_id: source.source_id.to_string(),
          glyph_index: source.glyph_index,
        })
        .collect(),
    })
    .collect();
  let weight_sets = authored
    .weight_sets()
    .iter()
    .map(|set| NapiSlugWeightSet {
      basis: NapiInterpolationBasis::from(WireInterpolationBasis::from(set.basis())),
      source_weight_indices: set.source_weight_indices().to_vec(),
    })
    .collect();

  let preview_extents = authored.preview_extents()?;

  Ok(NapiSlugAtlas {
    generation,
    band_count: authored.atlas().band_count(),
    weight_count: authored.weight_count(),
    layout: napi_slug_layout(layout)?,
    preview_extents: NapiSlugPreviewExtents {
      horizontal: f64::from(preview_extents.horizontal),
      minimum_y: f64::from(preview_extents.minimum_y),
      maximum_y: f64::from(preview_extents.maximum_y),
    },
    glyphs,
    weight_sets,
    atlas_glyph_count: u32::try_from(statistics.glyph_count)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
    curve_count: u32::try_from(statistics.curve_count)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
    component_count: u32::try_from(statistics.component_count)
      .map_err(|_| shift_slug::SlugError::LengthOverflow)?,
  })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct DocumentVersion(u64);

impl DocumentVersion {
  fn next(self) -> Self {
    Self(self.0 + 1)
  }
}

#[derive(Clone)]
pub struct FontSaveSnapshot {
  font: Font,
  active_glyph_override: Option<Arc<Glyph>>,
}

impl FontSaveSnapshot {
  fn new(font: Font, active_glyph_override: Option<Glyph>) -> Self {
    Self {
      font,
      active_glyph_override: active_glyph_override.map(Arc::new),
    }
  }
}

impl FontView for FontSaveSnapshot {
  fn metadata(&self) -> &shift_font::FontMetadata {
    self.font.metadata()
  }

  fn metrics(&self) -> &shift_font::FontMetrics {
    self.font.metrics()
  }

  fn metric_definitions(&self) -> &[shift_font::MetricDefinition] {
    self.font.metric_definitions()
  }

  fn axes(&self) -> &[shift_font::Axis] {
    self.font.axes()
  }

  fn axis_mappings(&self) -> &[shift_font::AxisMapping] {
    self.font.axis_mappings()
  }

  fn named_instances(&self) -> &[shift_font::NamedInstance] {
    self.font.named_instances()
  }

  fn sources(&self) -> &[shift_font::Source] {
    self.font.sources()
  }

  fn default_source_id(&self) -> Option<SourceId> {
    self.font.default_source_id()
  }

  fn glyphs(&self) -> Vec<&Glyph> {
    let override_name = self
      .active_glyph_override
      .as_ref()
      .map(|glyph| glyph.name().to_string());
    let mut glyphs = Vec::new();

    if let Some(active_glyph) = self.active_glyph_override.as_ref() {
      glyphs.push(active_glyph.as_ref());
    }

    glyphs.extend(
      self
        .font
        .glyphs()
        .filter(|glyph| override_name.as_deref() != Some(glyph.name())),
    );

    glyphs
  }

  fn glyph(&self, name: &str) -> Option<&Glyph> {
    if let Some(active_glyph) = self.active_glyph_override.as_ref() {
      if active_glyph.name() == name {
        return Some(active_glyph.as_ref());
      }
    }

    self.font.glyph_by_name(name)
  }

  fn kerning(&self) -> &shift_font::KerningData {
    self.font.kerning()
  }

  fn features(&self) -> &shift_font::FeatureData {
    self.font.features()
  }

  fn guidelines(&self) -> &[shift_font::Guideline] {
    self.font.guidelines()
  }

  fn lib(&self) -> &shift_font::LibData {
    self.font.lib()
  }

  fn fontinfo_remainder(&self) -> &shift_font::LibData {
    self.font.fontinfo_remainder()
  }

  fn data_files(&self) -> &shift_font::BinaryData {
    self.font.data_files()
  }

  fn images(&self) -> &shift_font::BinaryData {
    self.font.images()
  }
}

pub struct ExportFontTask {
  snapshot: FontSaveSnapshot,
  request: FontExportRequest,
}

impl Task for ExportFontTask {
  type Output = FontExportResult;
  type JsValue = NapiFontExportResult;

  fn compute(&mut self) -> Result<Self::Output> {
    FontExporter::new()
      .export(&self.snapshot, self.request.clone())
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output.into())
  }
}

struct SourceIdentity {
  glyph_ids: Box<[GlyphId]>,
  glyph_indices: HashMap<GlyphId, GlyphIndex>,
  axis_ids: Box<[AxisId]>,
  source_ids: Box<[SourceId]>,
  mapping_ids: Box<[AxisMappingId]>,
  instance_ids: Box<[NamedInstanceId]>,
  metric_ids: Box<[MetricId]>,
  font_axes: Box<[FontAxis]>,
  mapping_bases: Box<[shift_font::AxisMappingBasis]>,
}

impl SourceIdentity {
  fn new(directory: &FontDirectory) -> BridgeResult<Self> {
    let glyph_ids = (0..directory.glyphs().len())
      .map(|_| GlyphId::new())
      .collect::<Vec<_>>()
      .into_boxed_slice();
    let glyph_indices = glyph_ids
      .iter()
      .cloned()
      .enumerate()
      .map(|(index, glyph_id)| (glyph_id, GlyphIndex::new(index as u32)))
      .collect();
    let mut identity = Self {
      glyph_ids,
      glyph_indices,
      axis_ids: (0..directory.axes().len())
        .map(|_| AxisId::new())
        .collect::<Vec<_>>()
        .into_boxed_slice(),
      source_ids: (0..directory.sources().len())
        .map(|_| SourceId::new())
        .collect::<Vec<_>>()
        .into_boxed_slice(),
      mapping_ids: (0..directory.mappings().len())
        .map(|_| AxisMappingId::new())
        .collect::<Vec<_>>()
        .into_boxed_slice(),
      instance_ids: (0..directory.instances().len())
        .map(|_| NamedInstanceId::new())
        .collect::<Vec<_>>()
        .into_boxed_slice(),
      metric_ids: (0..5)
        .map(|_| MetricId::new())
        .collect::<Vec<_>>()
        .into_boxed_slice(),
      font_axes: Box::new([]),
      mapping_bases: Box::new([]),
    };
    identity.font_axes = source_font_axes(directory, &identity).into_boxed_slice();
    identity.mapping_bases = source_axis_mappings(directory, &identity)?
      .iter()
      .map(|mapping| shift_font::AxisMappingBasis::try_from((mapping, identity.font_axes.as_ref())))
      .collect::<std::result::Result<Vec<_>, _>>()?
      .into_boxed_slice();
    Ok(identity)
  }

  fn glyph_id(&self, index: GlyphIndex) -> BridgeResult<GlyphId> {
    self
      .glyph_ids
      .get(index.to_usize())
      .cloned()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source glyph index",
        value: index.to_u32().to_string(),
      })
  }

  fn glyph_index(&self, glyph_id: &GlyphId) -> BridgeResult<GlyphIndex> {
    self
      .glyph_indices
      .get(glyph_id)
      .copied()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source glyph id",
        value: glyph_id.to_string(),
      })
  }
}

#[napi]
pub struct Bridge {
  workspace: Option<FontWorkspace>,
  font_source: Option<OpenedFont>,
  source_identity: Option<SourceIdentity>,
  live_version: DocumentVersion,
  saved_version: DocumentVersion,
  slug_generation: u32,
  slug_atlas: Option<SlugAtlasGeneration>,
  source_atlas_descriptors: BTreeMap<u32, SourceAtlasDescriptor>,
}

#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      workspace: None,
      font_source: None,
      source_identity: None,
      live_version: DocumentVersion::default(),
      saved_version: DocumentVersion::default(),
      slug_generation: 0,
      slug_atlas: None,
      source_atlas_descriptors: BTreeMap::new(),
    }
  }

  #[napi]
  pub fn create_untitled_workspace(
    &mut self,
    store_path: String,
    options: Option<NapiNewWorkspace>,
  ) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::create_untitled(
      store_path,
      new_workspace_from_options(options),
    )?);
    self.font_source = None;
    self.source_identity = None;
    self.reset_versions();
    Ok(())
  }

  #[napi(ts_return_type = "Promise<NapiFontExportResult>")]
  pub fn export_workspace(
    &mut self,
    request: NapiFontExportRequest,
  ) -> Result<AsyncTask<ExportFontTask>> {
    Ok(AsyncTask::new(ExportFontTask {
      snapshot: self
        .save_snapshot()
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?,
      request: request.try_into()?,
    }))
  }

  #[napi]
  pub fn document_state(&self) -> errors::Result<NapiDocumentState> {
    self.document_state_snapshot()
  }

  #[napi]
  pub fn inspect_document(&self, path: String) -> errors::Result<NapiDocumentIdentity> {
    FontWorkspace::inspect_document(path)?.try_into()
  }

  #[napi]
  pub fn close_workspace(&mut self) {
    self.workspace = None;
    self.reset_versions();
  }

  #[napi]
  pub fn open_document(&mut self, path: String, recovery_path: String) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::open_document(path, recovery_path)?);
    self.font_source = None;
    self.source_identity = None;
    self.reset_versions();
    Ok(())
  }

  #[napi]
  pub fn open_workspace(&mut self, path: String, store_path: String) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::open(path, store_path)?);
    self.font_source = None;
    self.source_identity = None;
    self.reset_versions();
    Ok(())
  }

  #[napi]
  pub fn resume_workspace(&mut self, store_path: String) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::resume(store_path)?);
    self.font_source = None;
    self.source_identity = None;
    self.reset_versions();
    Ok(())
  }

  #[napi]
  pub fn open_font_source(&mut self, path: String) -> errors::Result<NapiFontSnapshot> {
    let source = FontLoader::new().open_source(Path::new(&path))?;
    let identity = SourceIdentity::new(source.directory())?;
    let snapshot = wire_font_snapshot(&source, &identity)?;
    self.workspace = None;
    self.font_source = Some(source);
    self.source_identity = Some(identity);
    self.slug_atlas = None;
    self.source_atlas_descriptors.clear();
    Ok(snapshot.into())
  }

  #[napi]
  pub fn close_font_source(&mut self) {
    self.font_source = None;
    self.source_identity = None;
    self.slug_atlas = None;
    self.source_atlas_descriptors.clear();
  }

  #[napi]
  pub fn set_workspace_id(&mut self, workspace_id: String) -> errors::Result<NapiDocumentState> {
    self.workspace_mut()?.set_workspace_id(workspace_id)?;
    self.document_state_snapshot()
  }

  #[napi]
  pub fn save_workspace(&mut self) -> errors::Result<NapiDocumentState> {
    self.workspace_mut()?.save()?;
    self.mark_saved();
    self.document_state_snapshot()
  }

  #[napi]
  pub fn save_workspace_as_document(
    &mut self,
    path: String,
    recovery_path: String,
  ) -> errors::Result<NapiDocumentState> {
    self
      .workspace_mut()?
      .save_as_document(path, recovery_path)?;
    self.mark_saved();
    self.document_state_snapshot()
  }

  #[napi]
  pub fn discard_workspace_changes(&mut self) -> errors::Result<NapiDocumentState> {
    self.workspace_mut()?.discard_recovery()?;
    self.reset_versions();
    self.document_state_snapshot()
  }

  #[napi]
  pub fn get_metadata(&self) -> errors::Result<NapiFontMetadata> {
    Ok(FontMetadata::from(self.font()?.metadata()).into())
  }

  #[napi]
  pub fn get_metrics(&self) -> errors::Result<NapiFontMetrics> {
    Ok(FontMetrics::from(self.font()?.metrics()).into())
  }

  #[napi]
  pub fn get_glyphs(&self) -> errors::Result<Vec<NapiGlyphRecord>> {
    let workspace = self.workspace()?;
    let mut component_references = workspace.glyph_component_references()?;
    let mut records = workspace
      .font()
      .glyphs()
      .map(|glyph| {
        let mut record = GlyphRecord::from(glyph);
        record.component_base_glyph_ids =
          component_references.remove(&glyph.id()).unwrap_or_default();
        NapiGlyphRecord::from(record)
      })
      .collect::<Vec<_>>();
    records.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(records)
  }

  /// Applies one intent set as a single atomic workspace apply: every kind
  /// — editing and create alike — decodes through `map_intent` into one
  /// `FontWorkspace::apply` call. One call = one SQLite transaction = one
  /// undo step, however many intents the set batches.
  #[napi]
  pub fn apply(
    &mut self,
    intents: Vec<NapiFontIntent>,
    label: Option<String>,
  ) -> errors::Result<NapiAppliedChange> {
    if intents.is_empty() {
      return Ok(NapiAppliedChange {
        ledger_entry_id: None,
        layers: Vec::new(),
        next: None,
        dependents: Vec::new(),
      });
    }

    let mut set = FontIntentSet::default();
    for intent in intents {
      set.intents.push(map_intent(intent)?);
    }

    let (entry_id, outcome) = self.workspace_mut()?.apply_with_entry_id(set, label)?;
    self.mark_font_changed();

    self.applied_echo(entry_id, outcome)
  }

  /// Assembles the pure-state echo for an applied outcome: replace-grade
  /// layers plus dependent composites. Shared by apply/undo/redo. The
  /// records grain (glyphs/axes/sources lists) rides along whenever the
  /// change set touched that structure.
  fn applied_echo(
    &self,
    entry_id: LedgerEntryId,
    outcome: shift_font::AppliedIntents,
  ) -> errors::Result<NapiAppliedChange> {
    let mut metadata_changed = false;
    let mut glyphs_changed = false;
    let mut axes_changed = false;
    let mut axis_mappings_changed = false;
    let mut metric_definitions_changed = false;
    let mut named_instances_changed = false;
    let mut sources_changed = false;
    for change in &outcome.changes.changes {
      match change {
        FontChange::FontMetadataUpdated(_) => metadata_changed = true,
        FontChange::GlyphAppended(_)
        | FontChange::GlyphPopped(_)
        | FontChange::GlyphIdentityChanged(_)
        | FontChange::GlyphLayerCreated(_)
        | FontChange::GlyphLayerDeleted(_) => glyphs_changed = true,
        // Axis structure reshapes every source location's design space.
        FontChange::AxisCreated(_) | FontChange::AxisUpdated(_) | FontChange::AxisDeleted(_) => {
          axes_changed = true;
          sources_changed = true;
        }
        FontChange::AxisMappingsUpdated(_) => axis_mappings_changed = true,
        FontChange::MetricDefinitionsUpdated(_) => metric_definitions_changed = true,
        FontChange::NamedInstancesUpdated(_) => named_instances_changed = true,
        FontChange::SourceCreated(_)
        | FontChange::SourceUpdated(_)
        | FontChange::SourceDeleted(_) => sources_changed = true,
        _ => {}
      }
    }

    let touched_layer_ids: Vec<LayerId> = outcome
      .layers
      .iter()
      .map(|touched| touched.layer.id())
      .collect();
    let dependents = self
      .workspace()?
      .dependent_glyph_ids_for_layers(&touched_layer_ids)?
      .into_iter()
      .map(|name| name.to_string())
      .collect();

    let layers = outcome
      .layers
      .into_iter()
      .map(|touched| NapiLayerReplaced {
        layer_id: touched.layer.id().to_string(),
        structure: touched
          .structural
          .then(|| GlyphStructure::from(touched.layer.as_ref()).into()),
        values: shift_wire::values_from_layer(touched.layer.as_ref()).into(),
        changed: GlyphChangedEntities::default().into(),
      })
      .collect();

    let font_changed = metadata_changed
      || glyphs_changed
      || axes_changed
      || axis_mappings_changed
      || metric_definitions_changed
      || named_instances_changed
      || sources_changed;
    let source_metrics_interpolation_changed =
      axes_changed || metric_definitions_changed || sources_changed;
    let next = font_changed
      .then(|| -> errors::Result<NapiFontReplacement> {
        Ok(NapiFontReplacement {
          metadata: metadata_changed.then(|| self.get_metadata()).transpose()?,
          glyphs: glyphs_changed.then(|| self.get_glyphs()).transpose()?,
          axes: axes_changed.then(|| self.get_axes()).transpose()?,
          axis_mappings: axis_mappings_changed
            .then(|| self.get_axis_mappings())
            .transpose()?,
          axis_mapping_bases: (axes_changed || axis_mappings_changed)
            .then(|| self.get_axis_mapping_bases())
            .transpose()?,
          metric_definitions: metric_definitions_changed
            .then(|| self.get_metric_definitions())
            .transpose()?,
          source_metrics_interpolation: source_metrics_interpolation_changed
            .then(
              || -> errors::Result<NapiSourceMetricsInterpolationReplacement> {
                Ok(NapiSourceMetricsInterpolationReplacement {
                  snapshot: self.get_source_metrics_interpolation()?,
                })
              },
            )
            .transpose()?,
          named_instances: named_instances_changed
            .then(|| self.get_named_instances())
            .transpose()?,
          sources: sources_changed.then(|| self.get_sources()).transpose()?,
        })
      })
      .transpose()?;

    Ok(NapiAppliedChange {
      ledger_entry_id: Some(entry_id.to_string()),
      layers,
      next,
      dependents,
    })
  }

  /// Replays the most recent ledger entry's pre states; `null` when the
  /// undo stack is empty.
  #[napi]
  pub fn undo(&mut self) -> errors::Result<Option<NapiAppliedChange>> {
    self.undo_with_entry_id(None)
  }

  /// Replays one identified entry only when it is next in the undo stack.
  #[napi(ts_args_type = "entryId: LedgerEntryId")]
  pub fn undo_entry(&mut self, entry_id: String) -> errors::Result<Option<NapiAppliedChange>> {
    self.undo_with_entry_id(Some(parse::<LedgerEntryId>(&entry_id)?))
  }

  fn undo_with_entry_id(
    &mut self,
    expected: Option<LedgerEntryId>,
  ) -> errors::Result<Option<NapiAppliedChange>> {
    let entry_id = match expected {
      Some(entry_id) => entry_id,
      None => {
        let Some(entry_id) = self.workspace()?.next_undo_entry_id() else {
          return Ok(None);
        };
        entry_id
      }
    };
    let outcome = match expected {
      Some(_) => self.workspace_mut()?.undo_entry(entry_id)?,
      None => self.workspace_mut()?.undo()?,
    };
    let Some(outcome) = outcome else {
      return Ok(None);
    };

    self.mark_font_changed();
    Ok(Some(self.applied_echo(entry_id, outcome)?))
  }

  /// Replays the most recent undone entry's post states; `null` when the
  /// redo stack is empty.
  #[napi]
  pub fn redo(&mut self) -> errors::Result<Option<NapiAppliedChange>> {
    self.redo_with_entry_id(None)
  }

  /// Replays one identified entry only when it is next in the redo stack.
  #[napi(ts_args_type = "entryId: LedgerEntryId")]
  pub fn redo_entry(&mut self, entry_id: String) -> errors::Result<Option<NapiAppliedChange>> {
    self.redo_with_entry_id(Some(parse::<LedgerEntryId>(&entry_id)?))
  }

  fn redo_with_entry_id(
    &mut self,
    expected: Option<LedgerEntryId>,
  ) -> errors::Result<Option<NapiAppliedChange>> {
    let entry_id = match expected {
      Some(entry_id) => entry_id,
      None => {
        let Some(entry_id) = self.workspace()?.next_redo_entry_id() else {
          return Ok(None);
        };
        entry_id
      }
    };
    let outcome = match expected {
      Some(_) => self.workspace_mut()?.redo_entry(entry_id)?,
      None => self.workspace_mut()?.redo()?,
    };
    let Some(outcome) = outcome else {
      return Ok(None);
    };

    self.mark_font_changed();
    Ok(Some(self.applied_echo(entry_id, outcome)?))
  }

  /// Permanently removes every currently undone document entry.
  #[napi]
  pub fn discard_redo(&mut self) -> errors::Result<()> {
    self.workspace_mut()?.discard_redo();
    Ok(())
  }

  /// Glyph-addressed snapshots for renderer-local synchronous font state.
  #[napi]
  pub fn get_glyph_snapshots(
    &mut self,
    requests: Vec<NapiGlyphSnapshotRequest>,
  ) -> errors::Result<Vec<NapiGlyphSnapshot>> {
    let requests = requests
      .into_iter()
      .map(GlyphSnapshotRequest::from)
      .collect::<Vec<_>>();
    let glyph_ids = requests
      .iter()
      .map(|request| request.glyph_id.clone())
      .collect::<Vec<_>>();
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::Glyphs)?;
    let mut snapshots = Vec::new();
    for request in requests {
      let glyph_id = request.glyph_id;
      let Some(glyph) = font.glyph(glyph_id.clone()) else {
        continue;
      };

      let projection = font.glyph_projection(&glyph_id)?.as_ref().map(Into::into);

      let layers = glyph
        .layers()
        .values()
        .map(|layer| layer.as_ref())
        .map(|layer| GlyphLayerSnapshot {
          glyph_id: glyph_id.clone(),
          source_id: layer.source_id(),
          state: GlyphState::from_layer(layer),
        })
        .collect();

      snapshots.push(GlyphSnapshot {
        glyph_id,
        projection,
        layers,
      });
    }

    Ok(snapshots.into_iter().map(Into::into).collect())
  }

  /// Returns compact glyph projections without resolving a location.
  ///
  /// Missing glyph identities and glyphs without authored shapes are omitted.
  /// The projections retain compatible interpolation and exact-source shapes so a
  /// renderer can evaluate design-location changes without further IPC.
  #[napi(ts_args_type = "glyphIds: Array<GlyphId>")]
  pub fn get_glyph_projections(
    &mut self,
    glyph_ids: Vec<String>,
  ) -> errors::Result<Vec<NapiGlyphProjection>> {
    let glyph_ids = glyph_ids
      .iter()
      .map(|glyph_id| parse::<GlyphId>(glyph_id))
      .collect::<errors::Result<Vec<_>>>()?;
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::ComponentClosure)?;
    let mut projections = Vec::new();
    let mut pending = glyph_ids.into_iter().collect::<VecDeque<_>>();
    let mut seen = HashSet::new();

    while let Some(glyph_id) = pending.pop_front() {
      if !seen.insert(glyph_id.clone()) {
        continue;
      }
      if font.glyph(glyph_id.clone()).is_none() {
        continue;
      }

      let Some(projection) = font.glyph_projection(&glyph_id)? else {
        continue;
      };
      pending.extend(projection.component_glyph_ids().iter().cloned());
      projections.push(GlyphProjection::from(&projection).into());
    }

    Ok(projections)
  }

  /// Location-resolved glyph previews: one svg path and advance per glyph.
  ///
  /// `location` is an internal authoring location; external axis mappings must
  /// be evaluated first (see `map_location`). Components and interpolation
  /// resolve at that location with shared component work across the batch.
  /// Missing glyph identities are omitted. No editable structure crosses the
  /// boundary, so the payload stays orders of magnitude lighter than
  /// `get_glyph_snapshots`.
  #[napi(ts_args_type = "glyphIds: Array<GlyphId>, location: NapiLocation")]
  pub fn get_glyph_previews(
    &mut self,
    glyph_ids: Vec<String>,
    location: NapiLocation,
  ) -> errors::Result<Vec<NapiGlyphPreview>> {
    let glyph_ids = glyph_ids
      .iter()
      .map(|glyph_id| parse::<GlyphId>(glyph_id))
      .collect::<errors::Result<Vec<_>>>()?;
    let location = shift_font::DesignLocation::from_untyped(map_location(location)?);
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::ComponentClosure)?;
    let mut projection = font.projection(&location);
    let previews = projection
      .glyphs(&glyph_ids)?
      .into_iter()
      .map(|glyph| NapiGlyphPreview {
        glyph_id: glyph.glyph_id().to_string(),
        svg_path: resolved_contours_to_svg_path(glyph.contours()),
        x_advance: glyph.x_advance(),
      })
      .collect();

    Ok(previews)
  }

  /// Builds one complete authored Slug generation without resolving a location.
  ///
  /// The returned metadata is small enough for the ordinary sync lane. Packed
  /// geometry remains native until `stream_slug_atlas` emits bounded chunks.
  #[napi]
  pub fn prepare_slug_atlas(&mut self, alignment: u32) -> errors::Result<NapiSlugAtlas> {
    let total_started = Instant::now();
    let started = Instant::now();
    self.workspace_mut()?.acquire_all_layers()?;
    let acquisition = started.elapsed();
    let (authored, profile) =
      build_authored_atlas_profiled(self.font()?, shift_slug::DEFAULT_BAND_COUNT)?;
    let started = Instant::now();
    let layout = authored.atlas().layout(alignment as usize)?;
    let layout_elapsed = started.elapsed();
    self.slug_generation = self
      .slug_generation
      .checked_add(1)
      .ok_or(shift_slug::SlugError::LengthOverflow)?;
    let generation = self.slug_generation;
    let result = napi_slug_atlas(generation, &authored, layout)?;
    log_slug_atlas_profile(
      "complete",
      acquisition,
      profile,
      layout_elapsed,
      total_started.elapsed(),
    );
    self.slug_atlas = Some(SlugAtlasGeneration {
      generation,
      alignment: alignment as usize,
      atlas: authored.into_atlas(),
    });
    Ok(result)
  }

  /// Returns the durable authored revision used to address disposable cached atlas pages.
  #[napi]
  pub fn slug_atlas_cache_revision(&self) -> errors::Result<String> {
    Ok(self.workspace()?.slug_atlas_cache_revision()?)
  }

  /// Builds one ordered root-glyph page plus its transitive component geometry.
  ///
  /// The page uses the same packed layout as a complete atlas, but excludes
  /// unrelated roots so the renderer can make its viewport resident first.
  #[napi(ts_args_type = "glyphIds: Array<GlyphId>, alignment: number")]
  pub fn prepare_slug_atlas_page(
    &mut self,
    glyph_ids: Vec<String>,
    alignment: u32,
  ) -> errors::Result<NapiSlugAtlas> {
    let total_started = Instant::now();
    let glyph_ids = glyph_ids
      .iter()
      .map(|glyph_id| parse::<GlyphId>(glyph_id))
      .collect::<errors::Result<Vec<_>>>()?;
    let started = Instant::now();
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::ComponentClosure)?;
    let acquisition = started.elapsed();
    let (authored, profile) =
      build_authored_atlas_page_profiled(font, &glyph_ids, shift_slug::DEFAULT_BAND_COUNT)?;
    let started = Instant::now();
    let layout = authored.atlas().layout(alignment as usize)?;
    let layout_elapsed = started.elapsed();
    self.slug_generation = self
      .slug_generation
      .checked_add(1)
      .ok_or(shift_slug::SlugError::LengthOverflow)?;
    let generation = self.slug_generation;
    let result = napi_slug_atlas(generation, &authored, layout)?;
    log_slug_atlas_profile(
      "page",
      acquisition,
      profile,
      layout_elapsed,
      total_started.elapsed(),
    );
    self.slug_atlas = Some(SlugAtlasGeneration {
      generation,
      alignment: alignment as usize,
      atlas: authored.into_atlas(),
    });
    Ok(result)
  }

  /// Streams the prepared generation with native Web Stream backpressure.
  ///
  /// A capacity-one channel bounds temporary memory to one upload chunk. The
  /// authored atlas moves to the producer thread and is dropped when the stream
  /// completes, so GPU residency retains no second atlas-sized CPU copy.
  #[napi]
  pub fn stream_slug_atlas(
    &mut self,
    env: &Env,
    generation: u32,
    maximum_length: u32,
  ) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
    let prepared_generation = self
      .slug_atlas
      .as_ref()
      .map(|prepared| prepared.generation)
      .ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          format!("unknown Slug atlas generation {generation}"),
        )
      })?;
    if prepared_generation != generation {
      return Err(Error::new(
        Status::InvalidArg,
        format!("unknown Slug atlas generation {generation}"),
      ));
    }

    let prepared = self
      .slug_atlas
      .take()
      .expect("prepared Slug generation was checked above");
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Vec<u8>>>(1);
    std::thread::spawn(move || {
      let mut receiver_closed = false;
      let result =
        prepared
          .atlas
          .write_packed_chunks(prepared.alignment, maximum_length as usize, |chunk| {
            if receiver_closed {
              return;
            }
            receiver_closed = sender.blocking_send(Ok(chunk.bytes.to_vec())).is_err();
          });
      if !receiver_closed {
        if let Err(error) = result {
          let _ = sender.blocking_send(Err(Error::new(Status::GenericFailure, error.to_string())));
        }
      }
    });

    ReadableStream::create_with_stream_bytes(
      env,
      tokio_stream::wrappers::ReceiverStream::new(receiver),
    )
  }

  /// Streams one prepared page with the complete-atlas backpressure contract.
  #[napi]
  pub fn stream_slug_atlas_page(
    &mut self,
    env: &Env,
    generation: u32,
    maximum_length: u32,
  ) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
    self.stream_slug_atlas(env, generation, maximum_length)
  }

  /// Releases a prepared generation after adapter rejection or initialization failure.
  #[napi]
  pub fn discard_slug_atlas(&mut self, generation: u32) {
    if self
      .slug_atlas
      .as_ref()
      .is_some_and(|prepared| prepared.generation == generation)
    {
      self.slug_atlas = None;
    }
  }

  /// Releases one rejected prepared page.
  #[napi]
  pub fn discard_slug_atlas_page(&mut self, generation: u32) {
    self.discard_slug_atlas(generation);
  }

  /// Reads one location-independent source glyph and its complete component closure.
  #[napi(ts_args_type = "glyphId: GlyphId")]
  pub fn read_font_source_glyph(&self, glyph_id: String) -> errors::Result<Vec<NapiGlyphSnapshot>> {
    let glyph_id = parse::<GlyphId>(&glyph_id)?;
    let source = self.font_source()?;
    let identity = self.source_identity()?;
    let glyph_index = identity.glyph_index(&glyph_id)?;
    let projected = source.glyph(glyph_index)?;
    Ok(
      wire_source_glyph(projected, source.directory(), identity)?
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  /// Builds one source-neutral catalog page through the active format adapter.
  #[napi(
    ts_args_type = "pageIndex: number, glyphIds: Array<GlyphId>, coordinates: Array<number>, alignment: number"
  )]
  pub fn prepare_source_atlas_page(
    &mut self,
    page_index: u32,
    glyph_ids: Vec<String>,
    coordinates: Vec<f64>,
    alignment: u32,
  ) -> errors::Result<NapiCatalogAtlasPage> {
    self.slug_generation = self
      .slug_generation
      .checked_add(1)
      .ok_or(shift_slug::SlugError::LengthOverflow)?;
    let generation = self.slug_generation;
    let (atlas, descriptor, location, layout) = {
      let source = self.font_source()?;
      let identity = self.source_identity()?;
      let location = source_location(source.directory(), identity, coordinates)?;
      let roots = glyph_ids
        .iter()
        .map(|glyph_id| parse::<GlyphId>(glyph_id))
        .collect::<errors::Result<Vec<_>>>()?
        .iter()
        .map(|glyph_id| identity.glyph_index(glyph_id))
        .collect::<BridgeResult<Vec<_>>>()?;
      let page = match source {
        OpenedFont::OpenType(font) => {
          build_binary_atlas_page(font, &roots, shift_slug::DEFAULT_BAND_COUNT)?
        }
        source => {
          let input = variable_glyph_inputs(source, &roots)?;
          compile_retained_page(&input, shift_slug::DEFAULT_BAND_COUNT)?
        }
      };
      let (atlas, descriptor) = page.into_parts();
      let layout = atlas.layout(alignment as usize)?;
      (atlas, descriptor, location, layout)
    };
    let result = napi_source_atlas_page(
      generation,
      page_index,
      &atlas,
      &descriptor,
      &location,
      layout,
      self.source_identity()?,
    )?;
    self.source_atlas_descriptors.insert(page_index, descriptor);
    self.slug_atlas = Some(SlugAtlasGeneration {
      generation,
      alignment: alignment as usize,
      atlas,
    });
    Ok(result)
  }

  /// Streams one prepared source page through the same bounded atlas lane.
  #[napi]
  pub fn stream_source_atlas_page(
    &mut self,
    env: &Env,
    generation: u32,
    maximum_length: u32,
  ) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
    self.stream_slug_atlas(env, generation, maximum_length)
  }

  /// Releases a rejected source page and its retained weight descriptor.
  #[napi]
  pub fn discard_source_atlas_page(&mut self, page_index: u32, generation: u32) {
    self.discard_slug_atlas(generation);
    self.source_atlas_descriptors.remove(&page_index);
  }

  /// Evaluates every resident page's small weight buffer at one source location.
  #[napi]
  pub fn source_atlas_weights(
    &self,
    coordinates: Vec<f64>,
  ) -> errors::Result<Vec<NapiCatalogAtlasWeights>> {
    let source = self.font_source()?;
    let identity = self.source_identity()?;
    let location = source_location(source.directory(), identity, coordinates)?;

    self
      .source_atlas_descriptors
      .iter()
      .map(|(page_index, descriptor)| {
        Ok(NapiCatalogAtlasWeights {
          page_index: *page_index,
          weights: descriptor
            .design_weights(&location)?
            .into_iter()
            .map(f64::from)
            .collect(),
        })
      })
      .collect()
  }

  #[napi]
  pub fn is_variable(&self) -> errors::Result<bool> {
    Ok(self.font()?.is_variable())
  }

  #[napi]
  pub fn get_axes(&self) -> errors::Result<Vec<NapiAxis>> {
    Ok(
      self
        .font()?
        .axes()
        .iter()
        .map(Axis::from)
        .map(Into::into)
        .collect(),
    )
  }

  #[napi]
  pub fn get_axis_mappings(&self) -> errors::Result<Vec<NapiAxisMapping>> {
    Ok(
      self
        .font()?
        .axis_mappings()
        .iter()
        .map(AxisMapping::from)
        .map(Into::into)
        .collect(),
    )
  }

  #[napi]
  pub fn get_axis_mapping_bases(&self) -> errors::Result<Vec<NapiAxisMappingBasis>> {
    Ok(
      self
        .font()?
        .axis_mapping_bases()?
        .iter()
        .map(AxisMappingBasis::from)
        .map(Into::into)
        .collect(),
    )
  }

  #[napi]
  pub fn get_metric_definitions(&self) -> errors::Result<Vec<NapiMetricDefinition>> {
    Ok(
      self
        .font()?
        .metric_definitions()
        .iter()
        .map(MetricDefinition::from)
        .map(Into::into)
        .collect(),
    )
  }

  #[napi]
  pub fn get_named_instances(&self) -> errors::Result<Vec<NapiNamedInstance>> {
    Ok(
      self
        .font()?
        .named_instances()
        .iter()
        .map(NamedInstance::from)
        .map(Into::into)
        .collect(),
    )
  }

  /// Returns the precomputed source-metric interpolation model for this font.
  #[napi]
  pub fn get_source_metrics_interpolation(
    &self,
  ) -> errors::Result<Option<NapiSourceMetricsInterpolationSnapshot>> {
    let font = self.font()?;
    let Some(interpolation) = font.source_metric_interpolation() else {
      return Ok(None);
    };
    let snapshot = SourceMetricsInterpolationSnapshot::from(&interpolation);

    Ok(Some(snapshot.into()))
  }

  #[napi]
  pub fn map_location(&self, location: NapiLocation) -> errors::Result<NapiLocation> {
    let external = shift_font::ExternalLocation::from_untyped(map_location(location)?);
    let mapped = self.font()?.mapped_location(&external)?;
    Ok(shift_wire::Location::from(mapped.as_untyped()).into())
  }

  #[napi]
  pub fn get_sources(&self) -> errors::Result<Vec<NapiSource>> {
    Ok(
      self
        .font()?
        .sources()
        .iter()
        .filter(|source| source.is_master())
        .map(Source::from)
        .map(Into::into)
        .collect(),
    )
  }

  fn save_snapshot(&mut self) -> BridgeResult<FontSaveSnapshot> {
    self.workspace_mut()?.acquire_all_layers()?;
    Ok(FontSaveSnapshot::new(self.font()?.clone(), None))
  }

  fn workspace(&self) -> BridgeResult<&FontWorkspace> {
    self
      .workspace
      .as_ref()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "workspace",
        value: "no workspace is open".to_string(),
      })
  }

  fn workspace_mut(&mut self) -> BridgeResult<&mut FontWorkspace> {
    self
      .workspace
      .as_mut()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "workspace",
        value: "no workspace is open".to_string(),
      })
  }

  fn font_source(&self) -> BridgeResult<&OpenedFont> {
    self
      .font_source
      .as_ref()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "font source",
        value: "no retained font source is open".to_string(),
      })
  }

  fn source_identity(&self) -> BridgeResult<&SourceIdentity> {
    self
      .source_identity
      .as_ref()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "font source identity",
        value: "no retained font source is open".to_string(),
      })
  }

  fn acquire_and_font(
    &mut self,
    glyph_ids: &[GlyphId],
    scope: AcquireScope,
  ) -> BridgeResult<&Font> {
    self.workspace_mut()?.acquire_glyphs(glyph_ids, scope)?;
    self.font()
  }

  fn font(&self) -> BridgeResult<&Font> {
    Ok(self.workspace()?.font())
  }

  fn document_state_snapshot(&self) -> BridgeResult<NapiDocumentState> {
    let workspace = self.workspace()?;
    let source_kind = match workspace.source() {
      WorkspaceSource::Untitled => "untitled",
      WorkspaceSource::Document { .. } => "document",
      WorkspaceSource::Imported { .. } => "imported",
    };
    let document_id = workspace
      .document_metadata()?
      .map(|metadata| metadata.document_id.to_string());
    let save_target = workspace.save_target().map(path_to_string).transpose()?;
    let needs_save_as = !matches!(workspace.source(), WorkspaceSource::Document { .. });

    Ok(NapiDocumentState {
      source_kind: source_kind.to_string(),
      document_id,
      save_target,
      dirty: workspace.is_dirty()?,
      needs_save_as,
    })
  }

  fn mark_font_changed(&mut self) {
    self.slug_atlas = None;
    self.bump_live_version();
  }

  fn mark_saved(&mut self) {
    self.saved_version = self.live_version;
  }

  fn bump_live_version(&mut self) {
    self.live_version = self.live_version.next();
  }

  fn reset_versions(&mut self) {
    self.slug_atlas = None;
    self.source_atlas_descriptors.clear();
    self.live_version = DocumentVersion::default();
    self.saved_version = DocumentVersion::default();
  }
}

fn path_to_string(path: &Path) -> BridgeResult<String> {
  path
    .to_str()
    .map(str::to_string)
    .ok_or_else(|| WorkspaceError::InvalidPathUtf8(path.to_path_buf()).into())
}

fn parse_id_list<T: BridgeParse>(ids: &[String]) -> BridgeResult<Vec<T>> {
  ids.iter().map(|id| parse::<T>(id)).collect()
}

fn map_intent(intent: NapiFontIntent) -> errors::Result<FontIntent> {
  let missing = |kind: &str| BridgeError::InvalidInput {
    kind: "intent",
    value: format!("{kind} requires its payload field"),
  };

  match intent.kind.as_str() {
    "addPoints" => {
      let payload = intent.add_points.ok_or_else(|| missing("addPoints"))?;
      Ok(FontIntent::AddPoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: payload
          .contour_id
          .map(|id| parse::<ContourId>(&id))
          .transpose()?,
        before: payload.before.map(|id| parse::<PointId>(&id)).transpose()?,
        points: payload
          .points
          .into_iter()
          .map(map_point_seed)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "addContour" => {
      let payload = intent.add_contour.ok_or_else(|| missing("addContour"))?;
      Ok(FontIntent::AddContour {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: parse::<ContourId>(&payload.contour_id)?,
        closed: payload.closed,
      })
    }
    "setContourClosed" => {
      let payload = intent
        .set_contour_closed
        .ok_or_else(|| missing("setContourClosed"))?;
      Ok(FontIntent::SetContourClosed {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: parse::<ContourId>(&payload.contour_id)?,
        closed: payload.closed,
      })
    }
    "movePoints" => {
      let payload = intent.move_points.ok_or_else(|| missing("movePoints"))?;
      Ok(FontIntent::MovePoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_ids: parse_id_list::<PointId>(&payload.point_ids)?,
        coords: payload.coords,
      })
    }
    "setPointSmooth" => {
      let payload = intent
        .set_point_smooth
        .ok_or_else(|| missing("setPointSmooth"))?;
      Ok(FontIntent::SetPointSmooth {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_id: parse::<PointId>(&payload.point_id)?,
        smooth: payload.smooth,
      })
    }
    "removePoints" => {
      let payload = intent
        .remove_points
        .ok_or_else(|| missing("removePoints"))?;
      Ok(FontIntent::RemovePoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_ids: parse_id_list::<PointId>(&payload.point_ids)?,
      })
    }
    "addAnchors" => {
      let payload = intent.add_anchors.ok_or_else(|| missing("addAnchors"))?;
      Ok(FontIntent::AddAnchors {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        anchors: payload
          .anchors
          .into_iter()
          .map(map_anchor_seed)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "moveAnchors" => {
      let payload = intent.move_anchors.ok_or_else(|| missing("moveAnchors"))?;
      Ok(FontIntent::MoveAnchors {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        anchor_ids: parse_id_list::<AnchorId>(&payload.anchor_ids)?,
        coords: payload.coords,
      })
    }
    "removeAnchors" => {
      let payload = intent
        .remove_anchors
        .ok_or_else(|| missing("removeAnchors"))?;
      Ok(FontIntent::RemoveAnchors {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        anchor_ids: parse_id_list::<AnchorId>(&payload.anchor_ids)?,
      })
    }
    "reverseContour" => {
      let payload = intent
        .reverse_contour
        .ok_or_else(|| missing("reverseContour"))?;
      Ok(FontIntent::ReverseContour {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: parse::<ContourId>(&payload.contour_id)?,
      })
    }
    "translatePoints" => {
      let payload = intent
        .translate_points
        .ok_or_else(|| missing("translatePoints"))?;
      Ok(FontIntent::TranslatePoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_ids: parse_id_list::<PointId>(&payload.point_ids)?,
        dx: payload.dx,
        dy: payload.dy,
      })
    }
    "setXAdvance" => {
      let payload = intent.set_x_advance.ok_or_else(|| missing("setXAdvance"))?;
      Ok(FontIntent::SetXAdvance {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        width: payload.width,
      })
    }
    "applyBooleanOp" => {
      let payload = intent
        .apply_boolean_op
        .ok_or_else(|| missing("applyBooleanOp"))?;
      Ok(FontIntent::ApplyBooleanOp {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id_a: parse::<ContourId>(&payload.contour_id_a)?,
        contour_id_b: parse::<ContourId>(&payload.contour_id_b)?,
        operation: parse_boolean_op(&payload.operation)?,
      })
    }
    "createGlyph" => {
      let payload = intent.create_glyph.ok_or_else(|| missing("createGlyph"))?;
      Ok(FontIntent::CreateGlyph {
        glyph_id: Some(parse::<GlyphId>(&payload.glyph_id)?),
        name: payload.name,
        unicodes: payload.unicodes,
      })
    }
    "updateGlyph" => {
      let payload = intent.update_glyph.ok_or_else(|| missing("updateGlyph"))?;
      Ok(FontIntent::UpdateGlyph {
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        new_name: payload.new_name.into(),
        new_unicodes: payload.new_unicodes,
      })
    }
    "updateFontMetadata" => {
      let payload = intent
        .update_font_metadata
        .ok_or_else(|| missing("updateFontMetadata"))?;
      Ok(FontIntent::UpdateFontMetadata {
        metadata: map_font_metadata(payload.metadata),
      })
    }
    "createAxis" => {
      let payload = intent.create_axis.ok_or_else(|| missing("createAxis"))?;
      Ok(FontIntent::CreateAxis {
        axis: map_axis(payload.axis)?,
      })
    }
    "updateAxis" => {
      let payload = intent.update_axis.ok_or_else(|| missing("updateAxis"))?;
      Ok(FontIntent::UpdateAxis {
        axis: map_axis(payload.axis)?,
      })
    }
    "deleteAxis" => {
      let payload = intent.delete_axis.ok_or_else(|| missing("deleteAxis"))?;
      Ok(FontIntent::DeleteAxis {
        axis_id: parse::<AxisId>(&payload.axis_id)?,
      })
    }
    "setAxisMappings" => {
      let payload = intent
        .set_axis_mappings
        .ok_or_else(|| missing("setAxisMappings"))?;
      Ok(FontIntent::SetAxisMappings {
        mappings: payload
          .mappings
          .into_iter()
          .map(map_axis_mapping)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "setMetricDefinitions" => {
      let payload = intent
        .set_metric_definitions
        .ok_or_else(|| missing("setMetricDefinitions"))?;
      Ok(FontIntent::SetMetricDefinitions {
        definitions: payload
          .definitions
          .into_iter()
          .map(map_metric_definition)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "createNamedInstance" => {
      let payload = intent
        .create_named_instance
        .ok_or_else(|| missing("createNamedInstance"))?;
      Ok(FontIntent::CreateNamedInstance {
        instance: map_named_instance(payload.instance)?,
      })
    }
    "updateNamedInstance" => {
      let payload = intent
        .update_named_instance
        .ok_or_else(|| missing("updateNamedInstance"))?;
      Ok(FontIntent::UpdateNamedInstance {
        instance: map_named_instance(payload.instance)?,
      })
    }
    "deleteNamedInstance" => {
      let payload = intent
        .delete_named_instance
        .ok_or_else(|| missing("deleteNamedInstance"))?;
      Ok(FontIntent::DeleteNamedInstance {
        instance_id: parse::<NamedInstanceId>(&payload.instance_id)?,
      })
    }
    "deleteSource" => {
      let payload = intent
        .delete_source
        .ok_or_else(|| missing("deleteSource"))?;
      Ok(FontIntent::DeleteSource {
        source_id: parse::<SourceId>(&payload.source_id)?,
      })
    }
    "createSource" => {
      let payload = intent
        .create_source
        .ok_or_else(|| missing("createSource"))?;
      Ok(FontIntent::CreateSource {
        source_id: parse::<SourceId>(&payload.source_id)?,
        name: payload.name,
        location: shift_font::DesignLocation::from_untyped(map_location(payload.location)?),
      })
    }
    "updateSource" => {
      let payload = intent
        .update_source
        .ok_or_else(|| missing("updateSource"))?;
      let metric_values = payload
        .metric_values
        .into_iter()
        .map(|value| {
          Ok((
            parse::<MetricId>(&value.metric_id)?,
            MetricValue::new(value.position, value.overshoot),
          ))
        })
        .collect::<errors::Result<_>>()?;
      Ok(FontIntent::UpdateSource {
        source_id: parse::<SourceId>(&payload.source_id)?,
        name: payload.name,
        location: shift_font::DesignLocation::from_untyped(map_location(payload.location)?),
        metric_values,
        italic_angle: payload.italic_angle,
        line_gap: payload.line_gap,
        underline_position: payload.underline_position,
        underline_thickness: payload.underline_thickness,
      })
    }
    "createGlyphLayer" => {
      let payload = intent
        .create_glyph_layer
        .ok_or_else(|| missing("createGlyphLayer"))?;
      Ok(FontIntent::CreateGlyphLayer {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        source_id: parse::<SourceId>(&payload.source_id)?,
      })
    }
    "cloneGlyphLayer" => {
      let payload = intent
        .clone_glyph_layer
        .ok_or_else(|| missing("cloneGlyphLayer"))?;
      Ok(FontIntent::CloneGlyphLayer {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        source_id: parse::<SourceId>(&payload.source_id)?,
        from_layer_id: parse::<LayerId>(&payload.from_layer_id)?,
      })
    }
    "materializeGlyphLayer" => {
      let payload = intent
        .materialize_glyph_layer
        .ok_or_else(|| missing("materializeGlyphLayer"))?;
      Ok(FontIntent::MaterializeGlyphLayer {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        source_id: parse::<SourceId>(&payload.source_id)?,
        from_layer_id: parse::<LayerId>(&payload.from_layer_id)?,
        values: shift_font::GlyphInterpolationValues::new(payload.values.to_vec()),
      })
    }
    other => Err(BridgeError::InvalidInput {
      kind: "intent",
      value: format!("unknown intent kind \"{other}\""),
    }),
  }
}

fn parse_boolean_op(operation: &str) -> errors::Result<BooleanOp> {
  match operation {
    "union" => Ok(BooleanOp::Union),
    "subtract" => Ok(BooleanOp::Subtract),
    "intersect" => Ok(BooleanOp::Intersect),
    "difference" => Ok(BooleanOp::Difference),
    other => Err(BridgeError::InvalidInput {
      kind: "intent",
      value: format!("unknown boolean operation \"{other}\""),
    }),
  }
}

fn map_point_seed(seed: NapiPointSeed) -> errors::Result<PointSeed> {
  Ok(PointSeed {
    id: parse::<PointId>(&seed.id)?,
    x: seed.x,
    y: seed.y,
    point_type: seed.point_type.into(),
    smooth: seed.smooth,
  })
}

fn map_anchor_seed(seed: NapiAnchorSeed) -> errors::Result<AnchorSeed> {
  Ok(AnchorSeed {
    id: parse::<AnchorId>(&seed.id)?,
    name: seed.name,
    x: seed.x,
    y: seed.y,
  })
}

fn map_location(location: NapiLocation) -> errors::Result<FontLocation> {
  let values = location
    .values
    .into_iter()
    .map(|(axis_id, value)| Ok((parse::<AxisId>(&axis_id)?, value)))
    .collect::<errors::Result<_>>()?;
  Ok(FontLocation::from_map(values))
}

fn map_font_metadata(metadata: NapiFontMetadata) -> FontMetadataModel {
  FontMetadataModel {
    family_name: metadata.family_name,
    style_name: metadata.style_name,
    version_major: metadata.version_major,
    version_minor: metadata.version_minor,
    copyright: metadata.copyright,
    trademark: metadata.trademark,
    designer: metadata.designer,
    designer_url: metadata.designer_url,
    manufacturer: metadata.manufacturer,
    manufacturer_url: metadata.manufacturer_url,
    license: metadata.license,
    license_url: metadata.license_url,
    description: metadata.description,
    note: metadata.note,
  }
}

fn map_metric_definition(definition: NapiMetricDefinition) -> errors::Result<FontMetricDefinition> {
  let kind = match definition.kind {
    NapiMetricKind::Ascender => MetricKind::Ascender,
    NapiMetricKind::CapHeight => MetricKind::CapHeight,
    NapiMetricKind::XHeight => MetricKind::XHeight,
    NapiMetricKind::Baseline => MetricKind::Baseline,
    NapiMetricKind::Descender => MetricKind::Descender,
    NapiMetricKind::Custom => MetricKind::Custom,
  };
  Ok(FontMetricDefinition::with_id(
    parse::<MetricId>(&definition.id)?,
    kind,
    definition.name,
  ))
}

fn map_axis(axis: NapiAxis) -> errors::Result<FontAxis> {
  let axis_id = parse::<AxisId>(&axis.id)?;
  let mut mapped = match axis.axis_type {
    NapiAxisType::Continuous => FontAxis::continuous_with_id(
      axis_id,
      axis.tag,
      axis.name,
      axis.minimum.ok_or_else(|| BridgeError::InvalidInput {
        kind: "continuous axis minimum",
        value: "missing".to_string(),
      })?,
      axis.default,
      axis.maximum.ok_or_else(|| BridgeError::InvalidInput {
        kind: "continuous axis maximum",
        value: "missing".to_string(),
      })?,
    ),
    NapiAxisType::Discrete => FontAxis::discrete_with_id(
      axis_id,
      axis.tag,
      axis.name,
      axis.values.ok_or_else(|| BridgeError::InvalidInput {
        kind: "discrete axis values",
        value: "missing".to_string(),
      })?,
      axis.default,
    ),
  };
  mapped.set_role(match axis.role {
    NapiAxisRole::External => AxisRole::External,
    NapiAxisRole::Internal => AxisRole::Internal,
  });
  let mut labels = Vec::new();
  for label in axis.labels {
    let range = match (label.minimum, label.maximum) {
      (None, None) => None,
      (Some(minimum), Some(maximum)) => Some(AxisLabelRange { minimum, maximum }),
      _ => {
        return Err(BridgeError::InvalidInput {
          kind: "axis label range",
          value: "minimum and maximum must be provided together".to_string(),
        })
      }
    };
    labels.push(AxisLabel::with_id(
      parse::<AxisLabelId>(&label.id)?,
      label.name,
      label.value,
      range,
      label.linked_value,
      label.elidable,
    ));
  }
  mapped.set_labels(labels);
  mapped.set_hidden(axis.hidden);
  mapped.validate()?;
  Ok(mapped)
}

fn map_named_instance(instance: NapiNamedInstance) -> errors::Result<FontNamedInstance> {
  Ok(FontNamedInstance::with_id(
    parse::<NamedInstanceId>(&instance.id)?,
    instance.name,
    shift_font::ExternalLocation::from_untyped(map_location(instance.location)?),
    instance.postscript_name,
  ))
}

fn map_axis_mapping(mapping: NapiAxisMapping) -> errors::Result<FontAxisMapping> {
  let mut mapped = FontAxisMapping::with_id(
    parse::<AxisMappingId>(&mapping.id)?,
    mapping.name,
    mapping
      .inputs
      .iter()
      .map(|id| parse::<AxisId>(id))
      .collect::<errors::Result<Vec<_>>>()?,
    mapping
      .outputs
      .iter()
      .map(|id| parse::<AxisId>(id))
      .collect::<errors::Result<Vec<_>>>()?,
    mapping
      .points
      .into_iter()
      .map(|point| {
        Ok(FontAxisMappingPoint {
          description: point.description,
          input: map_location(point.input)?,
          output: map_location(point.output)?,
        })
      })
      .collect::<errors::Result<Vec<_>>>()?,
  );
  mapped.set_description(mapping.description);
  Ok(mapped)
}

#[cfg(test)]
mod tests {
  use super::*;
  use shift_wire::bridges::napi::{
    NapiAddAnchorsIntent, NapiAddContourIntent, NapiAddPointsIntent, NapiAxis, NapiAxisRole,
    NapiAxisType, NapiCloneGlyphLayerIntent, NapiCreateAxisIntent, NapiCreateGlyphIntent,
    NapiCreateGlyphLayerIntent, NapiCreateNamedInstanceIntent, NapiCreateSourceIntent,
    NapiDeleteAxisIntent, NapiDeleteNamedInstanceIntent, NapiDeleteSourceIntent,
    NapiGlyphSnapshotRequest, NapiGlyphState, NapiLocation, NapiMoveAnchorsIntent,
    NapiMovePointsIntent, NapiNamedInstance, NapiPointSeed, NapiPointType, NapiRemoveAnchorsIntent,
    NapiRemovePointsIntent, NapiReverseContourIntent, NapiSetContourClosedIntent,
    NapiSetPointSmoothIntent, NapiSetXAdvanceIntent, NapiTranslatePointsIntent,
    NapiUpdateNamedInstanceIntent,
  };
  use std::sync::atomic::{AtomicUsize, Ordering};

  static TEST_ID: AtomicUsize = AtomicUsize::new(0);

  fn skeleton_intent(kind: &str) -> NapiFontIntent {
    NapiFontIntent {
      kind: kind.to_string(),
      add_points: None,
      add_contour: None,
      set_contour_closed: None,
      move_points: None,
      set_point_smooth: None,
      remove_points: None,
      add_anchors: None,
      move_anchors: None,
      remove_anchors: None,
      reverse_contour: None,
      translate_points: None,
      set_x_advance: None,
      apply_boolean_op: None,
      create_glyph: None,
      update_glyph: None,
      update_font_metadata: None,
      create_axis: None,
      update_axis: None,
      delete_axis: None,
      set_axis_mappings: None,
      set_metric_definitions: None,
      create_named_instance: None,
      update_named_instance: None,
      delete_named_instance: None,
      create_source: None,
      update_source: None,
      delete_source: None,
      create_glyph_layer: None,
      clone_glyph_layer: None,
      materialize_glyph_layer: None,
    }
  }

  fn create_glyph_napi(name: &str, unicodes: Vec<u32>) -> NapiFontIntent {
    NapiFontIntent {
      create_glyph: Some(NapiCreateGlyphIntent {
        glyph_id: GlyphId::new().to_string(),
        name: name.to_string(),
        unicodes,
      }),
      ..skeleton_intent("createGlyph")
    }
  }

  fn create_glyph_napi_with_id(glyph_id: &str, name: &str, unicodes: Vec<u32>) -> NapiFontIntent {
    NapiFontIntent {
      create_glyph: Some(NapiCreateGlyphIntent {
        glyph_id: glyph_id.to_string(),
        name: name.to_string(),
        unicodes,
      }),
      ..skeleton_intent("createGlyph")
    }
  }

  fn create_glyph_layer_intent(layer_id: &str, glyph_id: &str, source_id: &str) -> NapiFontIntent {
    NapiFontIntent {
      create_glyph_layer: Some(NapiCreateGlyphLayerIntent {
        layer_id: layer_id.to_string(),
        glyph_id: glyph_id.to_string(),
        source_id: source_id.to_string(),
      }),
      ..skeleton_intent("createGlyphLayer")
    }
  }

  fn clone_glyph_layer_intent(
    layer_id: &str,
    glyph_id: &str,
    source_id: &str,
    from_layer_id: &str,
  ) -> NapiFontIntent {
    NapiFontIntent {
      clone_glyph_layer: Some(NapiCloneGlyphLayerIntent {
        layer_id: layer_id.to_string(),
        glyph_id: glyph_id.to_string(),
        source_id: source_id.to_string(),
        from_layer_id: from_layer_id.to_string(),
      }),
      ..skeleton_intent("cloneGlyphLayer")
    }
  }

  #[test]
  fn apply_create_glyph_returns_identity_record_without_layers() {
    let mut bridge = bridge_with_workspace();

    let applied = bridge
      .apply(
        vec![create_glyph_napi("A", vec![65])],
        Some("Add Glyph".to_string()),
      )
      .unwrap();

    let glyphs = applied
      .next
      .expect("createGlyph must echo font replacements")
      .glyphs
      .expect("createGlyph must echo records");
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name, "A");
    assert!(glyphs[0].layers.is_empty());
    assert!(applied.layers.is_empty());
  }

  #[test]
  fn apply_create_glyph_layer_returns_record_membership_and_replace_grade_layer() {
    let mut bridge = bridge_with_workspace();
    let glyph_id = GlyphId::new().to_string();
    let layer_id = LayerId::new().to_string();
    let source_id = default_source_id(&bridge);

    let applied = bridge
      .apply(
        vec![
          create_glyph_napi_with_id(&glyph_id, "A", vec![65]),
          create_glyph_layer_intent(&layer_id, &glyph_id, &source_id),
        ],
        Some("Add Glyph".to_string()),
      )
      .unwrap();

    let glyphs = applied
      .next
      .expect("createGlyphLayer must echo font replacements")
      .glyphs
      .expect("createGlyphLayer must echo records");
    assert_eq!(glyphs[0].layers.len(), 1);
    assert_eq!(glyphs[0].layers[0].id, layer_id);
    assert_eq!(glyphs[0].layers[0].source_id, source_id);
    assert_eq!(applied.layers.len(), 1);
    assert_eq!(applied.layers[0].layer_id, layer_id);
    assert!(applied.layers[0].structure.is_some());
  }

  #[test]
  fn apply_set_x_advance_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          set_x_advance: Some(NapiSetXAdvanceIntent {
            layer_id: layer_id.clone(),
            width: 642.0,
          }),
          ..skeleton_intent("setXAdvance")
        }],
        None,
      )
      .unwrap();

    assert!(applied.next.is_none());
    assert_eq!(applied.layers[0].layer_id, layer_id);
    assert!(applied.layers[0].structure.is_none());
    // canonical values layout: x advance is slot 0
    assert_eq!(applied.layers[0].values[0], 642.0);
  }

  #[test]
  fn apply_rejects_unknown_intent_kinds() {
    let mut bridge = bridge_with_workspace();

    assert!(bridge
      .apply(vec![skeleton_intent("explodeFont")], None)
      .is_err());
  }

  fn pen_setup(bridge: &mut Bridge) -> (String, String) {
    let glyph_id = GlyphId::new().to_string();
    let layer_id = LayerId::new().to_string();
    let source_id = default_source_id(bridge);
    let created = bridge
      .apply(
        vec![
          create_glyph_napi_with_id(&glyph_id, "A", vec![65]),
          create_glyph_layer_intent(&layer_id, &glyph_id, &source_id),
        ],
        None,
      )
      .unwrap();
    assert_eq!(created.layers[0].layer_id, layer_id);

    let contour_id = shift_font::ContourId::new().to_string();
    bridge
      .apply(
        vec![NapiFontIntent {
          add_contour: Some(NapiAddContourIntent {
            layer_id: layer_id.clone(),
            contour_id: contour_id.clone(),
            closed: false,
          }),
          ..skeleton_intent("addContour")
        }],
        None,
      )
      .unwrap();

    (layer_id, contour_id)
  }

  fn seed(id: &str, x: f64, y: f64) -> NapiPointSeed {
    NapiPointSeed {
      id: id.to_string(),
      x,
      y,
      point_type: NapiPointType::OnCurve,
      smooth: false,
    }
  }

  fn add_points_intent(
    layer_id: &str,
    contour_id: &str,
    before: Option<String>,
    points: Vec<NapiPointSeed>,
  ) -> NapiFontIntent {
    NapiFontIntent {
      add_points: Some(NapiAddPointsIntent {
        layer_id: layer_id.to_string(),
        contour_id: Some(contour_id.to_string()),
        before,
        points,
      }),
      ..skeleton_intent("addPoints")
    }
  }

  #[test]
  fn apply_pen_intents_honors_client_minted_ids_and_one_atomic_echo() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();

    let applied = bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 10.0, 20.0), seed(&p2, 30.0, 40.0)],
        )],
        Some("Add Points".to_string()),
      )
      .unwrap();

    assert_eq!(applied.layers.len(), 1);
    let structure = applied.layers[0].structure.as_ref().unwrap();
    let ids: Vec<&str> = structure.contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p1.as_str(), p2.as_str()]);
    // canonical values: [xAdvance, x0, y0, x1, y1]
    assert_eq!(applied.layers[0].values[1], 10.0);
    assert_eq!(applied.layers[0].values[4], 40.0);
  }

  #[test]
  fn apply_pen_intents_inserts_before_the_anchor_point() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();
    let mid = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0), seed(&p2, 100.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          Some(p2.clone()),
          vec![seed(&mid, 50.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let structure = applied.layers[0].structure.as_ref().unwrap();
    let ids: Vec<&str> = structure.contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p1.as_str(), mid.as_str(), p2.as_str()]);
  }

  #[test]
  fn apply_pen_intents_moves_points_and_sets_smooth_and_closes() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(
        vec![
          NapiFontIntent {
            move_points: Some(NapiMovePointsIntent {
              layer_id: layer_id.clone(),
              point_ids: vec![p1.clone()],
              coords: vec![77.0, 88.0],
            }),
            ..skeleton_intent("movePoints")
          },
          NapiFontIntent {
            set_point_smooth: Some(NapiSetPointSmoothIntent {
              layer_id: layer_id.clone(),
              point_id: p1.clone(),
              smooth: true,
            }),
            ..skeleton_intent("setPointSmooth")
          },
          NapiFontIntent {
            set_contour_closed: Some(NapiSetContourClosedIntent {
              layer_id: layer_id.clone(),
              contour_id: contour_id.clone(),
              closed: true,
            }),
            ..skeleton_intent("setContourClosed")
          },
        ],
        Some("Close Contour".to_string()),
      )
      .unwrap();

    // one atomic apply → one echo, structural because smooth/closed changed
    assert_eq!(applied.layers.len(), 1);
    let structure = applied.layers[0].structure.as_ref().unwrap();
    assert!(structure.contours[0].closed);
    assert!(structure.contours[0].points[0].smooth);
    assert_eq!(applied.layers[0].values[1], 77.0);
    assert_eq!(applied.layers[0].values[2], 88.0);
  }

  #[test]
  fn apply_pen_intents_rejects_duplicate_ids_atomically() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    // second set: one valid point THEN a duplicate — whole set must reject
    let fresh = shift_font::PointId::new().to_string();
    let result = bridge.apply(
      vec![add_points_intent(
        &layer_id,
        &contour_id,
        None,
        vec![seed(&fresh, 1.0, 1.0), seed(&p1, 2.0, 2.0)],
      )],
      None,
    );
    assert!(result.is_err());

    // atomicity: the valid point from the rejected set must NOT exist
    let state = glyph_state(&mut bridge, "A");
    assert_eq!(state.structure.contours[0].points.len(), 1);
  }

  fn anchor_seed(id: &str, name: Option<&str>, x: f64, y: f64) -> NapiAnchorSeed {
    NapiAnchorSeed {
      id: id.to_string(),
      name: name.map(str::to_owned),
      x,
      y,
    }
  }

  fn add_anchors_intent(layer_id: &str, anchors: Vec<NapiAnchorSeed>) -> NapiFontIntent {
    NapiFontIntent {
      add_anchors: Some(NapiAddAnchorsIntent {
        layer_id: layer_id.to_string(),
        anchors,
      }),
      ..skeleton_intent("addAnchors")
    }
  }

  #[test]
  fn apply_add_anchors_echoes_structure_and_values_with_minted_ids() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();
    let a2 = shift_font::AnchorId::new().to_string();

    let applied = bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![
            anchor_seed(&a1, Some("top"), 250.0, 700.0),
            anchor_seed(&a2, None, 250.0, -10.0),
          ],
        )],
        Some("Add Anchors".to_string()),
      )
      .unwrap();

    assert_eq!(applied.layers.len(), 1);
    let structure = applied.layers[0].structure.as_ref().unwrap();
    let ids: Vec<&str> = structure.anchors.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, vec![a1.as_str(), a2.as_str()]);
    assert_eq!(structure.anchors[0].name.as_deref(), Some("top"));
    assert_eq!(structure.anchors[1].name, None);
    // canonical values: [xAdvance, point coords…, anchor coords…]; the
    // contour is empty, so anchors start at slot 1
    assert_eq!(
      &applied.layers[0].values[1..],
      &[250.0, 700.0, 250.0, -10.0]
    );
  }

  #[test]
  fn apply_move_anchors_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 250.0, 700.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          move_anchors: Some(NapiMoveAnchorsIntent {
            layer_id: layer_id.clone(),
            anchor_ids: vec![a1.clone()],
            coords: vec![300.0, 650.0],
          }),
          ..skeleton_intent("moveAnchors")
        }],
        None,
      )
      .unwrap();

    assert_eq!(applied.layers.len(), 1);
    assert!(applied.layers[0].structure.is_none());
    assert_eq!(&applied.layers[0].values[1..], &[300.0, 650.0]);
  }

  #[test]
  fn apply_remove_anchors_with_points_in_one_atomic_set() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let a1 = shift_font::AnchorId::new().to_string();

    // mixed same-set point+anchor adds apply atomically: one echo
    let applied = bridge
      .apply(
        vec![
          add_points_intent(&layer_id, &contour_id, None, vec![seed(&p1, 10.0, 20.0)]),
          add_anchors_intent(&layer_id, vec![anchor_seed(&a1, Some("top"), 250.0, 700.0)]),
        ],
        None,
      )
      .unwrap();
    assert_eq!(applied.layers.len(), 1);

    // a same-set failure must reject the whole set: the valid removePoints
    // must not survive a missing-anchor removeAnchors
    let missing = shift_font::AnchorId::new().to_string();
    let result = bridge.apply(
      vec![
        NapiFontIntent {
          remove_points: Some(NapiRemovePointsIntent {
            layer_id: layer_id.clone(),
            point_ids: vec![p1.clone()],
          }),
          ..skeleton_intent("removePoints")
        },
        NapiFontIntent {
          remove_anchors: Some(NapiRemoveAnchorsIntent {
            layer_id: layer_id.clone(),
            anchor_ids: vec![missing],
          }),
          ..skeleton_intent("removeAnchors")
        },
      ],
      None,
    );
    assert!(result.is_err());
    let state = glyph_state(&mut bridge, "A");
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(state.structure.anchors.len(), 1);

    // the valid mixed removal applies atomically
    let removed = bridge
      .apply(
        vec![
          NapiFontIntent {
            remove_points: Some(NapiRemovePointsIntent {
              layer_id: layer_id.clone(),
              point_ids: vec![p1.clone()],
            }),
            ..skeleton_intent("removePoints")
          },
          NapiFontIntent {
            remove_anchors: Some(NapiRemoveAnchorsIntent {
              layer_id: layer_id.clone(),
              anchor_ids: vec![a1.clone()],
            }),
            ..skeleton_intent("removeAnchors")
          },
        ],
        None,
      )
      .unwrap();
    assert_eq!(removed.layers.len(), 1);
    let state = glyph_state(&mut bridge, "A");
    assert_eq!(state.structure.contours[0].points.len(), 0);
    assert!(state.structure.anchors.is_empty());
  }

  #[test]
  fn undo_after_add_anchors_removes_them_and_redo_restores() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 250.0, 700.0)],
        )],
        Some("Add Anchor".to_string()),
      )
      .unwrap();
    assert_eq!(glyph_state(&mut bridge, "A").structure.anchors.len(), 1);

    let undone = bridge.undo().unwrap().expect("one entry to undo");
    assert_eq!(undone.layers.len(), 1);
    assert!(glyph_state(&mut bridge, "A").structure.anchors.is_empty());

    let redone = bridge.redo().unwrap().expect("one entry to redo");
    assert_eq!(redone.layers.len(), 1);
    let state = glyph_state(&mut bridge, "A");
    assert_eq!(state.structure.anchors.len(), 1);
    assert_eq!(state.structure.anchors[0].id, a1);
    assert_eq!(state.structure.anchors[0].name.as_deref(), Some("top"));
    assert_eq!(&state.values[1..], &[250.0, 700.0]);
  }

  #[test]
  fn apply_add_anchors_rejects_duplicate_ids_atomically() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let fresh = shift_font::AnchorId::new().to_string();
    let result = bridge.apply(
      vec![add_anchors_intent(
        &layer_id,
        vec![
          anchor_seed(&fresh, None, 1.0, 1.0),
          anchor_seed(&a1, None, 2.0, 2.0),
        ],
      )],
      None,
    );
    assert!(result.is_err());

    // atomicity: the valid anchor from the rejected set must NOT exist
    assert_eq!(glyph_state(&mut bridge, "A").structure.anchors.len(), 1);
  }

  fn glyph_state(bridge: &mut Bridge, name: &str) -> NapiGlyphState {
    let record = bridge
      .get_glyphs()
      .unwrap()
      .into_iter()
      .find(|record| record.name == name)
      .expect("glyph record should exist");
    let source_id = default_source_id(bridge);

    glyph_source_state(bridge, &record.id, &source_id).expect("glyph state should be readable")
  }

  fn glyph_source_state(
    bridge: &mut Bridge,
    glyph_id: &str,
    source_id: &str,
  ) -> Option<NapiGlyphState> {
    let snapshots = bridge
      .get_glyph_snapshots(vec![NapiGlyphSnapshotRequest {
        glyph_id: glyph_id.to_string(),
      }])
      .unwrap();

    snapshots
      .into_iter()
      .next()
      .and_then(|snapshot| {
        snapshot
          .layers
          .into_iter()
          .find(|layer| layer.source_id == source_id)
      })
      .map(|layer| layer.state)
  }

  fn contour_point_count(bridge: &mut Bridge) -> usize {
    glyph_state(bridge, "A")
      .structure
      .contours
      .first()
      .map(|contour| contour.points.len())
      .unwrap_or(0)
  }

  #[test]
  fn undo_restores_pre_state_and_redo_restores_post_state() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 10.0, 20.0)],
        )],
        Some("Add Point".to_string()),
      )
      .unwrap();
    assert_eq!(contour_point_count(&mut bridge), 1);

    let undone = bridge.undo().unwrap().expect("one entry to undo");
    assert_eq!(undone.layers.len(), 1);
    assert!(undone.layers[0].structure.is_some());
    assert_eq!(contour_point_count(&mut bridge), 0);

    let redone = bridge.redo().unwrap().expect("one entry to redo");
    assert_eq!(redone.layers.len(), 1);
    assert!(redone.layers[0].structure.is_some());
    assert_eq!(contour_point_count(&mut bridge), 1);
  }

  #[test]
  fn position_only_undo_redo_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = shift_font::PointId::new().to_string();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&point_id, 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();
    bridge
      .apply(
        vec![NapiFontIntent {
          move_points: Some(NapiMovePointsIntent {
            layer_id,
            point_ids: vec![point_id],
            coords: vec![30.0, 40.0],
          }),
          ..skeleton_intent("movePoints")
        }],
        None,
      )
      .unwrap();

    let undone = bridge.undo().unwrap().expect("position edit should undo");
    assert!(undone.layers[0].structure.is_none());
    assert_eq!(&undone.layers[0].values[1..3], &[10.0, 20.0]);
    assert_eq!(&glyph_state(&mut bridge, "A").values[1..3], &[10.0, 20.0]);

    let redone = bridge.redo().unwrap().expect("position edit should redo");
    assert!(redone.layers[0].structure.is_none());
    assert_eq!(&redone.layers[0].values[1..3], &[30.0, 40.0]);
    assert_eq!(&glyph_state(&mut bridge, "A").values[1..3], &[30.0, 40.0]);
  }

  #[test]
  fn undo_returns_none_when_the_ledger_is_empty() {
    let mut bridge = bridge_with_workspace();

    assert!(bridge.undo().unwrap().is_none());
    assert!(bridge.redo().unwrap().is_none());
  }

  #[test]
  fn a_fresh_apply_truncates_the_redo_stack() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();
    bridge.undo().unwrap().expect("undo the first point");

    // a new apply while redo is available must truncate it
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p2, 5.0, 5.0)],
        )],
        None,
      )
      .unwrap();

    assert!(bridge.redo().unwrap().is_none());
    assert_eq!(contour_point_count(&mut bridge), 1);
  }

  #[test]
  fn apply_remove_translate_and_reverse_intents() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();
    let p3 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![
            seed(&p1, 0.0, 0.0),
            seed(&p2, 100.0, 0.0),
            seed(&p3, 50.0, 80.0),
          ],
        )],
        None,
      )
      .unwrap();

    // translate two of three points by an affine delta (O(ids) wire)
    let translated = bridge
      .apply(
        vec![NapiFontIntent {
          translate_points: Some(NapiTranslatePointsIntent {
            layer_id: layer_id.clone(),
            point_ids: vec![p1.clone(), p2.clone()],
            dx: 10.0,
            dy: 5.0,
          }),
          ..skeleton_intent("translatePoints")
        }],
        None,
      )
      .unwrap();
    assert!(translated.layers[0].structure.is_none());
    assert_eq!(translated.layers[0].values[1], 10.0);
    assert_eq!(translated.layers[0].values[2], 5.0);

    // reverse the contour: same point ids, reversed order, structural echo
    let reversed = bridge
      .apply(
        vec![NapiFontIntent {
          reverse_contour: Some(NapiReverseContourIntent {
            layer_id: layer_id.clone(),
            contour_id: contour_id.clone(),
          }),
          ..skeleton_intent("reverseContour")
        }],
        None,
      )
      .unwrap();
    let ids: Vec<&str> = reversed.layers[0].structure.as_ref().unwrap().contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p3.as_str(), p2.as_str(), p1.as_str()]);

    // remove one point; undo restores it (ledger covers the new kinds)
    bridge
      .apply(
        vec![NapiFontIntent {
          remove_points: Some(NapiRemovePointsIntent {
            layer_id: layer_id.clone(),
            point_ids: vec![p2.clone()],
          }),
          ..skeleton_intent("removePoints")
        }],
        None,
      )
      .unwrap();
    assert_eq!(contour_point_count(&mut bridge), 2);

    bridge
      .undo()
      .unwrap()
      .expect("removePoints must be undoable");
    assert_eq!(contour_point_count(&mut bridge), 3);
  }

  fn test_paths(label: &str) -> (String, String) {
    let id = TEST_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("shift-bridge-{label}-{id}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    (
      dir.join("TestFont.shift").to_string_lossy().into_owned(),
      dir.join("working.sqlite").to_string_lossy().into_owned(),
    )
  }

  fn bridge_with_workspace() -> Bridge {
    let mut bridge = Bridge::new();
    let (_, store_path) = test_paths("workspace");
    bridge.create_untitled_workspace(store_path, None).unwrap();
    bridge
  }

  #[test]
  fn document_state_tracks_dirty_across_edits_and_saves() {
    let mut bridge = bridge_with_workspace();

    let state = bridge.document_state().unwrap();
    assert_eq!(state.source_kind, "untitled");
    assert_eq!(state.save_target, None);
    assert!(!state.dirty);
    assert!(state.needs_save_as);

    bridge
      .apply(vec![create_glyph_napi("A", vec![65])], None)
      .unwrap();

    assert!(bridge.document_state().unwrap().dirty);

    let (save_path, recovery_path) = test_paths("save-as");
    let state = bridge
      .save_workspace_as_document(save_path.clone(), recovery_path)
      .unwrap();
    assert_eq!(state.source_kind, "document");
    assert_eq!(state.save_target.as_deref(), Some(save_path.as_str()));
    assert!(!state.dirty);
    assert!(!state.needs_save_as);

    bridge
      .apply(vec![create_glyph_napi("B", vec![66])], None)
      .unwrap();

    assert!(bridge.document_state().unwrap().dirty);

    let state = bridge.save_workspace().unwrap();
    assert!(!state.dirty);
  }

  #[test]
  fn save_workspace_reports_needs_save_as_for_untitled_documents() {
    let mut bridge = bridge_with_workspace();
    bridge
      .apply(vec![create_glyph_napi("A", vec![65])], None)
      .unwrap();

    let error = bridge.save_workspace().unwrap_err();

    assert!(error.to_string().contains("workspace needs a save path"));
    let state = bridge.document_state().unwrap();
    assert!(state.dirty);
    assert!(state.needs_save_as);
  }

  #[test]
  fn get_glyphs_reads_component_references_without_payload_acquisition() {
    let source_path = Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let (_, store_path) = test_paths("component-directory");
    let mut bridge = Bridge::new();
    bridge
      .open_workspace(source_path.to_string_lossy().into_owned(), store_path)
      .unwrap();

    assert_eq!(bridge.workspace().unwrap().loaded_layer_count(), 0);
    assert!(
      bridge
        .get_glyphs()
        .unwrap()
        .iter()
        .any(|glyph| !glyph.component_base_glyph_ids.is_empty()),
      "directory records should retain component edges without loading payloads"
    );
    assert_eq!(bridge.workspace().unwrap().loaded_layer_count(), 0);
  }

  fn default_source_id(bridge: &Bridge) -> String {
    bridge.get_sources().unwrap()[0].id.clone()
  }

  fn create_default_glyph_layer(bridge: &mut Bridge, name: &str, unicode: Option<u32>) -> String {
    let glyph_id = GlyphId::new().to_string();
    let layer_id = LayerId::new().to_string();
    let source_id = default_source_id(bridge);
    let applied = bridge
      .apply(
        vec![
          create_glyph_napi_with_id(&glyph_id, name, unicode.into_iter().collect()),
          create_glyph_layer_intent(&layer_id, &glyph_id, &source_id),
        ],
        None,
      )
      .unwrap();
    assert_eq!(applied.layers[0].layer_id, layer_id);
    layer_id
  }

  fn create_axis_intent(
    axis_id: &str,
    tag: &str,
    name: &str,
    min: f64,
    default: f64,
    max: f64,
  ) -> NapiFontIntent {
    NapiFontIntent {
      create_axis: Some(NapiCreateAxisIntent {
        axis: NapiAxis {
          id: axis_id.to_string(),
          tag: tag.to_string(),
          name: name.to_string(),
          role: NapiAxisRole::External,
          axis_type: NapiAxisType::Continuous,
          minimum: Some(min),
          default,
          maximum: Some(max),
          values: None,
          labels: Vec::new(),
          hidden: false,
        },
      }),
      ..skeleton_intent("createAxis")
    }
  }

  fn delete_axis_intent(axis_id: &str) -> NapiFontIntent {
    NapiFontIntent {
      delete_axis: Some(NapiDeleteAxisIntent {
        axis_id: axis_id.to_string(),
      }),
      ..skeleton_intent("deleteAxis")
    }
  }

  fn delete_source_intent(source_id: &str) -> NapiFontIntent {
    NapiFontIntent {
      delete_source: Some(NapiDeleteSourceIntent {
        source_id: source_id.to_string(),
      }),
      ..skeleton_intent("deleteSource")
    }
  }

  fn create_source_intent(source_id: &str, name: &str, location: &[(&str, f64)]) -> NapiFontIntent {
    NapiFontIntent {
      create_source: Some(NapiCreateSourceIntent {
        source_id: source_id.to_string(),
        name: name.to_string(),
        location: NapiLocation {
          values: location
            .iter()
            .map(|(tag, value)| (tag.to_string(), *value))
            .collect(),
        },
      }),
      ..skeleton_intent("createSource")
    }
  }

  fn weight_axis_intent() -> NapiFontIntent {
    create_axis_intent("axis_weight", "wght", "Weight", 100.0, 400.0, 900.0)
  }

  fn named_instance(id: &str, name: &str, value: f64) -> NapiNamedInstance {
    NapiNamedInstance {
      id: id.to_string(),
      name: name.to_string(),
      location: NapiLocation {
        values: [("axis_weight".to_string(), value)].into_iter().collect(),
      },
      postscript_name: Some(format!("TestFont-{name}")),
    }
  }

  #[test]
  fn apply_create_axis_echoes_axes_and_sources() {
    let mut bridge = bridge_with_workspace();

    let applied = bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let next = applied
      .next
      .expect("createAxis must echo font replacements");
    let axes = next.axes.expect("createAxis must echo axes");
    assert_eq!(axes.len(), 1);
    assert_eq!(axes[0].tag, "wght");
    assert_eq!(axes[0].name, "Weight");
    assert_eq!(axes[0].minimum, Some(100.0));
    assert_eq!(axes[0].default, 400.0);
    assert_eq!(axes[0].maximum, Some(900.0));
    // locations may change shape, so sources ride along
    assert!(next.sources.is_some());
    assert!(next.glyphs.is_none());
    assert!(applied.layers.is_empty());
    assert!(bridge.is_variable().unwrap());
  }

  #[test]
  fn apply_create_axis_rejects_duplicate_tags() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let result = bridge.apply(
      vec![create_axis_intent(
        "axis_weight_again",
        "wght",
        "Weight Again",
        0.0,
        50.0,
        100.0,
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_axes().unwrap().len(), 1);
  }

  #[test]
  fn named_instance_crud_echoes_replace_grade_authoring_state() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let created = bridge
      .apply(
        vec![NapiFontIntent {
          create_named_instance: Some(NapiCreateNamedInstanceIntent {
            instance: named_instance("namedInstance_bold", "Bold", 700.0),
          }),
          ..skeleton_intent("createNamedInstance")
        }],
        None,
      )
      .unwrap();
    let instances = created
      .next
      .expect("instance creation must echo font replacements")
      .named_instances
      .expect("instance creation must echo the collection");
    assert_eq!(instances.len(), 1);
    assert_eq!(instances[0].name, "Bold");
    assert_eq!(
      instances[0].location.values.get("axis_weight"),
      Some(&700.0)
    );

    let updated = bridge
      .apply(
        vec![NapiFontIntent {
          update_named_instance: Some(NapiUpdateNamedInstanceIntent {
            instance: named_instance("namedInstance_bold", "DisplayBold", 750.0),
          }),
          ..skeleton_intent("updateNamedInstance")
        }],
        None,
      )
      .unwrap();
    assert_eq!(
      updated
        .next
        .expect("instance update must echo font replacements")
        .named_instances
        .expect("instance update must echo the collection")[0]
        .name,
      "DisplayBold"
    );
    assert_eq!(bridge.get_named_instances().unwrap()[0].name, "DisplayBold");

    let deleted = bridge
      .apply(
        vec![NapiFontIntent {
          delete_named_instance: Some(NapiDeleteNamedInstanceIntent {
            instance_id: "namedInstance_bold".to_string(),
          }),
          ..skeleton_intent("deleteNamedInstance")
        }],
        None,
      )
      .unwrap();
    assert!(deleted
      .next
      .expect("instance deletion must echo font replacements")
      .named_instances
      .expect("instance deletion must echo the collection")
      .is_empty());
  }

  #[test]
  fn apply_delete_axis_echoes_axes_and_sources() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let applied = bridge
      .apply(vec![delete_axis_intent("axis_weight")], None)
      .unwrap();

    let next = applied
      .next
      .expect("deleteAxis must echo font replacements");
    let axes = next.axes.expect("deleteAxis must echo axes");
    assert!(axes.is_empty());
    let sources = next.sources.expect("deleteAxis must echo sources");
    assert!(sources
      .iter()
      .all(|source| source.location.values.is_empty()));
    assert!(!bridge.is_variable().unwrap());
  }

  #[test]
  fn apply_create_source_echoes_sources_without_creating_layers() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let applied = bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let next = applied
      .next
      .expect("createSource must echo font replacements");
    let sources = next.sources.expect("createSource must echo sources");
    assert_eq!(sources.len(), 2);
    let bold = sources
      .iter()
      .find(|source| source.name == "Bold")
      .expect("new source must be in the echo");
    assert_eq!(bold.id, "source_bold");
    assert_eq!(bold.location.values.get("axis_weight"), Some(&700.0));
    assert!(applied.layers.is_empty());
    assert!(next.glyphs.is_none());
    assert_eq!(bridge.get_glyphs().unwrap()[0].layers.len(), 1);
  }

  #[test]
  fn apply_create_glyph_layer_resolves_layer_for_new_source() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let glyph_id = bridge.get_glyphs().unwrap()[0].id.clone();
    let layer_id = LayerId::new().to_string();

    let applied = bridge
      .apply(
        vec![create_glyph_layer_intent(
          &layer_id,
          &glyph_id,
          "source_bold",
        )],
        None,
      )
      .unwrap();

    let state = glyph_source_state(&mut bridge, &glyph_id, "source_bold")
      .expect("the explicit layer must resolve by glyph and source");
    assert_eq!(state.layer_id, layer_id);
    assert_eq!(applied.layers[0].layer_id, layer_id);
    let glyphs = applied
      .next
      .expect("layer membership must echo font replacements")
      .glyphs
      .expect("layer membership must echo glyph records");
    assert_eq!(glyphs[0].layers.len(), 2);
  }

  #[test]
  fn apply_clone_glyph_layer_copies_shape_with_fresh_internal_ids() {
    let mut bridge = bridge_with_workspace();
    let (from_layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.clone();
    let point_a = shift_font::PointId::new().to_string();
    let point_b = shift_font::PointId::new().to_string();
    let anchor_top = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![
          add_points_intent(
            &from_layer_id,
            &contour_id,
            None,
            vec![seed(&point_a, 10.0, 20.0), seed(&point_b, 30.0, 40.0)],
          ),
          add_anchors_intent(
            &from_layer_id,
            vec![anchor_seed(&anchor_top, Some("top"), 15.0, 70.0)],
          ),
        ],
        None,
      )
      .unwrap();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let layer_id = LayerId::new().to_string();
    let applied = bridge
      .apply(
        vec![clone_glyph_layer_intent(
          &layer_id,
          &glyph_id,
          "source_bold",
          &from_layer_id,
        )],
        None,
      )
      .unwrap();

    let source_id = default_source_id(&bridge);
    let source = glyph_source_state(&mut bridge, &glyph_id, &source_id)
      .expect("source layer should be readable");
    let cloned = glyph_source_state(&mut bridge, &glyph_id, "source_bold")
      .expect("cloned layer should be readable");

    assert_eq!(applied.layers[0].layer_id, layer_id);
    assert_eq!(cloned.layer_id, layer_id);
    assert_eq!(cloned.values.len(), source.values.len());
    for index in 0..cloned.values.len() {
      assert_eq!(cloned.values[index], source.values[index]);
    }
    assert_eq!(
      cloned.structure.contours.len(),
      source.structure.contours.len()
    );
    assert_eq!(
      cloned.structure.contours[0].points.len(),
      source.structure.contours[0].points.len()
    );
    assert_ne!(
      cloned.structure.contours[0].points[0].id,
      source.structure.contours[0].points[0].id
    );
    assert_ne!(
      cloned.structure.anchors[0].id,
      source.structure.anchors[0].id
    );
  }

  #[test]
  fn apply_create_source_rejects_unknown_axis_ids() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let result = bridge.apply(
      vec![create_source_intent(
        "source_wide",
        "Wide",
        &[("axis_width", 125.0)],
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
  }

  #[test]
  fn apply_create_source_rejects_duplicate_source_names() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    // the untitled workspace already has a "Regular" source
    let result = bridge.apply(
      vec![create_source_intent(
        "source_regular_duplicate",
        "Regular",
        &[],
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
  }

  #[test]
  fn apply_create_source_rejects_duplicate_source_ids() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let result = bridge.apply(
      vec![create_source_intent(
        "source_bold",
        "Bold Again",
        &[("axis_weight", 800.0)],
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 2);
  }

  #[test]
  fn apply_delete_source_echoes_sources_and_removes_layers() {
    let mut bridge = bridge_with_workspace();
    let default_layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.clone();
    let bold_layer_id = LayerId::new().to_string();
    bridge
      .apply(
        vec![create_glyph_layer_intent(
          &bold_layer_id,
          &glyph_id,
          "source_bold",
        )],
        None,
      )
      .unwrap();
    assert!(glyph_source_state(&mut bridge, &glyph_id, "source_bold").is_some());

    let applied = bridge
      .apply(vec![delete_source_intent("source_bold")], None)
      .unwrap();

    let next = applied
      .next
      .expect("deleteSource must echo font replacements");
    let sources = next.sources.expect("deleteSource must echo sources");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].name, "Regular");
    let glyphs = next
      .glyphs
      .expect("deleteSource layer removal must echo glyph records");
    assert_eq!(glyphs[0].layers.len(), 1);
    assert!(applied.layers.is_empty());
    assert!(glyph_source_state(&mut bridge, &glyph_id, "source_bold").is_none());
    let source_id = default_source_id(&bridge);
    let default_state = glyph_source_state(&mut bridge, &glyph_id, &source_id)
      .expect("default source must keep its layer");
    assert_eq!(default_state.layer_id, default_layer_id);
  }

  #[test]
  fn apply_delete_source_rejects_last_source() {
    let mut bridge = bridge_with_workspace();
    let source_id = default_source_id(&bridge);

    let result = bridge.apply(vec![delete_source_intent(&source_id)], None);

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
  }

  #[test]
  fn apply_create_glyph_does_not_emit_layers_for_sources() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(vec![create_glyph_napi("A", vec![65])], None)
      .unwrap();

    assert!(applied.layers.is_empty());
    let glyphs = applied
      .next
      .expect("createGlyph must echo font replacements")
      .glyphs
      .expect("createGlyph must echo records");
    assert!(glyphs[0].layers.is_empty());
  }

  #[test]
  fn apply_mixes_editing_and_create_intents_as_one_undo_step() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);

    let applied = bridge
      .apply(
        vec![
          weight_axis_intent(),
          NapiFontIntent {
            set_x_advance: Some(NapiSetXAdvanceIntent {
              layer_id: layer_id.clone(),
              width: 600.0,
            }),
            ..skeleton_intent("setXAdvance")
          },
        ],
        Some("Add Weight".to_string()),
      )
      .unwrap();

    assert_eq!(
      applied
        .next
        .expect("createAxis must echo font replacements")
        .axes
        .expect("createAxis must echo axes")
        .len(),
      1
    );
    assert!(applied
      .layers
      .iter()
      .any(|layer| layer.layer_id == layer_id));

    let undone = bridge.undo().unwrap().expect("mixed set should undo");
    assert!(bridge.get_axes().unwrap().is_empty());
    assert_eq!(
      undone
        .next
        .expect("undo must echo font replacements")
        .axes
        .expect("undo must echo axes")
        .len(),
      0
    );
  }

  #[test]
  fn new_bridge_requires_workspace_before_font_reads() {
    let bridge = Bridge::new();

    let error = match bridge.get_metadata() {
      Ok(_) => panic!("metadata read should require an open workspace"),
      Err(error) => error,
    };

    assert!(error.to_string().contains("no workspace is open"));
  }

  #[test]
  fn create_untitled_workspace_exposes_empty_font_state() {
    let bridge = bridge_with_workspace();

    let metadata = bridge.get_metadata().unwrap();
    let metrics = bridge.get_metrics().unwrap();

    assert!(bridge.get_glyphs().unwrap().is_empty());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
    assert_eq!(bridge.get_sources().unwrap()[0].name, "Regular");
    assert_eq!(metadata.family_name.as_deref(), Some("Untitled Font"));
    assert_eq!(metadata.style_name.as_deref(), Some("Regular"));
    assert_eq!(metrics.units_per_em, 1000.0);
    assert_eq!(bridge.get_metric_definitions().unwrap().len(), 5);
    assert_eq!(bridge.get_sources().unwrap()[0].metric_values.len(), 5);
  }

  #[test]
  fn create_untitled_workspace_resets_to_fresh_font_state() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));

    let (_, store_path) = test_paths("reset");
    bridge.create_untitled_workspace(store_path, None).unwrap();

    assert!(bridge.get_glyphs().unwrap().is_empty());
    assert!(bridge.get_axes().unwrap().is_empty());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
    assert_eq!(bridge.get_sources().unwrap()[0].name, "Regular");
  }

  #[test]
  fn save_snapshot_includes_applied_glyph_edits() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = shift_font::PointId::new().to_string();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&point_id, 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();

    let snapshot = bridge.save_snapshot().unwrap();
    let glyph = snapshot
      .glyph("A")
      .expect("snapshot should include edited A");
    let layer = glyph
      .layer_for_source(snapshot.default_source_id().unwrap())
      .expect("edited glyph should include default layer");

    assert_eq!(bridge.get_glyphs().unwrap().len(), 1);
    assert_eq!(glyph.unicodes(), &[65]);
    assert_eq!(layer.contours().len(), 1);
    assert_eq!(
      layer.contours().values().next().unwrap().points()[0]
        .id()
        .to_string(),
      point_id
    );
  }

  #[test]
  fn get_glyph_snapshots_read_applied_edits() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = shift_font::PointId::new().to_string();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&point_id, 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();

    let state = glyph_state(&mut bridge, "A");

    assert_eq!(state.layer_id, layer_id);
    assert_eq!(state.structure.contours.len(), 1);
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(&state.values[..], &[500.0, 10.0, 20.0]);
  }

  #[test]
  fn get_glyph_snapshots_returns_none_for_missing_glyph() {
    let mut bridge = bridge_with_workspace();
    let missing_glyph_id = shift_font::GlyphId::new().to_string();

    let snapshots = bridge
      .get_glyph_snapshots(vec![NapiGlyphSnapshotRequest {
        glyph_id: missing_glyph_id,
      }])
      .unwrap();

    assert!(snapshots.is_empty());
  }

  #[test]
  fn get_glyph_projections_returns_location_independent_shape_backing() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph = bridge.get_glyphs().unwrap().remove(0);
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&shift_font::PointId::new().to_string(), 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();

    let projections = bridge
      .get_glyph_projections(vec![glyph.id.to_string()])
      .unwrap();

    assert_eq!(projections.len(), 1);
    assert_eq!(projections[0].glyph_id, glyph.id.to_string());
    assert_eq!(
      projections[0].fallback.values.as_ref(),
      &[500.0, 10.0, 20.0]
    );
  }

  #[test]
  fn get_glyph_previews_resolve_drawable_paths_at_a_location() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph = bridge.get_glyphs().unwrap().remove(0);
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![
            seed(&shift_font::PointId::new().to_string(), 10.0, 20.0),
            seed(&shift_font::PointId::new().to_string(), 90.0, 20.0),
          ],
        )],
        None,
      )
      .unwrap();
    let missing_glyph_id = shift_font::GlyphId::new().to_string();

    let previews = bridge
      .get_glyph_previews(
        vec![glyph.id.to_string(), missing_glyph_id],
        NapiLocation {
          values: std::collections::HashMap::new(),
        },
      )
      .unwrap();

    assert_eq!(previews.len(), 1);
    assert_eq!(previews[0].glyph_id, glyph.id.to_string());
    assert_eq!(previews[0].x_advance, 500.0);
    assert!(previews[0].svg_path.starts_with('M'));
  }

  #[test]
  fn apply_requires_valid_layer_id() {
    let mut bridge = bridge_with_workspace();

    let result = bridge.apply(
      vec![NapiFontIntent {
        add_contour: Some(NapiAddContourIntent {
          layer_id: "not-a-layer-id".to_string(),
          contour_id: shift_font::ContourId::new().to_string(),
          closed: false,
        }),
        ..skeleton_intent("addContour")
      }],
      None,
    );

    assert!(matches!(
      result.err().unwrap(),
      BridgeError::InvalidInput {
        kind: "layer ID",
        ..
      }
    ));
  }
}
