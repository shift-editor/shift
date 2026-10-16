use napi_derive::napi;
use shift_backends::PropagatedGlyphAnchors;

/// One glyph's anchors as export compiles them, at each master source it has a layer for.
#[napi(object)]
pub struct NapiPropagatedGlyphAnchors {
  #[napi(ts_type = "GlyphName")]
  pub glyph_name: String,
  pub sources: Vec<NapiPropagatedSourceAnchors>,
}

#[napi(object)]
pub struct NapiPropagatedSourceAnchors {
  #[napi(ts_type = "SourceId")]
  pub source_id: String,
  pub anchors: Vec<NapiPropagatedAnchor>,
}

#[napi(object)]
pub struct NapiPropagatedAnchor {
  pub name: String,
  pub x: f64,
  pub y: f64,
}

impl From<PropagatedGlyphAnchors> for NapiPropagatedGlyphAnchors {
  fn from(glyph: PropagatedGlyphAnchors) -> Self {
    Self {
      glyph_name: glyph.glyph_name,
      sources: glyph
        .sources
        .into_iter()
        .map(|source| NapiPropagatedSourceAnchors {
          source_id: source.source_id.to_string(),
          anchors: source
            .anchors
            .into_iter()
            .map(|anchor| NapiPropagatedAnchor {
              name: anchor.name,
              x: anchor.x,
              y: anchor.y,
            })
            .collect(),
        })
        .collect(),
    }
  }
}
