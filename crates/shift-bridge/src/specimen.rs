use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{font_loader::FontLoader, FontExporter};

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
  pub right_to_left: bool,
}

impl From<shift_specimen::Specimen> for NapiSpecimen {
  fn from(specimen: shift_specimen::Specimen) -> Self {
    let view_box = specimen.view_box;
    Self {
      text: specimen.text,
      outline: specimen.outline,
      view_box: vec![view_box.x, view_box.y, view_box.width, view_box.height],
      right_to_left: specimen.right_to_left,
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

/// Compiles when needed, then chooses and outlines the thumbnail specimen.
pub struct SpecimenTask {
  pub(crate) input: SpecimenInput,
}

impl SpecimenTask {
  fn font_binary(&self) -> std::result::Result<Vec<u8>, String> {
    match &self.input {
      SpecimenInput::Snapshot(snapshot) => FontExporter::new()
        .compile_ttf(snapshot)
        .map_err(|error| error.to_string()),
      SpecimenInput::Path(path) if is_font_binary(path) => {
        std::fs::read(path).map_err(|error| error.to_string())
      }
      SpecimenInput::Path(path) => {
        let font = FontLoader::new()
          .read_font(&path.to_string_lossy())
          .map_err(|error| error.to_string())?;
        FontExporter::new()
          .compile_ttf(&font)
          .map_err(|error| error.to_string())
      }
    }
  }
}

impl Task for SpecimenTask {
  type Output = Option<shift_specimen::Specimen>;
  type JsValue = Option<NapiSpecimen>;

  fn compute(&mut self) -> Result<Self::Output> {
    let binary = self
      .font_binary()
      .map_err(|message| Error::new(Status::GenericFailure, message))?;
    Ok(shift_specimen::specimen(&binary))
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
