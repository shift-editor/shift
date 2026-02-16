use napi::bindgen_prelude::*;
use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{
  composite::{
    flatten_component_contours_for_layer as flatten_component_contours, layer_bbox,
    layer_complexity, layer_to_svg_path, preferred_layer_for_glyph,
    resolve_component_instances_for_layer, resolved_to_render_contours, GlyphLayerProvider,
  },
  dependency_graph::DependencyGraph,
  edit_session::EditSession,
  font_loader::FontLoader,
  snapshot::{CommandResult, GlyphSnapshot, RenderContourSnapshot},
  AnchorId, ContourId, Font, FontWriter, Glyph, GlyphLayer, LayerId, PasteContour, PointId,
  PointType, UfoWriter,
};
use std::collections::HashSet;

fn to_json(value: &impl serde::Serialize) -> String {
  serde_json::to_string(value).expect("NAPI result serialization failed")
}

macro_rules! composite_debug {
  ($($arg:tt)*) => {};
}

macro_rules! parse_or_err {
  ($id_str:expr, $ty:ty, $label:expr) => {
    match $id_str.parse::<$ty>() {
      Ok(id) => id,
      Err(_) => {
        return Ok(to_json(&CommandResult::error(format!(
          concat!("Invalid ", $label, ": {}"),
          $id_str
        ))))
      }
    }
  };
}

/// Node-side layer provider that gives precedence to the active edit session.
///
/// This lets composite resolution observe unsaved in-session edits while still
/// falling back to persisted font layers for other glyphs.
struct EngineLayerProvider<'a> {
  font: &'a Font,
  current_edit_session: Option<&'a EditSession>,
  editing_glyph_name: Option<&'a str>,
}

impl GlyphLayerProvider for EngineLayerProvider<'_> {
  /// Resolves a glyph layer using session-first semantics.
  fn glyph_layer(&self, glyph_name: &str) -> Option<&GlyphLayer> {
    if let (Some(session), Some(editing_glyph_name)) =
      (self.current_edit_session, self.editing_glyph_name)
    {
      if editing_glyph_name == glyph_name {
        return Some(session.layer());
      }
    }

    self
      .font
      .glyph(glyph_name)
      .and_then(preferred_layer_for_glyph)
  }
}

fn parse_ids<T: std::str::FromStr>(ids: &[String]) -> Vec<T> {
  ids.iter().filter_map(|id| id.parse::<T>().ok()).collect()
}

pub struct SaveFontTask {
  font: Font,
  path: String,
}

impl Task for SaveFontTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<Self::Output> {
    UfoWriter::new()
      .save(&self.font, &self.path)
      .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to save font: {e}")))
  }

  fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

#[napi]
pub struct FontEngine {
  font_loader: FontLoader,
  current_edit_session: Option<EditSession>,
  editing_glyph: Option<Glyph>,
  editing_layer_id: Option<LayerId>,
  font: Font,
  dependency_graph: DependencyGraph,
}

impl Default for FontEngine {
  fn default() -> Self {
    Self::new()
  }
}

