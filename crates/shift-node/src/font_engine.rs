use napi::bindgen_prelude::*;
use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{
  curve::segment_bounds,
  edit_session::EditSession,
  font_loader::FontLoader,
  snapshot::{CommandResult, GlyphSnapshot, RenderContourSnapshot, RenderPointSnapshot},
  AnchorId, ContourId, CurveSegment, CurveSegmentIter, Font, FontWriter, Glyph, GlyphLayer,
  LayerId, PasteContour, Point, PointId, PointType, UfoWriter,
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

#[derive(Clone)]
struct ResolvedContour {
  points: Vec<Point>,
  closed: bool,
}

#[derive(Clone, Copy)]
struct AffineMatrix {
  xx: f64,
  xy: f64,
  yx: f64,
  yy: f64,
  dx: f64,
  dy: f64,
}

impl AffineMatrix {
  fn from_values(xx: f64, xy: f64, yx: f64, yy: f64, dx: f64, dy: f64) -> Self {
    Self {
      xx,
      xy,
      yx,
      yy,
      dx,
      dy,
    }
  }

  /// Compose transforms as `self ∘ other` (apply `other`, then `self`).
  fn multiply(self, other: Self) -> Self {
    Self {
      xx: self.xx * other.xx + self.yx * other.xy,
      xy: self.xy * other.xx + self.yy * other.xy,
      yx: self.xx * other.yx + self.yx * other.yy,
      yy: self.xy * other.yx + self.yy * other.yy,
      dx: self.xx * other.dx + self.yx * other.dy + self.dx,
      dy: self.xy * other.dx + self.yy * other.dy + self.dy,
    }
  }

  fn transform_point(self, x: f64, y: f64) -> (f64, f64) {
    (
      self.xx * x + self.yx * y + self.dx,
      self.xy * x + self.yy * y + self.dy,
    )
  }
}

fn layer_complexity(layer: &GlyphLayer) -> usize {
  layer.contours().len() + layer.components().len()
}

fn layer_to_svg_path(layer: &GlyphLayer, component_contours: &[ResolvedContour]) -> String {
  let mut parts: Vec<String> = Vec::new();
  for contour in layer.contours_iter() {
    let d = contour_to_svg_d(contour.points(), contour.is_closed());
    if !d.is_empty() {
      parts.push(d);
    }
  }
  for contour in component_contours {
    let d = contour_to_svg_d(&contour.points, contour.closed);
    if !d.is_empty() {
      parts.push(d);
    }
  }
  parts.join(" ")
}

fn accumulate_contour_bbox(
  points: &[Point],
  closed: bool,
  min_x: &mut f64,
  min_y: &mut f64,
  max_x: &mut f64,
  max_y: &mut f64,
  any: &mut bool,
) {
  for segment in CurveSegmentIter::new(points, closed) {
    let (sx, sy, ex, ey) = segment_bounds(&segment);
    *min_x = min_x.min(sx);
    *min_y = min_y.min(sy);
    *max_x = max_x.max(ex);
    *max_y = max_y.max(ey);
    *any = true;
  }
}

fn layer_bbox(
  layer: &GlyphLayer,
  component_contours: &[ResolvedContour],
) -> Option<(f64, f64, f64, f64)> {
  let mut min_x = f64::MAX;
  let mut min_y = f64::MAX;
  let mut max_x = f64::MIN;
  let mut max_y = f64::MIN;
  let mut any = false;

  for contour in layer.contours_iter() {
    accumulate_contour_bbox(
      contour.points(),
      contour.is_closed(),
      &mut min_x,
      &mut min_y,
      &mut max_x,
      &mut max_y,
      &mut any,
    );
  }

  for contour in component_contours {
    accumulate_contour_bbox(
      &contour.points,
      contour.closed,
      &mut min_x,
      &mut min_y,
      &mut max_x,
      &mut max_y,
      &mut any,
    );
  }

  if any {
    Some((min_x, min_y, max_x, max_y))
  } else {
    None
  }
}

fn contour_to_svg_d(points: &[Point], closed: bool) -> String {
  if points.len() < 2 {
    return String::new();
  }

  let mut out = Vec::new();
  let mut first = true;

  for seg in CurveSegmentIter::new(points, closed) {
    match seg {
      CurveSegment::Line(p1, p2) => {
        if first {
          out.push(format!("M {} {}", p1.x(), p1.y()));
          first = false;
        }
        out.push(format!("L {} {}", p2.x(), p2.y()));
      }
      CurveSegment::Quad(p1, cp, p2) => {
        if first {
          out.push(format!("M {} {}", p1.x(), p1.y()));
          first = false;
        }
        out.push(format!("Q {} {} {} {}", cp.x(), cp.y(), p2.x(), p2.y()));
      }
      CurveSegment::Cubic(p1, cp1, cp2, p2) => {
        if first {
          out.push(format!("M {} {}", p1.x(), p1.y()));
          first = false;
        }
        out.push(format!(
          "C {} {} {} {} {} {}",
          cp1.x(),
          cp1.y(),
          cp2.x(),
          cp2.y(),
          p2.x(),
          p2.y()
        ));
      }
    }
  }

  if closed && !out.is_empty() {
    out.push("Z".to_string());
  }
  out.join(" ")
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
    }
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> Result<()> {
    self.font = self
      .font_loader
      .read_font(&path)
      .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to load font: {e}")))?;
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

  fn preferred_layer_for_glyph(glyph: &Glyph) -> Option<&GlyphLayer> {
    glyph
      .layers()
      .values()
      .max_by_key(|layer| layer_complexity(layer))
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
    let layer = Self::preferred_layer_for_glyph(glyph)?;
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

  fn glyph_layer_by_name(&self, glyph_name: &str) -> Option<&GlyphLayer> {
    if let (Some(session), Some(glyph)) = (&self.current_edit_session, &self.editing_glyph) {
      if glyph.name() == glyph_name {
        return Some(session.layer());
      }
    }

    self
      .font
      .glyph(glyph_name)
      .and_then(Self::preferred_layer_for_glyph)
  }

  fn transform_contour_points(
    contour: &shift_core::Contour,
    transform: AffineMatrix,
  ) -> ResolvedContour {
    let points = contour
      .points()
      .iter()
      .map(|point| {
        let (x, y) = transform.transform_point(point.x(), point.y());
        Point::new(PointId::new(), x, y, point.point_type(), point.is_smooth())
      })
      .collect();

    ResolvedContour {
      points,
      closed: contour.is_closed(),
    }
  }

  fn flatten_component_named(
    &self,
    glyph_name: &str,
    transform: AffineMatrix,
    visiting: &mut HashSet<String>,
    out: &mut Vec<ResolvedContour>,
  ) {
    // Cycles are skipped branch-locally so non-cyclic components still render.
    if !visiting.insert(glyph_name.to_string()) {
      composite_debug!(
        "cycle detected while flattening '{}'; skipping branch",
        glyph_name
      );
      return;
    }

    if let Some(layer) = self.glyph_layer_by_name(glyph_name) {
      composite_debug!(
        "flatten '{}' (contours={}, components={})",
        glyph_name,
        layer.contours().len(),
        layer.components().len()
      );
      for contour in layer.contours_iter() {
        out.push(Self::transform_contour_points(contour, transform));
      }

      for component in layer.components_iter() {
        let matrix = component.matrix();
        let component_transform = AffineMatrix::from_values(
          matrix.xx, matrix.xy, matrix.yx, matrix.yy, matrix.dx, matrix.dy,
        );
        self.flatten_component_named(
          component.base_glyph(),
          transform.multiply(component_transform),
          visiting,
          out,
        );
      }
    } else {
      composite_debug!("missing glyph/layer for component '{}'", glyph_name);
    }

    visiting.remove(glyph_name);
  }

  fn flatten_component_contours_for_layer(
    &self,
    layer: &GlyphLayer,
    root_glyph_name: &str,
  ) -> Vec<ResolvedContour> {
    composite_debug!(
      "begin flatten root='{}' root_contours={} root_components={}",
      root_glyph_name,
      layer.contours().len(),
      layer.components().len()
    );
    let mut out = Vec::new();
    let mut visiting = HashSet::new();
    visiting.insert(root_glyph_name.to_string());

    for component in layer.components_iter() {
      composite_debug!(
        "root '{}' component base='{}' matrix=({}, {}, {}, {}, {}, {})",
        root_glyph_name,
        component.base_glyph(),
        component.matrix().xx,
        component.matrix().xy,
        component.matrix().yx,
        component.matrix().yy,
        component.matrix().dx,
        component.matrix().dy
      );
      let matrix = component.matrix();
      let component_transform = AffineMatrix::from_values(
        matrix.xx, matrix.xy, matrix.yx, matrix.yy, matrix.dx, matrix.dy,
      );
      self.flatten_component_named(
        component.base_glyph(),
        component_transform,
        &mut visiting,
        &mut out,
      );
    }

    composite_debug!(
      "flatten result root='{}' flattened_contours={}",
      root_glyph_name,
      out.len()
    );
    out
  }

  fn resolved_to_render_contours(resolved: &[ResolvedContour]) -> Vec<RenderContourSnapshot> {
    resolved
      .iter()
      .map(|contour| RenderContourSnapshot {
        points: contour
          .points
          .iter()
          .map(|point| RenderPointSnapshot {
            x: point.x(),
            y: point.y(),
            point_type: point.point_type().into(),
            smooth: point.is_smooth(),
          })
          .collect(),
        closed: contour.closed,
      })
      .collect()
  }

  fn enrich_snapshot_with_composites(&self, snapshot: &mut GlyphSnapshot) {
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
    snapshot.composite_contours = Self::resolved_to_render_contours(&resolved);
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

  fn editing_layer_for(&self, unicode: u32) -> Option<&GlyphLayer> {
    if let Some(session) = &self.current_edit_session {
      if session.unicode() == unicode {
        return Some(session.layer());
      }
    }
    let glyph = self.font.glyph_by_unicode(unicode)?;
    Self::preferred_layer_for_glyph(glyph)
  }

  #[napi]
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
  pub fn get_glyph_advance(&self, unicode: u32) -> Option<f64> {
    let layer = self.editing_layer_for(unicode)?;
    Some(layer.width())
  }

  #[napi]
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

  // ═══════════════════════════════════════════════════════════
  // EDIT SESSIONS
  // ═══════════════════════════════════════════════════════════

  #[napi]
  pub fn start_edit_session(&mut self, unicode: u32) -> Result<()> {
    if self.current_edit_session.is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        "Edit session already active. End the current session first.",
      ));
    }

    let glyph_name = self
      .font
      .glyph_by_unicode(unicode)
      .map(|g| g.name().to_string());

    let mut glyph = if let Some(name) = &glyph_name {
      self
        .font
        .take_glyph(name)
        .unwrap_or_else(|| Glyph::with_unicode(name.clone(), unicode))
    } else {
      let name = char::from_u32(unicode)
        .map(|c| c.to_string())
        .unwrap_or_else(|| format!("uni{unicode:04X}"));
      Glyph::with_unicode(name, unicode)
    };

    composite_debug!(
      "start_edit_session U+{:04X}: glyph='{}' layers={}",
      unicode,
      glyph.name(),
      glyph.layers().len()
    );
    let (layer_id, layer) = glyph
      .layers()
      .iter()
      .max_by_key(|(_, l)| layer_complexity(l))
      .map(|(id, _)| *id)
      .and_then(|id| glyph.remove_layer(id).map(|l| (id, l)))
      .unwrap_or_else(|| (self.font.default_layer_id(), GlyphLayer::with_width(500.0)));

    composite_debug!(
      "start_edit_session selected layer {} -> contours={} components={} anchors={}",
      layer_id,
      layer.contours().len(),
      layer.components().len(),
      layer.anchors().len()
    );

    let edit_session = EditSession::new(glyph.name().to_string(), unicode, layer);

    self.current_edit_session = Some(edit_session);
    self.editing_glyph = Some(glyph);
    self.editing_layer_id = Some(layer_id);

    Ok(())
  }

  fn get_edit_session(&mut self) -> Result<&mut EditSession> {
    self
      .current_edit_session
      .as_mut()
      .ok_or(Error::new(Status::GenericFailure, "No edit session active"))
  }

  fn command(&mut self, f: impl FnOnce(&mut EditSession) -> Vec<PointId>) -> Result<String> {
    let mut result = {
      let session = self.get_edit_session()?;
      let ids = f(session);
      CommandResult::success(session, ids)
    };
    self.enrich_command_result_with_composites(&mut result);
    Ok(to_json(&result))
  }

  fn command_simple(&mut self, f: impl FnOnce(&mut EditSession)) -> Result<String> {
    let mut result = {
      let session = self.get_edit_session()?;
      f(session);
      CommandResult::success_simple(session)
    };
    self.enrich_command_result_with_composites(&mut result);
    Ok(to_json(&result))
  }

  fn command_try(
    &mut self,
    f: impl FnOnce(&mut EditSession) -> std::result::Result<Vec<PointId>, String>,
  ) -> Result<String> {
    let mut result = {
      let session = self.get_edit_session()?;
      match f(session) {
        Ok(ids) => CommandResult::success(session, ids),
        Err(e) => CommandResult::error(e),
      }
    };
    self.enrich_command_result_with_composites(&mut result);
    Ok(to_json(&result))
  }

  fn command_try_simple(
    &mut self,
    f: impl FnOnce(&mut EditSession) -> std::result::Result<(), String>,
  ) -> Result<String> {
    let mut result = {
      let session = self.get_edit_session()?;
      match f(session) {
        Ok(()) => CommandResult::success_simple(session),
        Err(e) => CommandResult::error(e),
      }
    };
    self.enrich_command_result_with_composites(&mut result);
    Ok(to_json(&result))
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
    let mut result = {
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

    self.enrich_command_result_with_composites(&mut result);
    Ok(to_json(&result))
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
    let parsed_ids: Vec<PointId> = point_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<PointId>().ok())
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(to_json(&CommandResult::error(
        "No valid point IDs provided",
      )));
    }

    self.command(|s| s.move_points(&parsed_ids, dx, dy))
  }

  #[napi]
  pub fn move_anchors(&mut self, anchor_ids: Vec<String>, dx: f64, dy: f64) -> Result<String> {
    let parsed_ids: Vec<AnchorId> = anchor_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<AnchorId>().ok())
      .collect();

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
    let parsed_ids: Vec<PointId> = point_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<PointId>().ok())
      .collect();

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
  pub fn set_point_positions(&mut self, moves: Vec<JSPointMove>) -> Result<bool> {
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
  pub fn set_anchor_positions(&mut self, moves: Vec<JSAnchorMove>) -> Result<bool> {
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
pub struct JSPointMove {
  pub id: String,
  pub x: f64,
  pub y: f64,
}

/// Input type for set_anchor_positions - a single anchor move
#[napi(object)]
pub struct JSAnchorMove {
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
