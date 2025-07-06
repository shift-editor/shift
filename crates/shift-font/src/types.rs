use napi_derive::napi;
use shift_core::font::Metrics;

#[napi(object)]
pub struct JSMetrics {
  pub units_per_em: f64,
  pub ascender: f64,
  pub descender: f64,
  pub cap_height: f64,
  pub x_height: f64,
}

impl From<Metrics> for JSMetrics {
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
