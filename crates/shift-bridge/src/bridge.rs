use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::{parse, parse_id_list};
use crate::reply::{PackedReply, answer};
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{
  AxisIndex as SourceAxisIndex, DirectoryGlyph, DirectoryInstance, DirectorySource, ExportFormat,
  FontDirectory, FontExportRequest, FontExportResult, FontExporter, FontSource, FontView,
  GlyphIndex, GlyphPointKind as SourceGlyphPointKind, GlyphProjection as SourceGlyphProjection,
  GlyphShape as SourceGlyphShape, OpenedFont, SourceAtlasDescriptor, SourceGlyphIds,
  VariationAxisKind, font_loader::FontLoader,
};
use shift_font::composite::resolved_contours_to_svg_path;
use shift_font::{
  AnchorId, Axis as FontAxis, AxisId, AxisMapping as FontAxisMapping, AxisMappingId,
  AxisMappingPoint as FontAxisMappingPoint, ComponentId, ContourId, Font, Glyph, GlyphId,
  GlyphLayer, LayerId, Location as FontLocation, MetricId, MetricKind, NamedInstanceId, PointId,
  SourceId,
};
use shift_shaper_font::{LiveShaper, ShaperFontRequest, ShaperFontState};
use shift_slug::{AuthoredAtlasProfile, VariableAtlas};
use shift_wire::bridges::napi::IntoEach;
use shift_wire::values;
use shift_wire::{
  AnchorData, ComponentData, ComponentGlyph, ComponentTransformKind, ContourData, FontMetadata,
  FontMetrics, FontSnapshot, GlyphComponents, GlyphEntry, GlyphLayerShape, GlyphLayerSnapshot,
  GlyphProjection, GlyphSnapshot, GlyphSnapshotRequest, GlyphSourceComponents, GlyphSourceShape,
  GlyphState, GlyphStructure, GlyphVariation, InterpolationSupport, LayerMatch as WireLayerMatch,
  Location as WireLocation, MetricDefinition, NamedInstance, PointData, PointType, VariationBasis,
  VariationDelta,
  bridges::napi::{
    NapiGlyphPreview, NapiGlyphProjection, NapiGlyphSnapshot, NapiGlyphSnapshotRequest,
    NapiLayerMatch, NapiLayerRead,
  },
};
use shift_workspace::{AcquireScope, FontWorkspace, WorkspaceError};
use std::{
  collections::{BTreeMap, HashMap, HashSet, VecDeque},
  iter,
  path::Path,
  sync::Arc,
  time::Duration,
};

mod atlas;
mod shaping;
mod source;
mod workspace;

use atlas::native_atlas_request;
use shaping::native_shaping_request;
use source::native_source_request;
use workspace::native_workspace_request;

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

struct SlugAtlasGeneration {
  generation: u32,
  alignment: usize,
  atlas: VariableAtlas,
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

/// A font source opened for browsing, with the ids the bridge gave its entries.
struct RetainedSource {
  font: OpenedFont,
  identity: SourceIdentity,
}

impl RetainedSource {
  fn open(path: &Path) -> BridgeResult<Self> {
    let font = FontLoader::new().open_source(path)?;
    let identity = SourceIdentity::new(font.directory(), &SourceGlyphIds::for_path(path))?;
    Ok(Self { font, identity })
  }

  /// The font snapshot the editor shows for the retained source.
  fn snapshot(&self) -> BridgeResult<FontSnapshot> {
    let directory = self.font.directory();
    let ids = &self.identity;
    Ok(FontSnapshot {
      metadata: FontMetadata {
        family_name: directory.family_name().map(str::to_string),
        style_name: directory.style_name().map(str::to_string),
        ..Default::default()
      },
      metrics: FontMetrics {
        units_per_em: directory.metrics().units_per_em,
      },
      metric_definitions: ids.wire(&ids.metric_ids, &MetricKind::STANDARD),
      glyphs: ids.wire(&ids.glyph_ids, directory.glyphs()),
      sources: ids.wire(&ids.source_ids, directory.sources()),
      named_instances: ids.wire(&ids.instance_ids, directory.instances()),
      axes: ids.font_axes.to_vec(),
      axis_mappings: ids.axis_mappings_of(directory)?.iter().into_each(),
      axis_mapping_bases: ids.mapping_bases.iter().into_each(),
      // A preview reads only its source's directory: no lib, kerning or
      // metric interpolation.
      ..Default::default()
    })
  }

  /// Maps external axis coordinates, in source axis order, to design values.
  fn location(&self, coordinates: Vec<f64>) -> BridgeResult<Vec<f64>> {
    let identity = &self.identity;
    if coordinates.len() != self.font.directory().axes().len() {
      return Err(BridgeError::InvalidInput {
        kind: "catalog location coordinate count",
        value: coordinates.len().to_string(),
      });
    }

    let external = shift_font::ExternalLocation::from_map(identity.axis_values(coordinates));
    let design = shift_font::ir::variation::map_location_with_bases(
      &external,
      &identity.font_axes,
      &identity.mapping_bases,
    )?;
    Ok(
      identity
        .font_axes
        .iter()
        .map(|axis| design.value_on(axis))
        .collect(),
    )
  }