#[napi]
impl FontEngine {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      current_edit_session: None,
      editing_glyph: None,
      editing_layer_id: None,
      font: Font::default(),
      dependency_graph: DependencyGraph::default(),
    }
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> Result<()> {
    self.font = self
      .font_loader
      .read_font(&path)
      .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to load font: {e}")))?;
    self.dependency_graph = DependencyGraph::rebuild(&self.font);
    Ok(())
  }

  #[napi]
  pub fn save_font(&mut self, path: String) -> Result<()> {
    let backup = self.apply_edits_for_save();

    let result = self
      .font_loader
      .write_font(&self.font, &path)
      .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to save font: {e}")));

    self.restore_from_backup(backup);

    result
  }

  #[napi(ts_return_type = "Promise<void>")]
  pub fn save_font_async(&mut self, path: String) -> AsyncTask<SaveFontTask> {
    let backup = self.apply_edits_for_save();
    let font = self.font.clone();
    self.restore_from_backup(backup);

    AsyncTask::new(SaveFontTask { font, path })
  }

  fn apply_edits_for_save(&mut self) -> Option<(String, Glyph)> {
    let (session, glyph, layer_id) = match (
      &self.current_edit_session,
      &self.editing_glyph,
      &self.editing_layer_id,
    ) {
      (Some(s), Some(g), Some(l)) => (s, g, l),
      _ => return None,
    };

    let glyph_name = glyph.name().to_string();
    let original = self.font.take_glyph(&glyph_name);

    let mut glyph_copy = glyph.clone();
    let layer = session.layer().clone();
    glyph_copy.set_layer(*layer_id, layer);
    self.font.put_glyph(glyph_copy);

    let backup_glyph = original.unwrap_or_else(|| Glyph::new(glyph_name.clone()));
    Some((glyph_name, backup_glyph))
  }

  fn restore_from_backup(&mut self, backup: Option<(String, Glyph)>) {
    if let Some((_, original_glyph)) = backup {
      self.font.put_glyph(original_glyph);
    }
  }

  fn layer_provider(&self) -> EngineLayerProvider<'_> {
    EngineLayerProvider {
      font: &self.font,
      current_edit_session: self.current_edit_session.as_ref(),
      editing_glyph_name: self.editing_glyph.as_ref().map(|glyph| glyph.name()),
    }
  }

  fn glyph_name_for_unicode(&self, unicode: u32) -> Option<String> {
    if let Some(session) = &self.current_edit_session {
      if session.unicode() == unicode {
        return Some(session.glyph_name().to_string());
      }
    }

    self
      .font
      .glyph_by_unicode(unicode)
      .map(|glyph| glyph.name().to_string())
  }

  fn collect_unicodes_for_glyph_name(&self, glyph_name: &str, out: &mut HashSet<u32>) {
    if let Some(session) = &self.current_edit_session {
      if session.glyph_name() == glyph_name {
        out.insert(session.unicode());
      }
    }

    if let Some(glyph) = self.font.glyph(glyph_name) {
      out.extend(glyph.unicodes().iter().copied());
    }
  }

  fn editing_target_for_unicode(&self, unicode: u32) -> Option<(&str, &GlyphLayer)> {
    if let Some(session) = &self.current_edit_session {
      if session.unicode() == unicode {
        composite_debug!(
          "editing_target_for_unicode U+{:04X}: using active session '{}' (contours={}, components={}, anchors={})",
          unicode,
          session.glyph_name(),
          session.layer().contours().len(),
          session.layer().components().len(),
          session.layer().anchors().len()
        );
        return Some((session.glyph_name(), session.layer()));
      }
    }

    let glyph = self.font.glyph_by_unicode(unicode)?;
    let layer = preferred_layer_for_glyph(glyph)?;
    composite_debug!(
      "editing_target_for_unicode U+{:04X}: from font glyph='{}' (contours={}, components={}, anchors={})",
      unicode,
      glyph.name(),
      layer.contours().len(),
      layer.components().len(),
      layer.anchors().len()
    );
    Some((glyph.name(), layer))
  }

  fn editing_target_for_name(&self, glyph_name: &str) -> Option<(&str, &GlyphLayer)> {
    if let Some(session) = &self.current_edit_session {
      if session.glyph_name() == glyph_name {
        return Some((session.glyph_name(), session.layer()));
      }
    }

    let glyph = self.font.glyph(glyph_name)?;
    let layer = preferred_layer_for_glyph(glyph)?;
    Some((glyph.name(), layer))
  }

  fn glyph_layer_by_name(&self, glyph_name: &str) -> Option<&GlyphLayer> {
    if let (Some(session), Some(glyph)) = (&self.current_edit_session, &self.editing_glyph) {
      if glyph.name() == glyph_name {
        return Some(session.layer());
      }
    }

    self
      .font
      .glyph(glyph_name)
      .and_then(preferred_layer_for_glyph)
  }

  fn flatten_component_contours_for_layer(
    &self,
    layer: &GlyphLayer,
    root_glyph_name: &str,
  ) -> Vec<shift_core::composite::ResolvedContour> {
    let provider = self.layer_provider();
    flatten_component_contours(&provider, layer, root_glyph_name)
  }

  fn resolve_component_instances_for_layer(
    &self,
    layer: &GlyphLayer,
    root_glyph_name: &str,
  ) -> Vec<shift_core::composite::ResolvedComponentInstance> {
    let provider = self.layer_provider();
    resolve_component_instances_for_layer(&provider, layer, root_glyph_name)
  }

  fn enrich_snapshot_with_composites(&self, snapshot: &mut GlyphSnapshot) {
    // Re-resolve composite geometry from the best available layer view
    // (session-first, then persisted font).
    let maybe_layer = if let Some(session) = &self.current_edit_session {
      if session.unicode() == snapshot.unicode && session.glyph_name() == snapshot.name {
        Some(session.layer())
      } else {
        self.glyph_layer_by_name(&snapshot.name)
      }
    } else {
      self.glyph_layer_by_name(&snapshot.name)
    };

    let Some(layer) = maybe_layer else {
      snapshot.composite_contours.clear();
      composite_debug!(
        "snapshot '{}' U+{:04X}: no layer found; composite_contours cleared",
        snapshot.name,
        snapshot.unicode
      );
      return;
    };

    let resolved = self.flatten_component_contours_for_layer(layer, &snapshot.name);
    snapshot.composite_contours = resolved_to_render_contours(&resolved);
    composite_debug!(
      "snapshot '{}' U+{:04X}: contours={} anchors={} composite_contours={}",
      snapshot.name,
      snapshot.unicode,
      snapshot.contours.len(),
      snapshot.anchors.len(),
      snapshot.composite_contours.len()
    );
  }

  fn enrich_command_result_with_composites(&self, result: &mut CommandResult) {
    if let Some(snapshot) = result.snapshot.as_mut() {
      self.enrich_snapshot_with_composites(snapshot);
    }
  }

  #[napi]
  pub fn get_metadata(&self) -> String {
    to_json(self.font.metadata())
  }

  #[napi]
  pub fn get_metrics(&self) -> String {
    to_json(self.font.metrics())
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.glyph_count() as u32
  }

  #[napi]
  pub fn get_glyph_unicodes(&self) -> Vec<u32> {
    let mut unicodes: Vec<u32> = self
      .font
      .glyphs()
      .values()
      .flat_map(|g| g.unicodes().iter().copied())
      .collect();
    unicodes.sort_unstable();
    unicodes.dedup();
    unicodes
  }

  #[napi]
  pub fn get_glyph_name_for_unicode(&self, unicode: u32) -> Option<String> {
    self.glyph_name_for_unicode(unicode)
  }

  #[napi]
  pub fn get_glyph_unicodes_for_name(&self, glyph_name: String) -> Vec<u32> {
    if let Some(session) = &self.current_edit_session {
      if session.glyph_name() == glyph_name {
        if let Some(glyph) = self.editing_glyph.as_ref() {
          return glyph.unicodes().to_vec();
        }
      }
    }

    self
      .font
      .glyph(&glyph_name)
      .map(|glyph| glyph.unicodes().to_vec())
      .unwrap_or_default()
  }

  #[napi]
  /// Returns all Unicode codepoints whose glyphs depend on `unicode` via
  /// component relationships (transitively).
  pub fn get_dependent_unicodes(&self, unicode: u32) -> Vec<u32> {
    let Some(glyph_name) = self.glyph_name_for_unicode(unicode) else {
      return Vec::new();
    };

    let dependent_names = self.dependency_graph.dependents_recursive(&glyph_name);
    let mut unicodes = HashSet::new();

    for dependent_name in dependent_names {
      self.collect_unicodes_for_glyph_name(&dependent_name, &mut unicodes);
    }

    let mut sorted: Vec<u32> = unicodes.into_iter().collect();
    sorted.sort_unstable();
    sorted
  }

  #[napi]
  pub fn get_dependent_unicodes_by_name(&self, glyph_name: String) -> Vec<u32> {
    let dependent_names = self.dependency_graph.dependents_recursive(&glyph_name);
    let mut unicodes = HashSet::new();

    for dependent_name in dependent_names {
      self.collect_unicodes_for_glyph_name(&dependent_name, &mut unicodes);
    }

    let mut sorted: Vec<u32> = unicodes.into_iter().collect();
    sorted.sort_unstable();
    sorted
  }

  fn editing_layer_for(&self, unicode: u32) -> Option<&GlyphLayer> {
    if let Some(session) = &self.current_edit_session {
      if session.unicode() == unicode {
        return Some(session.layer());
      }
    }
    let glyph = self.font.glyph_by_unicode(unicode)?;
    preferred_layer_for_glyph(glyph)
  }

  #[napi]
  /// Returns SVG path data for the glyph, including resolved component
  /// contours from composite dependencies.
  pub fn get_glyph_svg_path(&self, unicode: u32) -> Option<String> {
    let (glyph_name, layer) = self.editing_target_for_unicode(unicode)?;
    let component_contours = self.flatten_component_contours_for_layer(layer, glyph_name);
    let path = layer_to_svg_path(layer, &component_contours);
    if path.is_empty() {
      composite_debug!(
        "get_glyph_svg_path U+{:04X} '{}': empty path (contours={}, components={}, flattened_contours={})",
        unicode,
        glyph_name,
        layer.contours().len(),
        layer.components().len(),
        component_contours.len()
      );
      return None;
    }
    composite_debug!(
      "get_glyph_svg_path U+{:04X} '{}': path chars={} (contours={}, components={}, flattened_contours={})",
      unicode,
      glyph_name,
      path.len(),
      layer.contours().len(),
      layer.components().len(),
      component_contours.len()
    );
    Some(path)
  }

  #[napi]
  pub fn get_glyph_svg_path_by_name(&self, glyph_name: String) -> Option<String> {
    let (resolved_name, layer) = self.editing_target_for_name(&glyph_name)?;
    let component_contours = self.flatten_component_contours_for_layer(layer, resolved_name);
    let path = layer_to_svg_path(layer, &component_contours);
    if path.is_empty() {
      return None;
    }
    Some(path)
  }

  #[napi]
  pub fn get_glyph_advance(&self, unicode: u32) -> Option<f64> {
    let layer = self.editing_layer_for(unicode)?;
    Some(layer.width())
  }

  #[napi]
  pub fn get_glyph_advance_by_name(&self, glyph_name: String) -> Option<f64> {
    let (_, layer) = self.editing_target_for_name(&glyph_name)?;
    Some(layer.width())
  }

  #[napi]
  /// Returns a tight bounding box `[min_x, min_y, max_x, max_y]` for the glyph,
  /// including resolved component contours.
  pub fn get_glyph_bbox(&self, unicode: u32) -> Option<Vec<f64>> {
    let (glyph_name, layer) = self.editing_target_for_unicode(unicode)?;
    let component_contours = self.flatten_component_contours_for_layer(layer, glyph_name);
    let bbox = layer_bbox(layer, &component_contours);
    if bbox.is_none() {
      composite_debug!(
        "get_glyph_bbox U+{:04X} '{}': empty bbox (contours={}, components={}, flattened_contours={})",
        unicode,
        glyph_name,
        layer.contours().len(),
        layer.components().len(),
        component_contours.len()
      );
    }
    bbox.map(|(min_x, min_y, max_x, max_y)| vec![min_x, min_y, max_x, max_y])
  }

  #[napi]
  pub fn get_glyph_bbox_by_name(&self, glyph_name: String) -> Option<Vec<f64>> {
    let (resolved_name, layer) = self.editing_target_for_name(&glyph_name)?;
    let component_contours = self.flatten_component_contours_for_layer(layer, resolved_name);
    let bbox = layer_bbox(layer, &component_contours);
    bbox.map(|(min_x, min_y, max_x, max_y)| vec![min_x, min_y, max_x, max_y])
  }

  #[napi]
  pub fn get_glyph_composite_components(&self, glyph_name: String) -> Option<String> {
    let (resolved_name, layer) = self.editing_target_for_name(&glyph_name)?;
    let instances = self.resolve_component_instances_for_layer(layer, resolved_name);

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CompositeComponentPayload {
      component_glyph_name: String,
      source_unicodes: Vec<u32>,
      contours: Vec<RenderContourSnapshot>,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CompositeComponentsPayload {
      glyph_name: String,
      components: Vec<CompositeComponentPayload>,
    }

    let components = instances
      .into_iter()
      .map(|instance| CompositeComponentPayload {
        source_unicodes: self
          .font
          .glyph(&instance.component_glyph_name)
          .map(|glyph| glyph.unicodes().to_vec())
          .unwrap_or_default(),
        component_glyph_name: instance.component_glyph_name,
        contours: resolved_to_render_contours(&instance.contours),
      })
      .collect();

    Some(to_json(&CompositeComponentsPayload {
      glyph_name: resolved_name.to_string(),
      components,
    }))
  }

  // ═══════════════════════════════════════════════════════════
  // EDIT SESSIONS
  // ═══════════════════════════════════════════════════════════

  fn start_edit_session_for_name(
    &mut self,
    glyph_name: &str,
    unicode_override: Option<u32>,
  ) -> Result<()> {
    if self.current_edit_session.is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        "Edit session already active. End the current session first.",
      ));
    }

    let mut glyph = if let Some(existing) = self.font.take_glyph(glyph_name) {
      existing
    } else {
      Glyph::new(glyph_name.to_string())
    };

    let primary_unicode = unicode_override
      .or_else(|| glyph.primary_unicode())
      .unwrap_or(0);

    composite_debug!(
      "start_edit_session '{}': layers={} primary_unicode={}",
      glyph.name(),
      glyph.layers().len(),
      primary_unicode
    );
    let (layer_id, layer) = glyph
      .layers()
      .iter()
      .max_by_key(|(_, l)| layer_complexity(l))
      .map(|(id, _)| *id)
      .and_then(|id| glyph.remove_layer(id).map(|l| (id, l)))
      .unwrap_or_else(|| (self.font.default_layer_id(), GlyphLayer::with_width(500.0)));

    let edit_session = EditSession::new(glyph.name().to_string(), primary_unicode, layer);

    self.current_edit_session = Some(edit_session);
    self.editing_glyph = Some(glyph);
    self.editing_layer_id = Some(layer_id);

    Ok(())
  }

  #[napi]
  pub fn start_edit_session(&mut self, unicode: u32) -> Result<()> {
    let glyph_name = self
      .glyph_name_for_unicode(unicode)
      .unwrap_or_else(|| format!("uni{unicode:04X}"));
    self.start_edit_session_for_name(&glyph_name, Some(unicode))
  }

  #[napi]
  pub fn start_edit_session_by_name(&mut self, glyph_name: String) -> Result<()> {
    self.start_edit_session_for_name(&glyph_name, None)
  }

  fn get_edit_session(&mut self) -> Result<&mut EditSession> {
    self
      .current_edit_session
      .as_mut()
      .ok_or(Error::new(Status::GenericFailure, "No edit session active"))
  }

  fn serialize_enriched_result(&self, mut result: CommandResult) -> String {
    self.enrich_command_result_with_composites(&mut result);
    to_json(&result)
  }

  fn with_command_result(
    &mut self,
    build: impl FnOnce(&mut EditSession) -> CommandResult,
  ) -> Result<String> {
    let result = {
      let session = self.get_edit_session()?;
      build(session)
    };
    Ok(self.serialize_enriched_result(result))
  }

  fn command(&mut self, f: impl FnOnce(&mut EditSession) -> Vec<PointId>) -> Result<String> {
    self.with_command_result(|session| {
      let ids = f(session);
      CommandResult::success(session, ids)
    })
  }

  fn command_simple(&mut self, f: impl FnOnce(&mut EditSession)) -> Result<String> {
    self.with_command_result(|session| {
      f(session);
      CommandResult::success_simple(session)
    })
  }

  fn command_try(
    &mut self,
    f: impl FnOnce(&mut EditSession) -> std::result::Result<Vec<PointId>, String>,
  ) -> Result<String> {
    self.with_command_result(|session| match f(session) {
      Ok(ids) => CommandResult::success(session, ids),
      Err(e) => CommandResult::error(e),
    })
  }

  fn command_try_simple(
    &mut self,
    f: impl FnOnce(&mut EditSession) -> std::result::Result<(), String>,
  ) -> Result<String> {
    self.with_command_result(|session| match f(session) {
      Ok(()) => CommandResult::success_simple(session),
      Err(e) => CommandResult::error(e),
    })
  }

  #[napi]
  pub fn end_edit_session(&mut self) -> Result<()> {
    let session = self
      .current_edit_session
      .take()
      .ok_or(Error::new(Status::GenericFailure, "No edit session to end"))?;

    let mut glyph = self.editing_glyph.take().ok_or(Error::new(
      Status::GenericFailure,
      "No glyph stored for session",
    ))?;

    let layer_id = self.editing_layer_id.take().ok_or(Error::new(
      Status::GenericFailure,
      "No layer ID stored for session",
    ))?;

    let layer = session.into_layer();
    glyph.set_layer(layer_id, layer);
    self.font.put_glyph(glyph);
    self.dependency_graph = DependencyGraph::rebuild(&self.font);

    Ok(())
  }

  #[napi]
  pub fn has_edit_session(&self) -> bool {
    self.current_edit_session.is_some()
  }

  #[napi]
  pub fn get_editing_unicode(&self) -> Option<u32> {
    self.current_edit_session.as_ref().map(|s| s.unicode())
  }

  #[napi]
  pub fn get_editing_glyph_name(&self) -> Option<String> {
    self
      .current_edit_session
      .as_ref()
      .map(|s| s.glyph_name().to_string())
  }

  pub fn add_empty_contour(&mut self) -> Result<String> {
    let edit_session = self.get_edit_session()?;
    let contour_id = edit_session.add_empty_contour();
    Ok(contour_id.to_string())
  }

  #[napi]
  pub fn get_active_contour_id(&mut self) -> Result<Option<String>> {
    let edit_session = self.get_edit_session()?;
    Ok(edit_session.active_contour_id().map(|id| id.to_string()))
  }

  #[napi]
  pub fn set_x_advance(&mut self, width: f64) -> Result<String> {
    self.command_simple(|s| s.set_x_advance(width))
  }

  #[napi]
  pub fn set_active_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_simple(|s| s.set_active_contour(cid))
  }

  #[napi]
  pub fn clear_active_contour(&mut self) -> Result<String> {
    self.command_simple(|s| s.clear_active_contour())
  }

  #[napi]
  pub fn get_snapshot_data(&self) -> Result<String> {
    let session = self
      .current_edit_session
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "No edit session active"))?;

    let mut snapshot = GlyphSnapshot::from_edit_session(session);
    self.enrich_snapshot_with_composites(&mut snapshot);
    composite_debug!(
      "get_snapshot_data '{}' U+{:04X}: contours={} anchors={} composite_contours={}",
      snapshot.name,
      snapshot.unicode,
      snapshot.contours.len(),
      snapshot.anchors.len(),
      snapshot.composite_contours.len()
    );

    Ok(to_json(&snapshot))
  }

  #[napi]
  pub fn add_point(&mut self, x: f64, y: f64, point_type: String, smooth: bool) -> Result<String> {
    let pt = parse_or_err!(point_type, PointType, "point type");
    self.command_try(|s| s.add_point(x, y, pt, smooth).map(|id| vec![id]))
  }

  #[napi]
  pub fn add_point_to_contour(
    &mut self,
    contour_id: String,
    x: f64,
    y: f64,
    point_type: String,
    smooth: bool,
  ) -> Result<String> {
    let pt = parse_or_err!(point_type, PointType, "point type");
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_try(|s| {
      s.add_point_to_contour(cid, x, y, pt, smooth)
        .map(|id| vec![id])
    })
  }

  #[napi]
  pub fn insert_point_before(
    &mut self,
    before_point_id: String,
    x: f64,
    y: f64,
    point_type: String,
    smooth: bool,
  ) -> Result<String> {
    let pt = parse_or_err!(point_type, PointType, "point type");
    let before_id = parse_or_err!(before_point_id, PointId, "point ID");
    self.command_try(|s| {
      s.insert_point_before(before_id, x, y, pt, smooth)
        .map(|id| vec![id])
    })
  }

  #[napi]
  pub fn add_contour(&mut self) -> Result<String> {
    self.command_simple(|s| {
      s.add_empty_contour();
    })
  }

  #[napi]
  pub fn close_contour(&mut self) -> Result<String> {
    let result = {
      let session = self.get_edit_session()?;

      let contour_id = match session.active_contour_id() {
        Some(id) => id,
        None => return Ok(to_json(&CommandResult::error("No active contour"))),
      };

      match session.close_contour(contour_id) {
        Ok(_) => CommandResult::success_simple(session),
        Err(e) => CommandResult::error(e),
      }
    };

    Ok(self.serialize_enriched_result(result))
  }

  #[napi]
  pub fn open_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_try_simple(|s| s.open_contour(cid))
  }

  #[napi]
  pub fn reverse_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_try_simple(|s| s.reverse_contour(cid))
  }

  #[napi]
  pub fn move_points(&mut self, point_ids: Vec<String>, dx: f64, dy: f64) -> Result<String> {
    let parsed_ids: Vec<PointId> = parse_ids(&point_ids);

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(to_json(&CommandResult::error(
        "No valid point IDs provided",
      )));
    }

    self.command(|s| s.move_points(&parsed_ids, dx, dy))
  }

  #[napi]
  pub fn move_anchors(&mut self, anchor_ids: Vec<String>, dx: f64, dy: f64) -> Result<String> {
    let parsed_ids: Vec<AnchorId> = parse_ids(&anchor_ids);

    if parsed_ids.is_empty() && !anchor_ids.is_empty() {
      return Ok(to_json(&CommandResult::error(
        "No valid anchor IDs provided",
      )));
    }

    self.command_simple(|s| {
      s.move_anchors(&parsed_ids, dx, dy);
    })
  }

  #[napi]
  pub fn remove_points(&mut self, point_ids: Vec<String>) -> Result<String> {
    let parsed_ids: Vec<PointId> = parse_ids(&point_ids);

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(to_json(&CommandResult::error(
        "No valid point IDs provided",
      )));
    }

    self.command(|s| s.remove_points(&parsed_ids))
  }

  #[napi]
  pub fn toggle_smooth(&mut self, point_id: String) -> Result<String> {
    let parsed_id = parse_or_err!(point_id, PointId, "point ID");
    self.command_try(|s| s.toggle_smooth(parsed_id).map(|_| vec![parsed_id]))
  }

  // ═══════════════════════════════════════════════════════════
  // CLIPBOARD OPERATIONS
  // ═══════════════════════════════════════════════════════════

  #[napi]
  pub fn paste_contours(
    &mut self,
    contours_json: String,
    offset_x: f64,
    offset_y: f64,
  ) -> Result<String> {
    let session = self.get_edit_session()?;

    let contours: Vec<PasteContour> = match serde_json::from_str(&contours_json) {
      Ok(c) => c,
      Err(e) => {
        return Ok(to_json(&PasteResultJson {
          success: false,
          created_point_ids: vec![],
          created_contour_ids: vec![],
          error: Some(format!("Failed to parse contours: {e}")),
        }))
      }
    };

    let result = session.paste_contours(contours, offset_x, offset_y);

    Ok(to_json(&PasteResultJson {
      success: result.success,
      created_point_ids: result
        .created_point_ids
        .iter()
        .map(|id| id.to_string())
        .collect(),
      created_contour_ids: result
        .created_contour_ids
        .iter()
        .map(|id| id.to_string())
        .collect(),
      error: result.error,
    }))
  }

  #[napi]
  pub fn remove_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_simple(|s| {
      s.remove_contour(cid);
    })
  }

  // ═══════════════════════════════════════════════════════════
  // LIGHTWEIGHT DRAG OPERATIONS (no snapshot return)
  // ═══════════════════════════════════════════════════════════

  /// Set point positions directly — fire-and-forget for drag operations.
  /// Returns true on success, false if no edit session is active.
  /// Does NOT return a snapshot — use get_snapshot_data() when needed.
  #[napi]
  pub fn set_point_positions(&mut self, moves: Vec<JsPointMove>) -> Result<bool> {
    let Some(session) = self.current_edit_session.as_mut() else {
      return Ok(false);
    };

    for m in moves {
      if let Ok(point_id) = m.id.parse::<PointId>() {
        session.set_point_position(point_id, m.x, m.y);
      }
    }

    Ok(true)
  }

  /// Set anchor positions directly — fire-and-forget for drag operations.
  /// Returns true on success, false if no edit session is active.
  /// Does NOT return a snapshot — use get_snapshot_data() when needed.
  #[napi]
  pub fn set_anchor_positions(&mut self, moves: Vec<JsAnchorMove>) -> Result<bool> {
    let Some(session) = self.current_edit_session.as_mut() else {
      return Ok(false);
    };

    for m in moves {
      if let Ok(anchor_id) = m.id.parse::<AnchorId>() {
        session.set_anchor_position(anchor_id, m.x, m.y);
      }
    }

    Ok(true)
  }

  #[napi]
  pub fn restore_snapshot(&mut self, snapshot_json: String) -> Result<bool> {
    let Some(session) = self.current_edit_session.as_mut() else {
      return Ok(false);
    };

    let snapshot: GlyphSnapshot = serde_json::from_str(&snapshot_json).map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Invalid snapshot JSON: {e}"),
      )
    })?;

    session.restore_from_snapshot(&snapshot);
    Ok(true)
  }
}

