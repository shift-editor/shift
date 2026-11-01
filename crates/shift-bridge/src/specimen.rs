use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{FontExporter, FontView, GlyphSubsetView, font_loader::FontLoader};
use shift_font::{Glyph, GlyphId};
use shift_workspace::{AcquireScope, FontWorkspace, WorkspaceError};

use crate::bridge::FontSaveSnapshot;

/// Specimen outline drawn on a recent file's thumbnail, in font units with y
/// pointing down.
#[napi(object)]
pub struct NapiSpecimen {
  /// Characters shown; empty when glyphs were chosen by glyph order.
  pub text: String,
  /// SVG path data.
  pub outline: String,
  /// SVG `viewBox` as `[x, y, width, height]`, fitted to the ink.
  pub view_box: Vec<f64>,
  /// Font units per em, to draw the specimen at a given font size.
  pub units_per_em: f64,
  pub right_to_left: bool,
  /// The family name drawn in the font for the launcher's wide tile, or null
  /// when it does not fit legibly and the tile shows this specimen instead.
  pub family_name: Option<NapiNameSpecimen>,
  /// The font's name for a caption, as `Host Grotesk Bold`; null when the
  /// font has no family name.
  pub display_name: Option<String>,
}

/// A font's family name drawn in the font and fitted to the launcher's wide
/// "Last opened" tile.
#[napi(object)]
pub struct NapiNameSpecimen {
  /// The family name: `name` ID 16, else ID 1.
  pub text: String,
  /// SVG path data in font units, y down, one or two lines.
  pub outline: String,
  /// SVG `viewBox` as `[x, y, width, height]`: the ink horizontally, so the
  /// ink starts at the left edge, and the line boxes vertically.
  pub view_box: Vec<f64>,
  /// Size to draw the `viewBox` at, in CSS pixels.
  pub width: f64,
  pub height: f64,
  pub fit: NapiNameFit,
}

/// The fitting rule that placed a family name.
#[napi(string_enum = "camelCase")]
pub enum NapiNameFit {
  /// One line at full size.
  Full,
  /// One line shrunk to fit.
  Scaled,
  /// Two lines broken at a word.
  TwoLines,
}

impl From<shift_specimen::NameFit> for NapiNameFit {
  fn from(fit: shift_specimen::NameFit) -> Self {
    match fit {
      shift_specimen::NameFit::Full => Self::Full,
      shift_specimen::NameFit::Scaled => Self::Scaled,
      shift_specimen::NameFit::TwoLines => Self::TwoLines,
    }
  }
}

fn view_box_array(view_box: shift_specimen::ViewBox) -> Vec<f64> {
  vec![view_box.x, view_box.y, view_box.width, view_box.height]
}

impl From<shift_specimen::NameSpecimen> for NapiNameSpecimen {
  fn from(name: shift_specimen::NameSpecimen) -> Self {
    Self {
      text: name.text,
      outline: name.outline,
      view_box: view_box_array(name.view_box),
      width: name.width,
      height: name.height,
      fit: name.fit.into(),
    }
  }
}

impl From<shift_specimen::Specimen> for NapiSpecimen {
  fn from(specimen: shift_specimen::Specimen) -> Self {
    Self {
      text: specimen.text,
      outline: specimen.outline,
      view_box: view_box_array(specimen.view_box),
      units_per_em: specimen.units_per_em,
      right_to_left: specimen.right_to_left,
      family_name: specimen.family_name.map(Into::into),
      display_name: specimen.display_name,
    }
  }
}

/// Font whose specimen is built on a worker thread.
pub(crate) enum SpecimenInput {
  /// Live authored document, compiled from a snapshot of its current state.
  Snapshot(FontSaveSnapshot),
  /// Font file on disk: binaries are shaped as they are, sources are
  /// imported and compiled first.
  Path(PathBuf),
}

/// Compiles what the specimen needs, then chooses and outlines it.
pub struct SpecimenTask {
  pub(crate) input: SpecimenInput,
}

impl SpecimenTask {
  fn build(&self) -> std::result::Result<Option<shift_specimen::Specimen>, String> {
    match &self.input {
      SpecimenInput::Snapshot(snapshot) => source_specimen(snapshot),
      SpecimenInput::Path(path) if is_font_binary(path) => {
        let binary = std::fs::read(path).map_err(|error| error.to_string())?;
        Ok(shift_specimen::specimen(&binary))
      }
      SpecimenInput::Path(path) => {
        let font = FontLoader::new()
          .read_font(&path.to_string_lossy())
          .map_err(|error| error.to_string())?;
        source_specimen(&font)
      }
    }
  }
}

/// Glyphs with outlines kept from the start of glyph order, for the
/// specimen's "first drawn glyphs" fallback.
const LEADING_DRAWN_GLYPHS: usize = 2;

/// Glyph-order batch scanned while looking for the first drawn glyphs.
const LEADING_GLYPH_BATCH: usize = 16;