  /// Projects one source glyph and its complete component closure.
  fn glyph(&self, glyph_id: GlyphId) -> BridgeResult<Vec<GlyphSnapshot>> {
    let identity = &self.identity;
    let projected = self.font.glyph(identity.glyph_index(glyph_id)?)?;
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
        let fallback = self.shape(&projection.fallback, &ShapeIds::fallback(glyph_id))?;
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
                    let axis_id = identity.axis_id(support.axis)?;
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
            let source_id = identity.source_id(exact.source)?;
            Ok(GlyphSourceShape {
              source_id,
              shape: self.shape(&exact.shape, &ShapeIds::exact(glyph_id, exact.source))?,
            })
          })
          .collect::<BridgeResult<Vec<_>>>()?;
        let components = self.components(projection.glyph, None, &by_index)?;
        let exact_source_components = exact_sources
          .iter()
          .map(|source| {
            let source_id = identity.source_id(*source)?;
            Ok(GlyphSourceComponents {
              source_id,
              components: self.components(projection.glyph, Some(*source), &by_index)?,
            })
          })
          .collect::<BridgeResult<Vec<_>>>()?;
        Ok(GlyphSnapshot {
          glyph_id,
          projection: Some(GlyphProjection {
            glyph_id,
            fallback,
            interpolation: None,
            decomposition: None,
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

  /// Converts one projected shape, naming its entities with `ids`.
  fn shape(&self, shape: &SourceGlyphShape, ids: &ShapeIds) -> BridgeResult<GlyphLayerShape> {
    let mut point_index = 0_usize;
    let contours = shape
      .contours
      .iter()
      .enumerate()
      .map(|(contour_index, contour)| {
        let contour_id = ids.contour(contour_index);
        let points = contour
          .points
          .iter()
          .map(|point| {
            let id = ids.point(point_index);
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
        id: ids.anchor(index).to_string(),
        name: name.clone(),
      })
      .collect();
    let components = shape
      .components
      .iter()
      .enumerate()
      .map(|(index, component)| {
        let base_glyph_id = self.identity.glyph_id(component.glyph)?;
        let base_glyph_name = self
          .font
          .directory()
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
          id: ids.component(index).to_string(),
          base_glyph_id,
          base_glyph_name,
          alignment: Default::default(),
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

  /// Lists the component occurrences under `root`, depth first, on the exact
  /// source's shapes when there is one and the fallback shapes otherwise.
  fn components(
    &self,
    root: GlyphIndex,
    exact_source: Option<shift_backends::SourceIndex>,
    projections: &HashMap<GlyphIndex, &SourceGlyphProjection>,
  ) -> BridgeResult<GlyphComponents> {
    let mut walker = ComponentWalker {
      identity: &self.identity,
      projections,
      exact_source,
      output: Vec::new(),
      visiting: HashSet::new(),
    };
    walker.visit(root, Vec::new())?;
    Ok(GlyphComponents {
      root_glyph_id: self.identity.glyph_id(root)?,
      components: walker.output,
    })
  }
}

/// Walks a source glyph's component graph, rejecting cycles.
struct ComponentWalker<'a> {
  identity: &'a SourceIdentity,
  projections: &'a HashMap<GlyphIndex, &'a SourceGlyphProjection>,
  exact_source: Option<shift_backends::SourceIndex>,
  output: Vec<ComponentGlyph>,
  visiting: HashSet<GlyphIndex>,
}

impl ComponentWalker<'_> {
  fn visit(&mut self, glyph: GlyphIndex, parent_path: Vec<ComponentId>) -> BridgeResult<()> {
    if !self.visiting.insert(glyph) {
      return Err(BridgeError::InvalidInput {
        kind: "source component graph",
        value: format!("cycle at glyph {}", glyph.to_u32()),
      });
    }
    let projection = self
      .projections
      .get(&glyph)
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source component closure",
        value: glyph.to_u32().to_string(),
      })?;
    let parent_glyph_id = self.identity.glyph_id(glyph)?;
    let exact = self.exact_source.and_then(|source| {
      projection
        .exact_shapes
        .iter()
        .find(|shape| shape.source == source)
        .map(|shape| (source, &shape.shape))
    });
    let (ids, shape) = match exact {
      Some((source, shape)) => (ShapeIds::exact(parent_glyph_id, source), shape),
      None => (ShapeIds::fallback(parent_glyph_id), &projection.fallback),
    };
    for (index, component) in shape.components.iter().enumerate() {
      let component_id = ids.component(index);
      let mut component_path = parent_path.clone();
      component_path.push(component_id.clone());
      self.output.push(ComponentGlyph {
        parent_glyph_id,
        component_id,
        component_index: index,
        base_glyph_id: self.identity.glyph_id(component.glyph)?,
        parent_path: parent_path.clone(),
        component_path: component_path.clone(),
      });
      self.visit(component.glyph, component_path)?;
    }
    self.visiting.remove(&glyph);
    Ok(())
  }
}

/// Names the entities of one projected source shape.
///
/// Retained sources have no stored entity ids, so each id is derived from
/// the glyph, the shape it belongs to, and the entity's position: the same
/// entity gets the same id every time the glyph is read.
struct ShapeIds {
  glyph_id: GlyphId,
  selector: String,
}

impl ShapeIds {
  /// Ids for the glyph's fallback shape.
  fn fallback(glyph_id: GlyphId) -> Self {
    Self {
      glyph_id,
      selector: "fallback".to_string(),
    }
  }

  /// Ids for the glyph's shape on one exact source.
  fn exact(glyph_id: GlyphId, source: shift_backends::SourceIndex) -> Self {
    Self {
      glyph_id,
      selector: format!("source{}", source.to_u32()),
    }
  }

  fn contour(&self, index: usize) -> ContourId {
    ContourId::from_raw(self.entity('c', index))
  }

  /// Points are numbered across the whole shape, not per contour.
  fn point(&self, index: usize) -> PointId {
    PointId::from_raw(self.entity('p', index))
  }

  fn anchor(&self, index: usize) -> AnchorId {
    AnchorId::from_raw(self.entity('a', index))
  }

  fn component(&self, index: usize) -> ComponentId {
    ComponentId::from_raw(self.entity('m', index))
  }

  fn entity(&self, kind: char, index: usize) -> String {
    format!("{}-{}-{kind}{index}", self.glyph_id, self.selector)
  }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct DocumentVersion(u64);

impl DocumentVersion {
  fn next(self) -> Self {
    Self(self.0 + 1)
  }
}

#[derive(Clone)]
pub(crate) struct FontSaveSnapshot {
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

  fn glyphs(&self) -> impl Iterator<Item = &Glyph> {
    let active_glyph = self.active_glyph_override.as_deref();
    let override_name = active_glyph.map(Glyph::name);

    active_glyph.into_iter().chain(
      self
        .font
        .glyphs()
        .filter(move |glyph| override_name != Some(glyph.name())),
    )
  }

  fn glyph(&self, name: &str) -> Option<&Glyph> {
    if let Some(active_glyph) = self.active_glyph_override.as_ref()
      && active_glyph.name() == name
    {
      return Some(active_glyph.as_ref());
    }

    self.font.glyph_by_name(name)
  }

  fn kerning(&self) -> &shift_font::Kerning {
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

/// Converts a retained source's directory entry or standard metric row to its
/// wire form, given the id the bridge minted for it.
///
/// `From` cannot carry the id or the identity's axis order, so each entry type
/// converts through this instead.
trait ToWire {
  type Id;
  type Wire;

  fn to_wire(&self, id: &Self::Id, identity: &SourceIdentity) -> Self::Wire;
}

impl ToWire for MetricKind {
  type Id = MetricId;
  type Wire = MetricDefinition;

  fn to_wire(&self, id: &MetricId, _identity: &SourceIdentity) -> MetricDefinition {
    MetricDefinition {
      id: *id,
      kind: (*self).into(),
      name: self.default_name().into(),
    }
  }
}

impl ToWire for DirectoryGlyph {
  type Id = GlyphId;
  type Wire = GlyphEntry;

  fn to_wire(&self, id: &GlyphId, _identity: &SourceIdentity) -> GlyphEntry {
    GlyphEntry {
      id: *id,
      name: self.name.clone().into(),
      unicodes: self.unicodes.to_vec(),
    }
  }
}

impl ToWire for DirectorySource {
  type Id = SourceId;
  type Wire = shift_font::Source;

  fn to_wire(&self, id: &SourceId, identity: &SourceIdentity) -> shift_font::Source {
    let metrics = &self.metrics;
    let location =
      shift_font::DesignLocation::from_map(identity.axis_values(self.location.iter().copied()));
    let mut source =
      shift_font::Source::with_id(*id, self.name.clone(), location, self.filename.clone());
    source.set_metric_values(
      identity
        .metric_ids
        .iter()
        .zip(MetricKind::STANDARD)
        .filter_map(|(metric_id, kind)| {
          Some((
            *metric_id,
            shift_font::MetricValue::new(metrics.position(kind)?, 0.0),
          ))
        })
        .collect(),
    );
    source.set_italic_angle(metrics.italic_angle);
    source.set_line_gap(Some(metrics.line_gap));
    source.set_underline_position(metrics.underline_position);
    source.set_underline_thickness(metrics.underline_thickness);
    source
  }
}

impl ToWire for DirectoryInstance {
  type Id = NamedInstanceId;
  type Wire = NamedInstance;

  fn to_wire(&self, id: &NamedInstanceId, identity: &SourceIdentity) -> NamedInstance {
    NamedInstance {
      id: *id,
      name: self.name.clone(),
      location: identity.location(&self.location),
      postscript_name: self.postscript_name.clone(),
    }
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
  fn new(directory: &FontDirectory, glyph_ids: &SourceGlyphIds) -> BridgeResult<Self> {
    let glyph_ids = directory
      .glyphs()
      .iter()
      .map(|glyph| glyph_ids.glyph_id(&glyph.name))
      .collect::<Vec<_>>()
      .into_boxed_slice();
    let glyph_indices = glyph_ids
      .iter()
      .copied()
      .enumerate()
      .map(|(index, glyph_id)| (glyph_id, GlyphIndex::at(index)))
      .collect();
    let mut identity = Self {
      glyph_ids,
      glyph_indices,
      axis_ids: iter::repeat_with(AxisId::new)
        .take(directory.axes().len())
        .collect(),
      source_ids: iter::repeat_with(SourceId::new)
        .take(directory.sources().len())
        .collect(),
      mapping_ids: iter::repeat_with(AxisMappingId::new)
        .take(directory.mappings().len())
        .collect(),
      instance_ids: iter::repeat_with(NamedInstanceId::new)
        .take(directory.instances().len())
        .collect(),
      metric_ids: iter::repeat_with(MetricId::new)
        .take(MetricKind::STANDARD.len())
        .collect(),
      font_axes: Box::new([]),
      mapping_bases: Box::new([]),
    };
    identity.font_axes = identity.axes_of(directory).into_boxed_slice();
    identity.mapping_bases = identity
      .axis_mappings_of(directory)?
      .iter()
      .map(|mapping| shift_font::AxisMappingBasis::try_from((mapping, identity.font_axes.as_ref())))
      .collect::<std::result::Result<Vec<_>, _>>()?
      .into_boxed_slice();
    Ok(identity)
  }

  /// Builds the font axes of `directory` under this identity's axis ids.
  fn axes_of(&self, directory: &FontDirectory) -> Vec<FontAxis> {
    directory
      .axes()
      .iter()
      .zip(self.axis_ids.iter())
      .map(|(axis, id)| {
        let mut mapped = match &axis.kind {
          VariationAxisKind::Continuous {
            minimum,
            default,
            maximum,
          } => FontAxis::continuous_with_id(
            *id,
            axis.tag.clone(),
            axis.name.clone(),
            *minimum,
            *default,
            *maximum,
          ),
          VariationAxisKind::Discrete { values, default } => FontAxis::discrete_with_id(
            *id,
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

  /// Builds the axis mappings of `directory` under this identity's ids.
  fn axis_mappings_of(&self, directory: &FontDirectory) -> BridgeResult<Vec<FontAxisMapping>> {
    directory
      .mappings()
      .iter()
      .zip(self.mapping_ids.iter())
      .map(|(mapping, mapping_id)| {
        let input_axis_ids = mapping
          .input_axes
          .iter()
          .map(|axis| self.axis_id(*axis))
          .collect::<BridgeResult<Vec<_>>>()?;
        let output_axis_ids = mapping
          .output_axes
          .iter()
          .map(|axis| self.axis_id(*axis))
          .collect::<BridgeResult<Vec<_>>>()?;
        let points = mapping
          .points
          .iter()
          .map(|point| FontAxisMappingPoint {
            description: point.description.clone(),
            input: FontLocation::from_map(
              input_axis_ids
                .iter()
                .copied()
                .zip(point.input.iter().copied()),
            ),
            output: FontLocation::from_map(
              output_axis_ids
                .iter()
                .copied()
                .zip(point.output.iter().copied()),
            ),
          })
          .collect();
        let mut mapped = FontAxisMapping::with_id(
          *mapping_id,
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

  /// Pairs positional values, in source axis order, with this identity's axis ids.
  fn axis_values(
    &self,
    values: impl IntoIterator<Item = f64>,
  ) -> impl Iterator<Item = (AxisId, f64)> {
    self.axis_ids.iter().copied().zip(values)
  }

  /// A location from positional values in source axis order.
  fn location(&self, values: &[f64]) -> WireLocation {
    WireLocation {
      values: self.axis_values(values.iter().copied()).collect(),
    }
  }

  /// Each directory entry with the id the bridge gave it, in wire form.
  fn wire<T: ToWire>(&self, ids: &[T::Id], entries: &[T]) -> Vec<T::Wire> {
    ids
      .iter()
      .zip(entries)
      .map(|(id, entry)| entry.to_wire(id, self))
      .collect()
  }

  fn glyph_id(&self, index: GlyphIndex) -> BridgeResult<GlyphId> {
    self
      .glyph_ids
      .get(index.to_usize())
      .copied()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source glyph index",
        value: index.to_u32().to_string(),
      })
  }

  /// Returns the font axis id at a retained source's axis index.
  ///
  /// # Errors
  ///
  /// Returns [`BridgeError::InvalidInput`] when the index is outside the source's axes.
  fn axis_id(&self, axis: SourceAxisIndex) -> BridgeResult<AxisId> {
    self
      .axis_ids
      .get(axis.to_usize())
      .copied()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source axis index",
        value: axis.to_u32().to_string(),
      })
  }

  /// Returns the font source id at a retained source index.
  ///
  /// # Errors
  ///
  /// Returns [`BridgeError::InvalidInput`] when the index is outside the source's sources.
  fn source_id(&self, source: shift_backends::SourceIndex) -> BridgeResult<SourceId> {
    self
      .source_ids
      .get(source.to_usize())
      .copied()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "source index",
        value: source.to_u32().to_string(),
      })
  }

  fn glyph_index(&self, glyph_id: GlyphId) -> BridgeResult<GlyphIndex> {
    self
      .glyph_indices
      .get(&glyph_id)
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
  retained_source: Option<RetainedSource>,
  live_version: DocumentVersion,
  saved_version: DocumentVersion,
  slug_generation: u32,
  slug_atlas: Option<SlugAtlasGeneration>,
  source_atlas_descriptors: BTreeMap<u32, SourceAtlasDescriptor>,
  shaper_fonts: ShaperFontState,
  /// Shaper for the current font; `None` until the next shape after a change.
  shaper: Option<LiveShaper>,
}

#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      workspace: None,
      retained_source: None,
      live_version: DocumentVersion::default(),
      saved_version: DocumentVersion::default(),
      slug_generation: 0,
      slug_atlas: None,
      source_atlas_descriptors: BTreeMap::new(),
      shaper_fonts: ShaperFontState::default(),
      shaper: None,
    }
  }

  /// Answers one [`workspace::NativeWorkspace`] request, as its generated
  /// client encoded it: the method's index, its numbers, and its blobs, the
  /// last of them the names it uses. A failure is in the reply, as the
  /// method's error.
  ///
  /// # Errors
  ///
  /// Fails only when JavaScript cannot allocate the reply.
  #[napi(
    ts_args_type = "method: number, numbers: Float64Array, blobs: readonly Uint8Array[]",
    ts_return_type = "{ numbers: Float64Array; blobs: Uint8Array[] }"
  )]
  pub fn workspace_request<'env>(
    &mut self,
    env: &'env Env,
    method: u32,
    numbers: Float64ArraySlice<'_>,
    blobs: Vec<Uint8ArraySlice<'_>>,
  ) -> Result<PackedReply<'env>> {
    answer(env, &numbers, &blobs, |input, blobs, names| {
      native_workspace_request(self, method, input, blobs, names)
    })
  }

  /// Answers one [`atlas::NativeAtlas`] request, as
  /// [`Self::workspace_request`] answers a workspace one.
  ///
  /// # Errors
  ///
  /// Fails only when JavaScript cannot allocate the reply.
  #[napi(
    ts_args_type = "method: number, numbers: Float64Array, blobs: readonly Uint8Array[]",
    ts_return_type = "{ numbers: Float64Array; blobs: Uint8Array[] }"
  )]
  pub fn atlas_request<'env>(
    &mut self,
    env: &'env Env,
    method: u32,
    numbers: Float64ArraySlice<'_>,
    blobs: Vec<Uint8ArraySlice<'_>>,
  ) -> Result<PackedReply<'env>> {
    answer(env, &numbers, &blobs, |input, blobs, names| {
      native_atlas_request(self, method, input, blobs, names)
    })
  }

  /// Answers one [`source::NativeSource`] request, as
  /// [`Self::workspace_request`] answers a workspace one.
  ///
  /// # Errors
  ///
  /// Fails only when JavaScript cannot allocate the reply.
  #[napi(
    ts_args_type = "method: number, numbers: Float64Array, blobs: readonly Uint8Array[]",
    ts_return_type = "{ numbers: Float64Array; blobs: Uint8Array[] }"
  )]
  pub fn source_request<'env>(
    &mut self,
    env: &'env Env,
    method: u32,
    numbers: Float64ArraySlice<'_>,
    blobs: Vec<Uint8ArraySlice<'_>>,
  ) -> Result<PackedReply<'env>> {
    answer(env, &numbers, &blobs, |input, blobs, names| {
      native_source_request(self, method, input, blobs, names)
    })
  }

  /// Answers one [`shaping::NativeShaping`] request, as
  /// [`Self::workspace_request`] answers a workspace one.
  ///
  /// # Errors
  ///
  /// Fails only when JavaScript cannot allocate the reply.
  #[napi(
    ts_args_type = "method: number, numbers: Float64Array, blobs: readonly Uint8Array[]",
    ts_return_type = "{ numbers: Float64Array; blobs: Uint8Array[] }"
  )]
  pub fn shaping_request<'env>(
    &mut self,
    env: &'env Env,
    method: u32,
    numbers: Float64ArraySlice<'_>,
    blobs: Vec<Uint8ArraySlice<'_>>,
  ) -> Result<PackedReply<'env>> {
    answer(env, &numbers, &blobs, |input, blobs, names| {
      native_shaping_request(self, method, input, blobs, names)
    })
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

  /// Builds the thumbnail specimen for a font file, independent of any
  /// document or preview this bridge holds.
  ///
  /// Resolves to `null` when the font draws nothing usable; rejects when the
  /// file cannot be read or compiled.
  #[allow(clippy::unused_self, reason = "a JavaScript instance method")]
  #[napi(ts_return_type = "Promise<NapiSpecimen | null>")]
  pub fn font_file_specimen(&self, path: String) -> AsyncTask<crate::specimen::SpecimenTask> {
    AsyncTask::new(crate::specimen::SpecimenTask {
      input: crate::specimen::SpecimenInput::Path(std::path::PathBuf::from(path)),
    })
  }

  /// Builds the thumbnail specimen from the open document's current state.
  ///
  /// Resolves to `null` when the font draws nothing usable; rejects when no
  /// workspace is open or compilation fails.
  #[napi(ts_return_type = "Promise<NapiSpecimen | null>")]
  pub fn document_specimen(&mut self) -> Result<AsyncTask<crate::specimen::SpecimenTask>> {
    Ok(AsyncTask::new(crate::specimen::SpecimenTask {
      input: crate::specimen::SpecimenInput::Snapshot(
        self
          .specimen_snapshot()
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?,
      ),
    }))
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
      .map(|request| request.glyph_id)
      .collect::<Vec<_>>();
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::Glyphs)?;
    let mut snapshots = Vec::new();
    for request in requests {
      let glyph_id = request.glyph_id;
      let Some(glyph) = font.glyph(glyph_id) else {
        continue;
      };

      let projection = font.glyph_projection(glyph_id)?.as_ref().map(Into::into);

      let layers = font
        .master_layers(glyph)
        .map(|layer| GlyphLayerSnapshot {
          glyph_id,
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

    Ok(snapshots.into_each())
  }

  /// Reads exact authored layers with their composited geometry.
  ///
  /// Each root keeps its requested authored geometry; components resolve at
  /// that layer's source through normal interpolation and fallback, and
  /// cyclic branches are skipped. Results preserve request order and do not
  /// publish renderer models.
  ///
  /// # Errors
  ///
  /// Returns an error when any identity is malformed or absent, a component
  /// cannot resolve, or referenced interpolation is incompatible.
  #[napi(ts_args_type = "layerIds: Array<LayerId>")]
  pub fn resolve_layers(&mut self, layer_ids: Vec<String>) -> errors::Result<Vec<NapiLayerRead>> {
    let layer_ids = parse_id_list::<LayerId>(&layer_ids)?;
    let glyph_ids = self.layer_owners(&layer_ids)?;
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::ComponentClosure)?;

    layer_ids
      .iter()
      .zip(glyph_ids)
      .map(|(layer_id, glyph_id)| {
        Ok(NapiLayerRead {
          authored: layer_snapshot(glyph_id, font.require_layer(*layer_id)?).into(),
          resolved: (&font.resolve_layer(*layer_id)?).into(),
        })
      })
      .collect()
  }

  /// Derives entity mappings and structural diagnostics between two layers.
  ///
  /// Both layers must belong to the same glyph. The read acquires that glyph's
  /// authored layers before matching, so sparse workspace residency cannot
  /// produce an incomplete result. Missing layers and cross-glyph requests are
  /// rejected rather than represented as compatibility differences.
  #[napi(ts_args_type = "referenceLayerId: LayerId, targetLayerId: LayerId")]
  pub fn get_layer_match(
    &mut self,
    reference_layer_id: String,
    target_layer_id: String,
  ) -> errors::Result<NapiLayerMatch> {
    let reference_layer_id = parse::<LayerId>(&reference_layer_id)?;
    let target_layer_id = parse::<LayerId>(&target_layer_id)?;
    let (reference_glyph_id, target_glyph_id) = {
      let font = self.font()?;
      let reference_glyph_id = font.require_layer_owner(reference_layer_id)?;
      let target_glyph_id = font.require_layer_owner(target_layer_id)?;
      (reference_glyph_id, target_glyph_id)
    };
    if reference_glyph_id != target_glyph_id {
      return Err(BridgeError::InvalidInput {
        kind: "layer match",
        value: format!(
          "layers {reference_layer_id} and {target_layer_id} belong to different glyphs"
        ),
      });
    }

    let font = self.acquire_and_font(&[reference_glyph_id], AcquireScope::Glyphs)?;
    let reference = font.require_layer(reference_layer_id)?;
    let target = font.require_layer(target_layer_id)?;

    Ok(WireLayerMatch::from_layers(reference, target).into())
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
    let glyph_ids = parse_id_list::<GlyphId>(&glyph_ids)?;
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::ComponentClosure)?;
    let mut projections = Vec::new();
    let mut pending = glyph_ids.into_iter().collect::<VecDeque<_>>();
    let mut seen = HashSet::new();

    while let Some(glyph_id) = pending.pop_front() {
      if !seen.insert(glyph_id) {
        continue;
      }
      if font.glyph(glyph_id).is_none() {
        continue;
      }

      let Some(projection) = font.glyph_projection(glyph_id)? else {
        continue;
      };
      pending.extend(projection.component_glyph_ids().iter().copied());
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
  #[napi(ts_args_type = "glyphIds: Array<GlyphId>, location: Location")]
  pub fn get_glyph_previews(
    &mut self,
    glyph_ids: Vec<String>,
    location: values::Location,
  ) -> errors::Result<Vec<NapiGlyphPreview>> {
    let glyph_ids = parse_id_list::<GlyphId>(&glyph_ids)?;
    let location =
      shift_font::DesignLocation::from_untyped(shift_font::Location::try_from(location)?);
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

  /// Streams the prepared generation with native Web Stream backpressure.
  ///
  /// A capacity-one channel bounds temporary memory to one upload chunk. The
  /// authored atlas moves to the producer thread and is dropped when the stream
  /// completes, so GPU residency retains no second atlas-sized CPU copy.
  #[napi]
  #[allow(
    clippy::trivially_copy_pass_by_ref,
    reason = "the returned stream borrows the NAPI environment"
  )]
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
      if !receiver_closed && let Err(error) = result {
        let _ = sender.blocking_send(Err(Error::new(Status::GenericFailure, error.to_string())));
      }
    });

    ReadableStream::create_with_stream_bytes(
      env,
      tokio_stream::wrappers::ReceiverStream::new(receiver),
    )
  }

  /// Streams one prepared page with the complete-atlas backpressure contract.
  #[napi]
  #[allow(
    clippy::trivially_copy_pass_by_ref,
    reason = "the returned stream borrows the NAPI environment"
  )]
  pub fn stream_slug_atlas_page(
    &mut self,
    env: &Env,
    generation: u32,
    maximum_length: u32,
  ) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
    self.stream_slug_atlas(env, generation, maximum_length)
  }

  /// Streams one prepared source page through the same bounded atlas lane.
  #[napi]
  #[allow(
    clippy::trivially_copy_pass_by_ref,
    reason = "the returned stream borrows the NAPI environment"
  )]
  pub fn stream_source_atlas_page(
    &mut self,
    env: &Env,
    generation: u32,
    maximum_length: u32,
  ) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
    self.stream_slug_atlas(env, generation, maximum_length)
  }

  #[napi]
  pub fn map_location(&self, location: values::Location) -> errors::Result<values::Location> {
    let external =
      shift_font::ExternalLocation::from_untyped(shift_font::Location::try_from(location)?);
    let mapped = self.font()?.mapped_location(&external)?;
    Ok(shift_wire::Location::from(mapped.as_untyped()).into())
  }

  /// Snapshots the font with only the glyphs its thumbnail specimen compiles loaded.
  fn specimen_snapshot(&mut self) -> BridgeResult<FontSaveSnapshot> {
    crate::specimen::acquire_specimen_glyphs(self.workspace_mut()?)?;
    Ok(FontSaveSnapshot::new(self.font()?.clone(), None))
  }

  fn save_snapshot(&mut self) -> BridgeResult<FontSaveSnapshot> {
    self.workspace_mut()?.acquire_all_layers()?;
    Ok(FontSaveSnapshot::new(self.font()?.clone(), None))
  }

  fn workspace(&self) -> BridgeResult<&FontWorkspace> {
    self.workspace.as_ref().ok_or(BridgeError::NoWorkspace)
  }

  fn workspace_mut(&mut self) -> BridgeResult<&mut FontWorkspace> {
    self.workspace.as_mut().ok_or(BridgeError::NoWorkspace)
  }

  fn retained_source(&self) -> BridgeResult<&RetainedSource> {
    self
      .retained_source
      .as_ref()
      .ok_or(BridgeError::NoFontSource)
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
  /// Returns the shaper for the current font, making a new one after a font
  /// change.
  fn live_shaper(&mut self) -> BridgeResult<&LiveShaper> {
    let shaper = match self.shaper.take() {
      Some(shaper) => shaper,
      None => self.new_live_shaper()?,
    };
    Ok(self.shaper.insert(shaper))
  }

  /// Updates the shaping tables from the current font and makes a shaper
  /// with its character mapping. Every layer is acquired first, because a
  /// glyph's `GDEF` class depends on its anchors.
  fn new_live_shaper(&mut self) -> BridgeResult<LiveShaper> {
    self.workspace_mut()?.acquire_all_layers()?;
    let font = self.font()?;
    let request = ShaperFontRequest::new(&shift_backends::shaper_font_source(font))?;
    self.shaper_fonts.update(request)?;
    let shaper_font =
      self
        .shaper_fonts
        .font()
        .cloned()
        .ok_or_else(|| BridgeError::InvalidInput {
          kind: "font",
          value: "it has no shaping tables".to_string(),
        })?;
    let characters: Vec<(u32, GlyphId)> = self
      .font()?
      .glyphs()
      .flat_map(|glyph| {
        glyph
          .unicodes()
          .iter()
          .map(move |&codepoint| (codepoint, glyph.id()))
      })
      .collect();
    let mut shaper = LiveShaper::new(shaper_font, characters.iter().copied())?;
    shaper.set_glyphs(self.shaper_fonts.glyph_order(), characters);
    Ok(shaper)
  }

  fn mark_font_changed(&mut self) {
    self.slug_atlas = None;
    self.shaper = None;
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
    self.shaper_fonts = ShaperFontState::default();
    self.shaper = None;
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

fn layer_snapshot(glyph_id: GlyphId, layer: &GlyphLayer) -> GlyphLayerSnapshot {
  GlyphLayerSnapshot {
    glyph_id,
    source_id: layer.source_id(),
    state: GlyphState::from_layer(layer),
  }
}

#[cfg(test)]
mod tests {
  use super::workspace::{
    NativeWorkspace, NativeWorkspaceClient, NativeWorkspaceError, SaveState, SourceKind,
  };
  use super::*;
  use pack::{Bytes, CarryingNames, Packed};
  use shift_font::{AnchorSeed, FontIntent, FontIntentSet, PointSeed};
  use shift_wire::bridges::napi::{NapiGlyphSnapshotRequest, NapiGlyphState};
  use std::cell::RefCell;
  use std::sync::atomic::{AtomicUsize, Ordering};

  static TEST_ID: AtomicUsize = AtomicUsize::new(0);

  fn create_glyph_napi(name: &str, unicodes: Vec<u32>) -> FontIntent {
    create_glyph_napi_with_id(&GlyphId::new().to_string(), name, unicodes)
  }

  fn create_glyph_napi_with_id(glyph_id: &str, name: &str, unicodes: Vec<u32>) -> FontIntent {
    shift_font::CreateGlyph {
      glyph_id: Some(GlyphId::from_raw(glyph_id)),
      name: name.to_string(),
      unicodes,
    }
    .into()
  }

  fn create_glyph_layer_intent(layer_id: &str, glyph_id: &str, source_id: &str) -> FontIntent {
    shift_font::CreateGlyphLayer {
      layer_id: LayerId::from_raw(layer_id),
      glyph_id: GlyphId::from_raw(glyph_id),
      source_id: SourceId::from_raw(source_id),
    }
    .into()
  }

  fn clone_glyph_layer_intent(
    layer_id: &str,
    glyph_id: &str,
    source_id: &str,
    from_layer_id: &str,
  ) -> FontIntent {
    shift_font::CloneGlyphLayer {
      layer_id: LayerId::from_raw(layer_id),
      glyph_id: GlyphId::from_raw(glyph_id),
      source_id: SourceId::from_raw(source_id),
      from_layer_id: LayerId::from_raw(from_layer_id),
    }
    .into()
  }

  #[test]
  fn glyph_record_echoes_carry_only_the_glyphs_an_edit_changed() {
    let mut bridge = bridge_with_workspace();
    for (id, name, unicode) in [("glyph_a", "A", 65), ("glyph_b", "B", 66)] {
      bridge
        .apply(
          vec![create_glyph_napi_with_id(id, name, vec![unicode])],
          None,
        )
        .unwrap();
    }

    let renamed = bridge
      .apply(
        vec![
          shift_font::UpdateGlyph {
            glyph_id: GlyphId::from_raw("glyph_a"),
            new_name: "A.alt".into(),
            new_unicodes: vec![],
          }
          .into(),
        ],
        None,
      )
      .unwrap()
      .next
      .and_then(|next| next.glyph_changes)
      .expect("a rename must echo its glyph's record");
    assert!(renamed.removed.is_empty());
    let [record] = &*renamed.updated else {
      panic!("only the renamed glyph's record must cross");
    };
    let listed = bridge.get_glyphs().unwrap();
    let listed = listed
      .iter()
      .find(|glyph| glyph.id.as_str() == "glyph_a")
      .unwrap();
    assert_eq!(
      (
        &record.name,
        &record.unicodes,
        &record.component_base_glyph_ids
      ),
      (
        &listed.name,
        &listed.unicodes,
        &listed.component_base_glyph_ids
      )
    );
    assert_eq!(record.name.as_str(), "A.alt");
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
      .glyph_changes
      .expect("createGlyph must echo records")
      .updated;
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name.as_str(), "A");
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
      .glyph_changes
      .expect("createGlyphLayer must echo records")
      .updated;
    assert_eq!(glyphs[0].layers.len(), 1);
    assert_eq!(glyphs[0].layers[0].id.as_str(), layer_id);
    assert_eq!(glyphs[0].layers[0].source_id.as_str(), source_id);
    assert_eq!(applied.layers.len(), 1);
    assert_eq!(applied.layers[0].layer_id.as_str(), layer_id);
    assert!(applied.layers[0].structure.is_some());
  }

  #[test]
  fn apply_set_x_advance_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));

    let applied = bridge
      .apply(
        vec![
          shift_font::SetXAdvance {
            layer_id: LayerId::from_raw(&layer_id),
            width: 642.0,
          }
          .into(),
        ],
        None,
      )
      .unwrap();

    assert!(applied.next.is_none());
    assert_eq!(applied.layers[0].layer_id.as_str(), layer_id);
    assert!(applied.layers[0].structure.is_none());
    // canonical values layout: x advance is slot 0
    assert_eq!(applied.layers[0].values[0], 642.0);
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
    assert_eq!(created.layers[0].layer_id.as_str(), layer_id);

    let contour_id = ContourId::new().to_string();
    bridge
      .apply(
        vec![
          shift_font::AddContour {
            layer_id: LayerId::from_raw(&layer_id),
            contour_id: ContourId::from_raw(&contour_id),
            closed: false,
          }
          .into(),
        ],
        None,
      )
      .unwrap();

    (layer_id, contour_id)
  }

  fn seed(id: &str, x: f64, y: f64) -> PointSeed {
    PointSeed {
      id: PointId::from_raw(id),
      x,
      y,
      point_type: shift_font::PointType::OnCurve,
      smooth: false,
    }
  }

  fn add_points_intent(
    layer_id: &str,
    contour_id: &str,
    before: Option<String>,
    points: Vec<PointSeed>,
  ) -> FontIntent {
    shift_font::AddPoints {
      layer_id: LayerId::from_raw(layer_id),
      contour_id: Some(ContourId::from_raw(contour_id)),
      before: before.map(PointId::from_raw),
      points,
    }
    .into()
  }

  #[test]
  fn apply_pen_intents_honors_client_minted_ids_and_one_atomic_echo() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = PointId::new().to_string();
    let p2 = PointId::new().to_string();

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
    let p1 = PointId::new().to_string();
    let p2 = PointId::new().to_string();
    let mid = PointId::new().to_string();

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
    let p1 = PointId::new().to_string();

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
          shift_font::MovePoints {
            layer_id: LayerId::from_raw(&layer_id),
            point_ids: vec![PointId::from_raw(&p1)],
            coords: vec![77.0, 88.0],
          }
          .into(),
          shift_font::SetPointSmooth {
            layer_id: LayerId::from_raw(&layer_id),
            point_id: PointId::from_raw(&p1),
            smooth: true,
          }
          .into(),
          shift_font::SetContourClosed {
            layer_id: LayerId::from_raw(&layer_id),
            contour_id: ContourId::from_raw(&contour_id),
            closed: true,
          }
          .into(),
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
    let p1 = PointId::new().to_string();

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
    let fresh = PointId::new().to_string();
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

  fn anchor_seed(id: &str, name: Option<&str>, x: f64, y: f64) -> AnchorSeed {
    AnchorSeed {
      id: AnchorId::from_raw(id),
      name: name.map(str::to_owned),
      x,
      y,
    }
  }

  fn add_anchors_intent(layer_id: &str, anchors: Vec<AnchorSeed>) -> FontIntent {
    shift_font::AddAnchors {
      layer_id: LayerId::from_raw(layer_id),
      anchors,
    }
    .into()
  }

  #[test]
  fn apply_add_anchors_echoes_structure_and_values_with_minted_ids() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = AnchorId::new().to_string();
    let a2 = AnchorId::new().to_string();

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
    let a1 = AnchorId::new().to_string();

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
        vec![
          shift_font::MoveAnchors {
            layer_id: LayerId::from_raw(&layer_id),
            anchor_ids: vec![AnchorId::from_raw(&a1)],
            coords: vec![300.0, 650.0],
          }
          .into(),
        ],
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
    let p1 = PointId::new().to_string();
    let a1 = AnchorId::new().to_string();

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
    let missing = AnchorId::new().to_string();
    let result = bridge.apply(
      vec![
        shift_font::RemovePoints {
          layer_id: LayerId::from_raw(&layer_id),
          point_ids: vec![PointId::from_raw(&p1)],
        }
        .into(),
        shift_font::RemoveAnchors {
          layer_id: LayerId::from_raw(&layer_id),
          anchor_ids: vec![AnchorId::from_raw(&missing)],
        }
        .into(),
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
          shift_font::RemovePoints {
            layer_id: LayerId::from_raw(&layer_id),
            point_ids: vec![PointId::from_raw(&p1)],
          }
          .into(),
          shift_font::RemoveAnchors {
            layer_id: LayerId::from_raw(&layer_id),
            anchor_ids: vec![AnchorId::from_raw(&a1)],
          }
          .into(),
        ],
        None,
      )
      .unwrap();
    assert_eq!(removed.layers.len(), 1);
    let state = glyph_state(&mut bridge, "A");
    assert!(state.structure.contours.is_empty());
    assert!(state.structure.anchors.is_empty());
  }

  #[test]
  fn apply_add_anchors_rejects_duplicate_ids_atomically() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let fresh = AnchorId::new().to_string();
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
      .find(|record| record.name.as_str() == name)
      .expect("glyph record should exist");
    let source_id = default_source_id(bridge);

    glyph_source_state(bridge, record.id.as_str(), &source_id)
      .expect("glyph state should be readable")
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
      .map_or(0, |contour| contour.points.len())
  }

  /// A client of `bridge`'s workspace requests, encoding and decoding each
  /// one as the utility process's generated class does, without napi.
  fn workspace_client(
    bridge: &RefCell<Bridge>,
  ) -> NativeWorkspaceClient<
    CarryingNames<impl Fn(u32, Packed) -> std::result::Result<Packed, ()> + '_>,
  > {
    NativeWorkspaceClient(CarryingNames(move |method, request: Packed| {
      Ok(request.answer_carrying_names(|input, blobs, names| {
        native_workspace_request(&mut *bridge.borrow_mut(), method, input, blobs, names)
      }))
    }))
  }

  #[test]
  fn a_workspace_request_replies_with_the_kind_of_error_it_failed_with() {
    let bridge = RefCell::new(Bridge::new());
    let client = workspace_client(&bridge);

    assert!(matches!(
      client.document_state(),
      Ok(Err(NativeWorkspaceError::NoWorkspace { detail })) if detail.contains("no workspace is open")
    ));
    let (_, store_path) = test_paths("request-errors");
    assert_eq!(
      client.create_untitled_workspace(store_path, None),
      Ok(Ok(()))
    );
    assert!(matches!(
      client.save_workspace(),
      Ok(Err(NativeWorkspaceError::NeedsSaveAs { detail })) if detail == "workspace needs a save path"
    ));
    let Ok(Err(NativeWorkspaceError::InvalidInput { detail })) =
      client.persist(Bytes(vec![0xc1]), SaveState::Unsaved)
    else {
      panic!("a change set that does not decode must be refused as invalid input");
    };
    assert!(detail.starts_with("cannot decode from the window"));
  }

  #[test]
  fn intents_cross_in_and_the_directory_crosses_out_as_bytes() {
    let bridge = RefCell::new(Bridge::new());
    let client = workspace_client(&bridge);
    let (_, store_path) = test_paths("request-bytes");
    client
      .create_untitled_workspace(store_path, None)
      .unwrap()
      .unwrap();

    let applied = client
      .apply(
        vec![create_glyph_napi_with_id("glyph_a", "A", vec![65])],
        Some("Add Glyph".to_string()),
      )
      .unwrap()
      .unwrap();
    let directory = client.encoded_directory().unwrap().unwrap();

    let created = applied
      .next
      .and_then(|next| next.glyph_changes)
      .expect("createGlyph must echo records");
    assert_eq!(created.updated[0].id, GlyphId::from_raw("glyph_a"));
    let font: Font = rmp_serde::from_slice(&directory.0).unwrap();
    assert_eq!(
      font.glyph(GlyphId::from_raw("glyph_a")).map(Glyph::name),
      Some("A")
    );
  }

  #[test]
  fn persist_writes_a_change_set_applied_to_another_copy_of_the_font() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = PointId::new().to_string();
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

    let mut elsewhere = bridge.workspace().unwrap().font().clone();
    let moved = elsewhere
      .apply_intents(&FontIntentSet::from(FontIntent::from(
        shift_font::MovePoints {
          layer_id: LayerId::from_raw(&layer_id),
          point_ids: vec![PointId::from_raw(&point_id)],
          coords: vec![30.0, 40.0],
        },
      )))
      .unwrap();
    // Sent compacted, as the window's engine sends it.
    let bytes = rmp_serde::to_vec_named(&moved.changes.compact()).unwrap();

    let echo = bridge.persist(Bytes(bytes), SaveState::Unsaved).unwrap();
    assert_eq!(&echo.layers[0].values[1..3], &[30.0, 40.0]);
    assert_eq!(&glyph_state(&mut bridge, "A").values[1..3], &[30.0, 40.0]);
    // A second persist of the same change set no longer matches the font.
    assert!(
      bridge
        .persist(
          Bytes(rmp_serde::to_vec_named(&moved.changes.compact()).unwrap()),
          SaveState::Unsaved,
        )
        .is_err()
    );
  }

  #[test]
  fn apply_remove_translate_and_reverse_intents() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = PointId::new().to_string();
    let p2 = PointId::new().to_string();
    let p3 = PointId::new().to_string();

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
        vec![
          shift_font::TranslatePoints {
            layer_id: LayerId::from_raw(&layer_id),
            point_ids: vec![PointId::from_raw(&p1), PointId::from_raw(&p2)],
            dx: 10.0,
            dy: 5.0,
          }
          .into(),
        ],
        None,
      )
      .unwrap();
    assert!(translated.layers[0].structure.is_none());
    assert_eq!(translated.layers[0].values[1], 10.0);
    assert_eq!(translated.layers[0].values[2], 5.0);

    // transform the whole layer: a value-only echo with every point moved
    let transformed = bridge
      .apply(
        vec![
          shift_font::TransformLayer {
            layer_id: LayerId::from_raw(&layer_id),
            transform: shift_font::Transform::translate(100.0, 0.0),
          }
          .into(),
        ],
        None,
      )
      .unwrap();
    assert!(transformed.layers[0].structure.is_none());
    assert_eq!(transformed.layers[0].values[1], 110.0);

    // reverse the contour: same point ids, reversed order, structural echo
    let reversed = bridge
      .apply(
        vec![
          shift_font::ReverseContour {
            layer_id: LayerId::from_raw(&layer_id),
            contour_id: ContourId::from_raw(&contour_id),
          }
          .into(),
        ],
        None,
      )
      .unwrap();
    let ids: Vec<&str> = reversed.layers[0].structure.as_ref().unwrap().contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p3.as_str(), p2.as_str(), p1.as_str()]);

    // remove one point
    bridge
      .apply(
        vec![
          shift_font::RemovePoints {
            layer_id: LayerId::from_raw(&layer_id),
            point_ids: vec![PointId::from_raw(&p2)],
          }
          .into(),
        ],
        None,
      )
      .unwrap();
    assert_eq!(contour_point_count(&mut bridge), 2);
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
    assert_eq!(state.source_kind, SourceKind::Untitled);
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
    assert_eq!(state.source_kind, SourceKind::Document);
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

  /// The open font's master sources.
  fn masters(bridge: &Bridge) -> Vec<shift_font::Source> {
    bridge.font().unwrap().masters().cloned().collect()
  }

  fn default_source_id(bridge: &Bridge) -> String {
    masters(bridge)[0].id().to_string()
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
    assert_eq!(applied.layers[0].layer_id.as_str(), layer_id);
    layer_id
  }

  fn create_axis_intent(
    axis_id: &str,
    tag: &str,
    name: &str,
    min: f64,
    default: f64,
    max: f64,
  ) -> FontIntent {
    shift_font::CreateAxis {
      axis: FontAxis::continuous_with_id(
        AxisId::from_raw(axis_id),
        tag.to_string(),
        name.to_string(),
        min,
        default,
        max,
      ),
    }
    .into()
  }

  fn delete_axis_intent(axis_id: &str) -> FontIntent {
    shift_font::DeleteAxis {
      axis_id: AxisId::from_raw(axis_id),
    }
    .into()
  }

  fn delete_source_intent(source_id: &str) -> FontIntent {
    shift_font::DeleteSource {
      source_id: SourceId::from_raw(source_id),
    }
    .into()
  }

  fn create_source_intent(source_id: &str, name: &str, location: &[(&str, f64)]) -> FontIntent {
    shift_font::CreateSource {
      source_id: SourceId::from_raw(source_id),
      name: name.to_string(),
      location: location
        .iter()
        .map(|(axis_id, value)| (AxisId::from_raw(axis_id), *value))
        .collect(),
    }
    .into()
  }

  fn weight_axis_intent() -> FontIntent {
    create_axis_intent("axis_weight", "wght", "Weight", 100.0, 400.0, 900.0)
  }

  fn named_instance(id: &str, name: &str, value: f64) -> shift_font::NamedInstance {
    shift_font::NamedInstance::with_id(
      NamedInstanceId::from_raw(id),
      name.to_string(),
      shift_font::ExternalLocation::from([(AxisId::from_raw("axis_weight"), value)]),
      Some(format!("TestFont-{name}")),
    )
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
    assert_eq!(axes[0].tag(), "wght");
    assert_eq!(axes[0].name(), "Weight");
    assert_eq!(axes[0].minimum(), 100.0);
    assert_eq!(axes[0].default(), 400.0);
    assert_eq!(axes[0].maximum(), 900.0);
    // locations may change shape, so sources ride along
    assert!(next.sources.is_some());
    assert!(next.glyph_changes.is_none());
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
    assert_eq!(bridge.font().unwrap().axes().to_vec().len(), 1);
  }

  #[test]
  fn named_instance_crud_echoes_replace_grade_authoring_state() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let created = bridge
      .apply(
        vec![
          shift_font::CreateNamedInstance {
            instance: named_instance("namedInstance_bold", "Bold", 700.0),
          }
          .into(),
        ],
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
      instances[0]
        .location
        .values
        .get(&AxisId::from_raw("axis_weight")),
      Some(&700.0)
    );

    let updated = bridge
      .apply(
        vec![
          shift_font::UpdateNamedInstance {
            instance: named_instance("namedInstance_bold", "DisplayBold", 750.0),
          }
          .into(),
        ],
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
        vec![
          shift_font::DeleteNamedInstance {
            instance_id: NamedInstanceId::from_raw("namedInstance_bold"),
          }
          .into(),
        ],
        None,
      )
      .unwrap();
    assert!(
      deleted
        .next
        .expect("instance deletion must echo font replacements")
        .named_instances
        .expect("instance deletion must echo the collection")
        .is_empty()
    );
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
    assert!(
      sources
        .iter()
        .all(|source| source.location().as_untyped().is_empty())
    );
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
      .find(|source| source.name() == "Bold")
      .expect("new source must be in the echo");
    assert_eq!(bold.id().as_str(), "source_bold");
    assert_eq!(
      bold.location().get(&AxisId::from_raw("axis_weight")),
      Some(700.0)
    );
    assert!(applied.layers.is_empty());
    assert!(next.glyph_changes.is_none());
    assert_eq!(bridge.get_glyphs().unwrap()[0].layers.len(), 1);
  }

  #[test]
  fn set_languages_echoes_the_list() {
    let mut bridge = bridge_with_workspace();
    assert_eq!(bridge.get_language_ids().unwrap(), None);

    let applied = bridge
      .apply(
        vec![
          shift_font::SetLanguages {
            language_ids: vec!["eng-latin".to_string(), "cmn-chinese".to_string()],
          }
          .into(),
        ],
        None,
      )
      .unwrap();

    let next = applied
      .next
      .expect("setLanguages must echo font replacements");
    let languages = next.languages.expect("setLanguages must echo languages");
    assert_eq!(
      languages.language_ids,
      Some(vec!["eng-latin".to_string(), "cmn-chinese".to_string()])
    );
    assert!(next.metadata.is_none());
    assert!(next.sources.is_none());
  }

  #[test]
  fn set_kerning_values_echoes_kerning() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));
    let glyph_id = bridge.get_glyphs().unwrap()[0].id;
    let source_id = default_source_id(&bridge);
    let side = || shift_font::KerningSide::Glyph(glyph_id);

    let applied = bridge
      .apply(
        vec![
          shift_font::SetKerningValues {
            edits: vec![shift_font::KerningValueEdit {
              source_id: SourceId::from_raw(&source_id),
              pair: shift_font::KerningPair::new(side(), side()),
              value: Some(-30.0),
            }],
          }
          .into(),
        ],
        None,
      )
      .unwrap();

    let kerning = applied
      .next
      .and_then(|next| next.kerning)
      .expect("setKerningValues must echo kerning");
    assert_eq!(kerning.sources.len(), 1);
    assert_eq!(kerning.sources[0].source_id.as_str(), source_id);
    assert_eq!(kerning.sources[0].pairs[0].amount, -30.0);
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

    let glyph_id = bridge.get_glyphs().unwrap()[0].id.to_string();
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
    assert_eq!(applied.layers[0].layer_id.as_str(), layer_id);
    let glyphs = applied
      .next
      .expect("layer membership must echo font replacements")
      .glyph_changes
      .expect("layer membership must echo glyph records")
      .updated;
    assert_eq!(glyphs[0].layers.len(), 2);
  }

  #[test]
  fn apply_clone_glyph_layer_copies_shape_with_fresh_internal_ids() {
    let mut bridge = bridge_with_workspace();
    let (from_layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.to_string();
    let point_a = PointId::new().to_string();
    let point_b = PointId::new().to_string();
    let anchor_top = AnchorId::new().to_string();

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

    assert_eq!(applied.layers[0].layer_id.as_str(), layer_id);
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
    assert_eq!(masters(&bridge).len(), 1);
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
    assert_eq!(masters(&bridge).len(), 1);
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
    assert_eq!(masters(&bridge).len(), 2);
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
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.to_string();
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
    assert_eq!(sources[0].name(), "Regular");
    let glyphs = next
      .glyph_changes
      .expect("deleteSource layer removal must echo glyph records")
      .updated;
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
    assert_eq!(masters(&bridge).len(), 1);
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
      .glyph_changes
      .expect("createGlyph must echo records")
      .updated;
    assert!(glyphs[0].layers.is_empty());
  }

  #[test]
  fn apply_mixes_editing_and_create_intents_in_one_set() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);

    let applied = bridge
      .apply(
        vec![
          weight_axis_intent(),
          shift_font::SetXAdvance {
            layer_id: LayerId::from_raw(&layer_id),
            width: 600.0,
          }
          .into(),
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
    assert!(
      applied
        .layers
        .iter()
        .any(|layer| layer.layer_id.as_str() == layer_id)
    );
  }

  #[test]
  fn new_bridge_requires_workspace_before_font_reads() {
    let bridge = Bridge::new();

    let Err(error) = bridge.get_metadata() else {
      panic!("metadata read should require an open workspace");
    };

    assert!(error.to_string().contains("no workspace is open"));
  }

  #[test]
  fn create_untitled_workspace_exposes_empty_font_state() {
    let bridge = bridge_with_workspace();

    let metadata = bridge.get_metadata().unwrap();
    let metrics = bridge.get_metrics().unwrap();

    assert!(bridge.get_glyphs().unwrap().is_empty());
    assert_eq!(masters(&bridge).len(), 1);
    assert_eq!(masters(&bridge)[0].name(), "Regular");
    assert_eq!(metadata.family_name.as_deref(), Some("Untitled Font"));
    assert_eq!(metadata.style_name.as_deref(), Some("Regular"));
    assert_eq!(metrics.units_per_em, 1000.0);
    assert_eq!(bridge.get_metric_definitions().unwrap().len(), 5);
    assert_eq!(masters(&bridge)[0].metric_values().len(), 5);
  }

  #[test]
  fn create_untitled_workspace_resets_to_fresh_font_state() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));

    let (_, store_path) = test_paths("reset");
    bridge.create_untitled_workspace(store_path, None).unwrap();

    assert!(bridge.get_glyphs().unwrap().is_empty());
    assert!(bridge.font().unwrap().axes().to_vec().is_empty());
    assert_eq!(masters(&bridge).len(), 1);
    assert_eq!(masters(&bridge)[0].name(), "Regular");
  }

  #[test]
  fn save_snapshot_includes_applied_glyph_edits() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = PointId::new().to_string();
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
    let point_id = PointId::new().to_string();
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

  fn mutator_sans_bridge(name: &str) -> Bridge {
    let source_path = Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let (_, store_path) = test_paths(name);
    let mut bridge = Bridge::new();
    bridge
      .open_workspace(source_path.to_string_lossy().into_owned(), store_path)
      .unwrap();
    bridge
  }

  #[test]
  fn layer_reads_preserve_request_order_with_resolved_components() {
    let mut bridge = mutator_sans_bridge("layer-reads");
    let records = bridge.get_glyphs().unwrap();
    let composite = records
      .iter()
      .find(|glyph| !glyph.component_base_glyph_ids.is_empty())
      .unwrap();
    let plain = records
      .iter()
      .find(|glyph| glyph.component_base_glyph_ids.is_empty() && glyph.layers.len() > 1)
      .unwrap();
    let layer_ids = vec![
      composite.layers[1].id,
      plain.layers[0].id,
      composite.layers[0].id,
    ];

    let authored = bridge.read_layers(layer_ids.clone()).unwrap();
    let layer_texts = layer_ids
      .iter()
      .map(ToString::to_string)
      .collect::<Vec<_>>();
    let resolved = bridge.resolve_layers(layer_texts.clone()).unwrap();

    let authored_ids = authored
      .iter()
      .map(|layer| layer.state.layer_id)
      .collect::<Vec<_>>();
    let resolved_ids = resolved
      .iter()
      .map(|layer| layer.authored.state.layer_id.clone())
      .collect::<Vec<_>>();
    assert_eq!(authored_ids, layer_ids);
    assert_eq!(resolved_ids, layer_texts);
    assert_eq!(
      resolved[0].authored.source_id,
      composite.layers[1].source_id.as_str()
    );
    assert_eq!(
      resolved[0].resolved.components.len(),
      resolved[0].authored.state.structure.components.len(),
    );
    assert!(!resolved[0].resolved.components.is_empty());
    assert!(
      resolved[0]
        .resolved
        .components
        .iter()
        .all(|component| component.outline.bounds.is_some())
    );
    assert!(!resolved[0].resolved.outline.svg_path.is_empty());
    assert!(resolved[1].resolved.components.is_empty());
  }

  #[test]
  fn layer_reads_reject_unknown_layers() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    let missing = LayerId::new().to_string();

    assert!(
      bridge
        .read_layers(vec![
          LayerId::from_raw(&layer_id),
          LayerId::from_raw(&missing)
        ])
        .is_err()
    );
    assert!(bridge.resolve_layers(vec![layer_id, missing]).is_err());
  }

  #[test]
  fn get_glyph_snapshots_returns_none_for_missing_glyph() {
    let mut bridge = bridge_with_workspace();
    let missing_glyph_id = GlyphId::new().to_string();

    let snapshots = bridge
      .get_glyph_snapshots(vec![NapiGlyphSnapshotRequest {
        glyph_id: missing_glyph_id,
      }])
      .unwrap();

    assert!(snapshots.is_empty());
  }

  #[test]
  fn get_layer_match_returns_cross_layer_entity_ids() {
    let mut bridge = bridge_with_workspace();
    let (reference_layer_id, contour_id) = pen_setup(&mut bridge);
    let reference_point_ids = [PointId::new().to_string(), PointId::new().to_string()];
    bridge
      .apply(
        vec![add_points_intent(
          &reference_layer_id,
          &contour_id,
          None,
          vec![
            seed(&reference_point_ids[0], 0.0, 0.0),
            seed(&reference_point_ids[1], 100.0, 0.0),
          ],
        )],
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
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.to_string();
    let target_layer_id = LayerId::new().to_string();
    bridge
      .apply(
        vec![clone_glyph_layer_intent(
          &target_layer_id,
          &glyph_id,
          "source_bold",
          &reference_layer_id,
        )],
        None,
      )
      .unwrap();

    let layer_match = bridge
      .get_layer_match(reference_layer_id.clone(), target_layer_id.clone())
      .unwrap();

    assert!(layer_match.complete);
    assert_eq!(layer_match.reference_layer_id, reference_layer_id);
    assert_eq!(layer_match.target_layer_id, target_layer_id);
    assert_eq!(layer_match.contours.len(), 1);
    assert_eq!(layer_match.points.len(), 2);
    assert_ne!(
      layer_match.points[0].reference_id,
      layer_match.points[0].target_id
    );
    assert!(layer_match.differences.is_empty());
  }

  #[test]
  fn get_layer_match_rejects_layers_from_different_glyphs() {
    let mut bridge = bridge_with_workspace();
    let first = create_default_glyph_layer(&mut bridge, "A", Some(65));
    let second = create_default_glyph_layer(&mut bridge, "B", Some(66));

    assert!(bridge.get_layer_match(first, second).is_err());
  }

  #[test]
  fn get_glyph_projections_returns_location_independent_shape_backing() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph = bridge.get_glyphs().unwrap()[0].clone();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&PointId::new().to_string(), 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();

    let projections = bridge
      .get_glyph_projections(vec![glyph.id.to_string()])
      .unwrap();

    assert_eq!(projections.len(), 1);
    assert_eq!(projections[0].glyph_id, glyph.id.as_str());
    assert_eq!(
      projections[0].fallback.values.as_ref(),
      &[500.0, 10.0, 20.0]
    );
  }

  #[test]
  fn get_glyph_previews_resolve_drawable_paths_at_a_location() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph = bridge.get_glyphs().unwrap()[0].clone();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![
            seed(&PointId::new().to_string(), 10.0, 20.0),
            seed(&PointId::new().to_string(), 90.0, 20.0),
          ],
        )],
        None,
      )
      .unwrap();
    let missing_glyph_id = GlyphId::new().to_string();

    let previews = bridge
      .get_glyph_previews(
        vec![glyph.id.to_string(), missing_glyph_id],
        values::Location {
          values: HashMap::new(),
        },
      )
      .unwrap();

    assert_eq!(previews.len(), 1);
    assert_eq!(previews[0].glyph_id, glyph.id.as_str());
    assert_eq!(previews[0].x_advance, 500.0);
    assert!(previews[0].svg_path.starts_with('M'));
  }
}
