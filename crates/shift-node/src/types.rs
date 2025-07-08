use napi_derive::napi;
use shift_core::font::{FontMetadata, Metrics};

#[napi(object)]
pub struct JSFontMetrics {
  pub units_per_em: f64,
  pub ascender: f64,
  pub descender: f64,
  pub cap_height: f64,
  pub x_height: f64,
}

impl From<Metrics> for JSFontMetrics {
  fn from(metrics: Metrics) -> Self {
    Self {
      units_per_em: metrics.units_per_em,
      ascender: metrics.ascender,
      descender: metrics.descender,
      cap_height: metrics.cap_height,
      x_height: metrics.x_height,
    }
  }
}

#[napi(object)]
pub struct JSFontMetaData {
  pub family: String,
  pub style_name: String,
  pub version: i32,
}

impl From<FontMetadata> for JSFontMetaData {
  fn from(metadata: FontMetadata) -> Self {
    Self {
      family: metadata.family,
      style_name: metadata.style_name,
      version: metadata.version,
    }
  }
}