/// Loads only the glyphs a document's specimen compiles.
///
/// The specimen is chosen from code points, which glyph records carry without
/// their layers, so a document loads the planned glyphs and their components,
/// then glyphs from the start of glyph order until it has found the drawn ones
/// [`source_specimen`] falls back to. Loading every layer instead made opening
/// or saving a large document block the workspace for about a second. A font
/// whose specimen needs contextual forms is compiled whole, so it loads whole.
pub(crate) fn acquire_specimen_glyphs(
  workspace: &mut FontWorkspace,
) -> std::result::Result<(), WorkspaceError> {
  let font = workspace.font();
  let plan = shift_specimen::subset_plan(&font_characters(font), family_name(font));
  if plan.needs_features {
    return workspace.acquire_all_layers();
  }

  let planned = FontView::glyphs(font)
    .filter(|glyph| shows_planned_character(glyph, &plan.characters) || glyph.name() == ".notdef")
    .map(Glyph::id)
    .collect::<Vec<_>>();
  workspace.acquire_glyphs(&planned, AcquireScope::ComponentClosure)?;

  let leading = FontView::glyphs(workspace.font())
    .filter(|glyph| glyph.name() != ".notdef")
    .map(Glyph::id)
    .collect::<Vec<GlyphId>>();
  let mut drawn = 0;
  for batch in leading.chunks(LEADING_GLYPH_BATCH) {
    workspace.acquire_glyphs(batch, AcquireScope::ComponentClosure)?;
    let font = workspace.font();
    drawn += batch
      .iter()
      .filter(|glyph_id| font.glyph(**glyph_id).is_some_and(Glyph::has_outline))
      .count();
    if drawn >= LEADING_DRAWN_GLYPHS {
      break;
    }
  }
  Ok(())
}

/// The family name a compiled font carries in `name` ID 16 (or 1).
fn family_name(font: &impl FontView) -> Option<&str> {
  font.metadata().family_name.as_deref()
}

fn font_characters(font: &impl FontView) -> Vec<char> {
  font
    .glyphs()
    .flat_map(|glyph| {
      glyph
        .unicodes()
        .iter()
        .filter_map(|&code| char::from_u32(code))
    })
    .collect()
}

fn shows_planned_character(glyph: &Glyph, planned: &[char]) -> bool {
  glyph
    .unicodes()
    .iter()
    .filter_map(|&code| char::from_u32(code))
    .any(|character| planned.contains(&character))
}

/// Builds a source font's specimen by compiling only the glyphs it can use.
///
/// The specimen rules decide from the whole font's character map; only the
/// candidate glyphs, the family name's glyphs, `.notdef`, and the first drawn
/// glyphs are compiled. A
/// font whose specimen needs contextual forms is compiled whole instead.
fn source_specimen(
  font: &impl FontView,
) -> std::result::Result<Option<shift_specimen::Specimen>, String> {
  let characters = font_characters(font);
  let plan = shift_specimen::subset_plan(&characters, family_name(font));

  let exporter = FontExporter::new();
  let binary = if plan.needs_features {
    exporter.compile_ttf(font)
  } else {
    let planned = font
      .glyphs()
      .filter(|glyph| shows_planned_character(glyph, &plan.characters));
    let leading = font
      .glyphs()
      .filter(|glyph| glyph.name() != ".notdef" && glyph.has_outline())
      .take(LEADING_DRAWN_GLYPHS);
    let names = planned.chain(leading).map(Glyph::name).chain([".notdef"]);
    exporter.compile_ttf(&GlyphSubsetView::new(font, names))
  }
  .map_err(|error| error.to_string())?;

  Ok(shift_specimen::specimen_with_characters(
    &binary,
    &characters,
  ))
}

impl Task for SpecimenTask {
  type Output = Option<shift_specimen::Specimen>;
  type JsValue = Option<NapiSpecimen>;

  fn compute(&mut self) -> Result<Self::Output> {
    self
      .build()
      .map_err(|message| Error::new(Status::GenericFailure, message))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output.map(NapiSpecimen::from))
  }
}

fn is_font_binary(path: &std::path::Path) -> bool {
  path
    .extension()
    .and_then(|extension| extension.to_str())
    .is_some_and(|extension| {
      extension.eq_ignore_ascii_case("ttf") || extension.eq_ignore_ascii_case("otf")
    })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_source_font_draws_its_family_name_from_the_compiled_subset() {
    let path =
      std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Homenaje.glyphs");
    let font = FontLoader::new()
      .read_font(&path.to_string_lossy())
      .expect("Homenaje should load");

    let specimen = source_specimen(&font)
      .expect("Homenaje should compile")
      .expect("Homenaje draws a specimen");

    assert_eq!(
      specimen.family_name.map(|name| name.text),
      Some("Homenaje".to_string())
    );
  }
}
