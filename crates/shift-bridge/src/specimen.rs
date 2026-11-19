use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{FontExporter, FontView, GlyphSubsetView, font_loader::FontLoader};
use shift_font::{DesignLocation, Font, Glyph, GlyphId};
use shift_workspace::{AcquireScope, FontWorkspace, WorkspaceError};

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
  /// Live authored document, compiled from a copy of its current state.
  Document(Font),
  /// Font file on disk: binaries are shaped as they are, sources are
  /// imported and compiled first.
  Path(PathBuf),
}

/// Compiles what the specimen needs, then chooses and outlines it.
pub struct SpecimenTask {
  pub(crate) input: SpecimenInput,
}

/// Why a specimen could not be built.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SpecimenError {
  #[error("failed to read the font: {0}")]
  Read(#[from] std::io::Error),

  #[error(transparent)]
  Load(#[from] shift_backends::BackendError),

  #[error("cannot draw the font at its default location: {0}")]
  Draw(#[from] shift_font::CoreError),

  #[error(transparent)]
  Compile(#[from] shift_backends::ExportError),
}

impl SpecimenTask {
  fn build(&self) -> std::result::Result<Option<shift_specimen::Specimen>, SpecimenError> {
    match &self.input {
      SpecimenInput::Document(font) => source_specimen(font),
      SpecimenInput::Path(path) if is_font_binary(path) => {
        let binary = std::fs::read(path)?;
        Ok(shift_specimen::specimen(&binary))
      }
      SpecimenInput::Path(path) => {
        let font = FontLoader::new().read_font(&path.to_string_lossy())?;
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
///
/// The specimen is drawn at the font's default location, so components
/// that carry conditions, which compiled fonts can't hold, are drawn as the
/// editor draws them there: each glyph that reads one is compiled as its
/// outline at the default ([`Font::with_component_conditions_drawn_at`]).
fn source_specimen(
  font: &Font,
) -> std::result::Result<Option<shift_specimen::Specimen>, SpecimenError> {
  let font = font.with_component_conditions_drawn_at(&DesignLocation::new())?;
  let font = &font;
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
  }?;

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
      .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))
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

  /// The specimen the bridge builds for an open document holding `font`.
  fn specimen_of(font: Font) -> Result<Option<shift_specimen::Specimen>> {
    SpecimenTask {
      input: SpecimenInput::Document(font),
    }
    .compute()
  }

  #[test]
  fn a_source_font_draws_its_family_name_from_the_compiled_subset() {
    let path =
      std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Homenaje.glyphs");
    let font = FontLoader::new()
      .read_font(&path.to_string_lossy())
      .expect("Homenaje should load");

    let specimen = specimen_of(font)
      .expect("Homenaje should compile")
      .expect("Homenaje draws a specimen");

    assert_eq!(
      specimen.family_name.map(|name| name.text),
      Some("Homenaje".to_string())
    );
  }

  /// A font whose `A` is a box with a second box beside it, the second
  /// drawn only where Weight is at least 700, or nowhere when `conditional`
  /// is false; `g` is a box, so the specimen shapes `Ag`.
  fn conditional_box_font(conditional: bool) -> Font {
    use shift_font::{
      Axis, Component, Condition, ConditionRange, Contour, GlyphLayer, LayerId, PointType,
    };

    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Boxes".to_string());
    let weight = Axis::weight();
    let weight_id = weight.id();
    font.add_axis(weight).unwrap();
    let source = font.default_source_id().unwrap();
    let mut box_glyph = |name: &str, x: f64, unicode: Option<char>| {
      let mut glyph = Glyph::new(name);
      glyph.set_unicodes(unicode.map(u32::from).into_iter().collect());
      let mut layer = GlyphLayer::with_width(LayerId::new(), source, 0.0);
      let mut contour = Contour::new();
      for (dx, y) in [(0.0, 0.0), (100.0, 0.0), (100.0, 700.0), (0.0, 700.0)] {
        contour.add_point(x + dx, y, PointType::OnCurve, false);
      }
      contour.close();
      layer.add_contour(contour);
      glyph.set_layer(layer);
      font.insert_glyph(glyph).unwrap()
    };
    let stem = box_glyph("stem", 0.0, None);
    let side = box_glyph("side", 200.0, None);
    box_glyph("g", 0.0, Some('g'));

    let mut a = Glyph::with_unicode("A", u32::from('A'));
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, 400.0);
    layer.add_component(Component::new(stem, "stem"));
    if conditional {
      let mut heavy = Component::new(side, "side");
      heavy.set_condition(Condition::all([ConditionRange::new(
        weight_id,
        Some(700.0),
        None,
      )]));
      layer.add_component(heavy);
    }
    a.set_layer(layer);
    font.insert_glyph(a).unwrap();
    font
  }

  #[test]
  fn a_component_condition_draws_in_the_specimen_as_the_editor_draws_it_at_the_default() {
    let outline = |font: Font| {
      let specimen = specimen_of(font)
        .expect("the font should compile")
        .expect("the font draws a specimen");
      (specimen.text, specimen.outline)
    };

    // At the default Weight, 400, the second box is not drawn.
    assert_eq!(
      outline(conditional_box_font(true)),
      outline(conditional_box_font(false))
    );
  }
}