// ═══════════════════════════════════════════════════════════
// LIGHTWEIGHT NATIVE TYPES FOR DRAG OPERATIONS
// ═══════════════════════════════════════════════════════════

/// Input type for set_point_positions - a single point move
#[napi(object)]
pub struct JsPointMove {
  pub id: String,
  pub x: f64,
  pub y: f64,
}

/// Input type for set_anchor_positions - a single anchor move
#[napi(object)]
pub struct JsAnchorMove {
  pub id: String,
  pub x: f64,
  pub y: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PasteResultJson {
  success: bool,
  created_point_ids: Vec<String>,
  created_contour_ids: Vec<String>,
  error: Option<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_new_font_engine() {
    let engine = FontEngine::new();
    assert!(!engine.has_edit_session());
    assert_eq!(engine.get_glyph_count(), 0);
  }

  #[test]
  fn test_start_and_end_session() {
    let mut engine = FontEngine::new();

    engine.start_edit_session(65).unwrap();
    assert!(engine.has_edit_session());
    assert_eq!(engine.get_editing_unicode(), Some(65));

    engine.end_edit_session().unwrap();
    assert!(!engine.has_edit_session());
    assert_eq!(engine.get_editing_unicode(), None);
  }

  #[test]
  fn test_cannot_start_second_session() {
    let mut engine = FontEngine::new();

    engine.start_edit_session(65).unwrap();
    let result = engine.start_edit_session(66);

    assert!(result.is_err());
  }

  #[test]
  fn test_add_contour() {
    let mut engine = FontEngine::new();
    engine.start_edit_session(65).unwrap();

    let contour_id = engine.add_empty_contour().unwrap();
    assert!(!contour_id.is_empty());

    let active = engine.get_active_contour_id().unwrap();
    assert_eq!(active, Some(contour_id));
  }

  #[test]
  fn test_get_glyph_svg_path_after_load() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    let path = engine.get_glyph_svg_path(65);
    assert!(
      path.is_some(),
      "get_glyph_svg_path(65) should return Some for MutatorSans A"
    );
    let path = path.unwrap();
    assert!(!path.is_empty());
    assert!(path.starts_with("M "));
  }

