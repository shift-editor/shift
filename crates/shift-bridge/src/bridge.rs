use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::{parse, BridgeParse};
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{ExportFormat, FontExportRequest, FontExportResult, FontExporter, FontView};
use shift_font::{
  AnchorId, AnchorSeed, BooleanOp, ContourId, Font, FontIntent, FontIntentSet, Glyph, GlyphId,
  LayerId, PointId, PointSeed, SourceId,
};
use shift_wire::{
  bridges::napi::{
    NapiAnchorSeed, NapiAppliedChange, NapiAxis, NapiFontIntent, NapiFontMetadata, NapiFontMetrics,
    NapiGlyphRecord, NapiGlyphState, NapiLayerReplaced, NapiPointSeed, NapiSource,
  },
  interpolation::{build_glyph_variation_data, build_masters, GlyphVariationBuild},
  Axis, FontMetadata, FontMetrics, GlyphChangedEntities, GlyphRecord, GlyphState, GlyphStructure,
  Source,
};
use shift_workspace::{FontWorkspace, NewWorkspace};
use std::sync::Arc;

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

  fn axes(&self) -> &[shift_font::Axis] {
    self.font.axes()
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

#[napi]
pub struct Bridge {
  workspace: Option<FontWorkspace>,
  live_version: DocumentVersion,
}

#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      workspace: None,
      live_version: DocumentVersion::default(),
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
  pub fn get_metadata(&self) -> errors::Result<NapiFontMetadata> {
    Ok(FontMetadata::from(self.font()?.metadata()).into())
  }

  #[napi]
  pub fn get_metrics(&self) -> errors::Result<NapiFontMetrics> {
    Ok(FontMetrics::from(self.font()?.metrics()).into())
  }

  #[napi]
  pub fn get_glyphs(&self) -> errors::Result<Vec<NapiGlyphRecord>> {
    let mut records: Vec<_> = self
      .font()?
      .glyphs()
      .map(GlyphRecord::from)
      .map(Into::into)
      .collect();
    records.sort_by(|a: &NapiGlyphRecord, b: &NapiGlyphRecord| a.name.cmp(&b.name));
    Ok(records)
  }

  /// Applies one intent set as a single atomic workspace apply.
  ///
  /// Editing kinds decode through `map_intent` into `Font::apply_intents`;
  /// `createGlyph` keeps its workspace-verb path until font-level verbs get
  /// intent homes (CS4 tail). Sets must be homogeneous: font-level and
  /// editing intents never share a tick.
  #[napi]
  pub fn apply(
    &mut self,
    intents: Vec<NapiFontIntent>,
    label: Option<String>,
  ) -> errors::Result<NapiAppliedChange> {
    let (creates, edits): (Vec<_>, Vec<_>) = intents
      .into_iter()
      .partition(|intent| intent.kind == "createGlyph");

    if !creates.is_empty() && !edits.is_empty() {
      return Err(BridgeError::InvalidInput {
        kind: "intent",
        value: "createGlyph cannot share a set with editing intents".to_string(),
      });
    }

    if creates.is_empty() {
      return self.apply_editing_intents(edits, label);
    }

    // Font-level verbs are not in the ledger yet; the label is part of the
    // wire contract now.
    let _ = label;

    let layers = creates
      .into_iter()
      .map(|intent| self.apply_create_glyph(intent))
      .collect::<errors::Result<Vec<_>>>()?;

    self.mark_font_changed();

    Ok(NapiAppliedChange {
      layers,
      glyphs: Some(self.get_glyphs()?),
      // Composites cannot depend on a glyph that did not exist yet.
      dependents: Vec::new(),
    })
  }

  fn apply_create_glyph(&mut self, intent: NapiFontIntent) -> errors::Result<NapiLayerReplaced> {
    let name = intent.name.ok_or(BridgeError::InvalidInput {
      kind: "intent",
      value: "createGlyph requires name".to_string(),
    })?;
    let unicodes = intent.unicodes.unwrap_or_default();

    let source_id = self
      .font()?
      .default_source_id()
      .or_else(|| self.font().ok()?.sources().first().map(|s| s.id()))
      .ok_or(BridgeError::InvalidInput {
        kind: "intent",
        value: "createGlyph requires a font with at least one source".to_string(),
      })?;

    let glyph = self.workspace_mut()?.create_glyph(name, unicodes)?;
    let layer = self
      .workspace_mut()?
      .create_glyph_layer(glyph.id(), source_id)?;

    Ok(NapiLayerReplaced {
      layer_id: layer.id().to_string(),
      structure: Some(GlyphStructure::from(&layer).into()),
      values: shift_wire::values_from_layer(&layer).into(),
      changed: GlyphChangedEntities::default().into(),
    })
  }

  fn apply_editing_intents(
    &mut self,
    intents: Vec<NapiFontIntent>,
    label: Option<String>,
  ) -> errors::Result<NapiAppliedChange> {
    if intents.is_empty() {
      return Ok(NapiAppliedChange {
        layers: Vec::new(),
        glyphs: None,
        dependents: Vec::new(),
      });
    }

    let mut set = FontIntentSet::default();
    for intent in intents {
      set.intents.push(map_intent(intent)?);
    }

    let outcome = self.workspace_mut()?.apply(set, label)?;
    self.mark_font_changed();

    self.applied_echo(outcome)
  }

  /// Assembles the pure-state echo for an applied outcome: replace-grade
  /// layers plus dependent composites. Shared by apply/undo/redo.
  fn applied_echo(&self, outcome: shift_font::AppliedIntents) -> errors::Result<NapiAppliedChange> {
    let touched_layer_ids: Vec<LayerId> = outcome
      .layers
      .iter()
      .map(|touched| touched.layer.id())
      .collect();
    let dependents = self
      .font()?
      .dependents_of_layers(&touched_layer_ids)
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
          .then(|| GlyphStructure::from(&touched.layer).into()),
        values: shift_wire::values_from_layer(&touched.layer).into(),
        changed: GlyphChangedEntities::default().into(),
      })
      .collect();

    Ok(NapiAppliedChange {
      layers,
      glyphs: None,
      dependents,
    })
  }

  /// Replays the most recent ledger entry's pre states; `null` when the
  /// undo stack is empty.
  #[napi]
  pub fn undo(&mut self) -> errors::Result<Option<NapiAppliedChange>> {
    let Some(outcome) = self.workspace_mut()?.undo()? else {
      return Ok(None);
    };

    self.mark_font_changed();
    Ok(Some(self.applied_echo(outcome)?))
  }

  /// Replays the most recent undone entry's post states; `null` when the
  /// redo stack is empty.
  #[napi]
  pub fn redo(&mut self) -> errors::Result<Option<NapiAppliedChange>> {
    let Some(outcome) = self.workspace_mut()?.redo()? else {
      return Ok(None);
    };

    self.mark_font_changed();
    Ok(Some(self.applied_echo(outcome)?))
  }

  /// Id-addressed glyph state. References survive renames; no name lookup.
  #[napi]
  pub fn get_glyph(
    &self,
    #[napi(ts_arg_type = "GlyphId")] glyph_id: String,
    #[napi(ts_arg_type = "SourceId")] source_id: String,
  ) -> errors::Result<Option<NapiGlyphState>> {
    let glyph_id = parse::<GlyphId>(&glyph_id)?;
    let source_id = parse::<SourceId>(&source_id)?;

    let font = self.font()?;
    let Some(glyph) = font.glyph(glyph_id) else {
      return Ok(None);
    };
    let Some(layer) = glyph.layer_for_source(source_id) else {
      return Ok(None);
    };

    let variation_data = self
      .variation_build_for_glyph(glyph)?
      .and_then(|(_, build)| build.variation_data);

    Ok(Some(GlyphState::from_layer(layer, variation_data).into()))
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
  pub fn get_sources(&self) -> errors::Result<Vec<NapiSource>> {
    Ok(
      self
        .font()?
        .sources()
        .iter()
        .map(Source::from)
        .map(Into::into)
        .collect(),
    )
  }

  fn save_snapshot(&self) -> BridgeResult<FontSaveSnapshot> {
    Ok(FontSaveSnapshot::new(self.font()?.clone(), None))
  }

  fn variation_build_for_glyph(
    &self,
    glyph: &Glyph,
  ) -> BridgeResult<Option<(usize, GlyphVariationBuild)>> {
    let font = self.font()?;

    Ok(build_masters(font, glyph).map(|masters| {
      let master_count = masters.len();
      let build = build_glyph_variation_data(&masters, font.axes());
      (master_count, build)
    }))
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

  fn font(&self) -> BridgeResult<&Font> {
    Ok(self.workspace()?.font())
  }

  fn mark_font_changed(&mut self) {
    self.bump_live_version();
  }

  fn bump_live_version(&mut self) {
    self.live_version = self.live_version.next();
  }

  fn reset_versions(&mut self) {
    self.live_version = DocumentVersion::default();
  }
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

#[cfg(test)]
mod tests {
  use super::*;
  use shift_wire::bridges::napi::{
    NapiAddAnchorsIntent, NapiAddContourIntent, NapiAddPointsIntent, NapiMoveAnchorsIntent,
    NapiMovePointsIntent, NapiPointSeed, NapiPointType, NapiRemoveAnchorsIntent,
    NapiRemovePointsIntent, NapiReverseContourIntent, NapiSetContourClosedIntent,
    NapiSetPointSmoothIntent, NapiSetXAdvanceIntent, NapiTranslatePointsIntent,
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
      name: None,
      unicodes: None,
    }
  }

  #[test]
  fn apply_create_glyph_returns_records_and_replace_grade_layer() {
    let mut bridge = bridge_with_workspace();

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          name: Some("A".to_string()),
          unicodes: Some(vec![65]),
          ..skeleton_intent("createGlyph")
        }],
        Some("Add Glyph".to_string()),
      )
      .unwrap();

    let glyphs = applied.glyphs.expect("createGlyph must echo records");
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name, "A");
    assert_eq!(applied.layers.len(), 1);
    assert!(applied.layers[0].structure.is_some());
  }

  #[test]
  fn apply_set_x_advance_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let created = bridge
      .apply(
        vec![NapiFontIntent {
          name: Some("A".to_string()),
          unicodes: Some(vec![65]),
          ..skeleton_intent("createGlyph")
        }],
        None,
      )
      .unwrap();
    let layer_id = created.layers[0].layer_id.clone();

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

    assert!(applied.glyphs.is_none());
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
    let created = bridge
      .apply(
        vec![NapiFontIntent {
          name: Some("A".to_string()),
          unicodes: Some(vec![65]),
          ..skeleton_intent("createGlyph")
        }],
        None,
      )
      .unwrap();
    let layer_id = created.layers[0].layer_id.clone();

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
    let state = glyph_state(&bridge, "A");
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
    let state = glyph_state(&bridge, "A");
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
    let state = glyph_state(&bridge, "A");
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
    assert_eq!(glyph_state(&bridge, "A").structure.anchors.len(), 1);

    let undone = bridge.undo().unwrap().expect("one entry to undo");
    assert_eq!(undone.layers.len(), 1);
    assert!(glyph_state(&bridge, "A").structure.anchors.is_empty());

    let redone = bridge.redo().unwrap().expect("one entry to redo");
    assert_eq!(redone.layers.len(), 1);
    let state = glyph_state(&bridge, "A");
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
    assert_eq!(glyph_state(&bridge, "A").structure.anchors.len(), 1);
  }

  fn glyph_state(bridge: &Bridge, name: &str) -> NapiGlyphState {
    let glyph_id = bridge
      .get_glyphs()
      .unwrap()
      .into_iter()
      .find(|record| record.name == name)
      .expect("glyph record should exist")
      .id;

    bridge
      .get_glyph(glyph_id, default_source_id(bridge))
      .unwrap()
      .expect("glyph state should be readable")
  }

  fn contour_point_count(bridge: &Bridge) -> usize {
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
    assert_eq!(contour_point_count(&bridge), 1);

    let undone = bridge.undo().unwrap().expect("one entry to undo");
    assert_eq!(undone.layers.len(), 1);
    assert_eq!(contour_point_count(&bridge), 0);

    let redone = bridge.redo().unwrap().expect("one entry to redo");
    assert_eq!(redone.layers.len(), 1);
    assert_eq!(contour_point_count(&bridge), 1);
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
    assert_eq!(contour_point_count(&bridge), 1);
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
    assert_eq!(contour_point_count(&bridge), 2);

    bridge
      .undo()
      .unwrap()
      .expect("removePoints must be undoable");
    assert_eq!(contour_point_count(&bridge), 3);
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

  fn default_source_id(bridge: &Bridge) -> String {
    bridge.get_sources().unwrap()[0].id.clone()
  }

  fn create_default_glyph_layer(bridge: &mut Bridge, name: &str, unicode: Option<u32>) -> String {
    let mut intent = skeleton_intent("createGlyph");
    intent.name = Some(name.to_string());
    intent.unicodes = Some(unicode.into_iter().collect());

    let applied = bridge.apply(vec![intent], None).unwrap();
    applied.layers[0].layer_id.clone()
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
    assert_eq!(metrics.ascender, 800.0);
    assert_eq!(metrics.descender, -200.0);
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
  fn get_glyph_reads_applied_edits() {
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

    let state = glyph_state(&bridge, "A");

    assert_eq!(state.layer_id, layer_id);
    assert_eq!(state.structure.contours.len(), 1);
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(&state.values[..], &[500.0, 10.0, 20.0]);
  }

  #[test]
  fn get_glyph_returns_none_for_missing_glyph() {
    let bridge = bridge_with_workspace();
    let missing_glyph_id = shift_font::GlyphId::new().to_string();

    assert!(bridge
      .get_glyph(missing_glyph_id, default_source_id(&bridge))
      .unwrap()
      .is_none());
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
