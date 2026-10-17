use napi_derive::napi;
use shift_backends::{AnchorKind, PropagatedGlyphAnchors};

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

/// An anchor's role in mark positioning, as export reads its name.
#[napi(object)]
pub struct NapiAnchorKind {
  #[napi(
    ts_type = "\"base\" | \"mark\" | \"ligature\" | \"componentMarker\" | \"caret\" | \"vcaret\" | \"entry\" | \"exit\" | \"invalid\""
  )]
  pub kind: String,
  /// The attachment group, such as `top`, for base, mark, and ligature anchors.
  pub group: Option<String>,
  /// The ligature component or caret number, counting from 1.
  pub index: Option<u32>,
}

impl From<AnchorKind> for NapiAnchorKind {
  fn from(kind: AnchorKind) -> Self {
    let (kind, group, index) = match kind {
      AnchorKind::Base(group) => ("base", Some(group), None),
      AnchorKind::Mark(group) => ("mark", Some(group), None),
      AnchorKind::Ligature { group, index } => ("ligature", Some(group), Some(index)),
      AnchorKind::ComponentMarker(index) => ("componentMarker", None, Some(index)),
      AnchorKind::Caret(index) => ("caret", None, Some(index)),
      AnchorKind::VCaret(index) => ("vcaret", None, Some(index)),
      AnchorKind::Entry => ("entry", None, None),
      AnchorKind::Exit => ("exit", None, None),
      AnchorKind::Invalid => ("invalid", None, None),
    };
    Self {
      kind: kind.to_string(),
      group,
      index: index.map(|index| u32::try_from(index).unwrap_or(u32::MAX)),
    }
  }
}