  #[test]
  fn test_get_glyph_svg_path_for_composite_after_load() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    let path = engine.get_glyph_svg_path(0x00C1);
    assert!(
      path.is_some(),
      "get_glyph_svg_path(U+00C1) should return Some for MutatorSans Aacute"
    );
    let path = path.unwrap();
    assert!(!path.is_empty());
    assert!(path.starts_with("M "));
  }

  #[test]
  fn test_get_dependent_unicodes_includes_aacute_for_a() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    engine.start_edit_session(65).unwrap();

    let dependents = engine.get_dependent_unicodes(65);
    assert!(
      dependents.contains(&0x00C1),
      "Expected U+00C1 (Aacute) to depend on U+0041 (A), got {dependents:?}"
    );
  }

  #[test]
  fn test_get_glyph_bbox_after_load() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    let bbox = engine.get_glyph_bbox(65);
    assert!(
      bbox.is_some(),
      "get_glyph_bbox(65) should return Some for MutatorSans A"
    );
    let b = bbox.unwrap();
    assert_eq!(b.len(), 4);
    assert!(b[0] < b[2], "min_x < max_x");
    assert!(b[1] < b[3], "min_y < max_y");
  }

  #[test]
  fn test_snapshot_data_includes_composite_contours() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    engine.start_edit_session(0x00C1).unwrap();

    let snapshot_json = engine.get_snapshot_data().unwrap();
    let snapshot: GlyphSnapshot = serde_json::from_str(&snapshot_json).unwrap();
    assert!(
      !snapshot.composite_contours.is_empty(),
      "Aacute snapshot should include flattened compositeContours"
    );
  }
}
