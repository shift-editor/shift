use napi_derive::napi;
use shift_backends::shaper_font::{
  DiagnosticSeverity, FeatureDiagnostic, FeatureSetting, FontFeature, ParagraphRequest, ShapeUnit,
  ShapedGlyph, ShapedParagraph, ShapedRun, TextDirection,
};
use shift_font::{ExternalLocation, GlyphId};
use shift_wire::bridges::napi::NapiLocation;

use crate::errors::{BridgeError, BridgeResult};
use crate::input::parse;

/// One unit of text to shape: exactly one of a character or a glyph inserted
/// by name.
#[napi(object)]
pub struct NapiShapeUnit {
  /// A Unicode scalar value.
  pub codepoint: Option<u32>,
  /// A glyph with no character to type, shaped as itself.
  #[napi(ts_type = "GlyphId")]
  pub glyph_id: Option<String>,
}

#[napi(object)]
pub struct NapiFeatureSetting {
  /// A feature tag such as `liga`.
  pub tag: String,
  /// `0` turns the feature off, `1` on; larger values pick an alternate.
  pub value: u32,
}

/// A paragraph to shape, split into runs of one script.
#[napi(object)]
pub struct NapiParagraphRequest {
  pub units: Vec<NapiShapeUnit>,
  /// User-space location to shape at; omitted axes are at their default.
  pub location: NapiLocation,
  /// BCP 47 language tag; the default language system when omitted.
  pub language: Option<String>,
  /// Settings over the features applied by default.
  pub features: Option<Vec<NapiFeatureSetting>>,
}

/// One shaped glyph. Advances and offsets hold only what the font's feature
/// code positions; glyph advances, kerning, and mark attachment are the
/// caller's to add.
#[napi(object)]
pub struct NapiShapedGlyph {
  /// Absent when a character has no glyph.
  #[napi(ts_type = "GlyphId")]
  pub glyph_id: Option<String>,
  /// Index of the first unit the glyph came from.
  pub cluster: u32,
  pub x_advance: i32,
  pub y_advance: i32,
  pub x_offset: i32,
  pub y_offset: i32,
  /// Whether the font classes the glyph as a mark.
  pub is_mark: bool,
}

impl From<ShapedGlyph> for NapiShapedGlyph {
  fn from(glyph: ShapedGlyph) -> Self {
    Self {
      glyph_id: glyph.glyph_id.map(|id| id.to_string()),
      cluster: glyph.cluster,
      x_advance: glyph.x_advance,
      y_advance: glyph.y_advance,
      x_offset: glyph.x_offset,
      y_offset: glyph.y_offset,
      is_mark: glyph.is_mark,
    }
  }
}

/// A shaped paragraph: its base direction and its runs in logical order.
#[napi(object)]
pub struct NapiShapedParagraph {
  /// The paragraph's base direction, from its first strong character.
  #[napi(ts_type = "\"ltr\" | \"rtl\"")]
  pub direction: String,
  pub runs: Vec<NapiShapedRun>,
}

impl From<ShapedParagraph> for NapiShapedParagraph {
  fn from(paragraph: ShapedParagraph) -> Self {
    Self {
      direction: direction_name(paragraph.direction).to_string(),
      runs: paragraph
        .runs
        .into_iter()
        .map(NapiShapedRun::from)
        .collect(),
    }
  }
}

/// One run of a shaped paragraph, in one script and bidi level.
#[napi(object)]
pub struct NapiShapedRun {
  /// First paragraph unit in the run.
  pub start: u32,
  /// One past the last paragraph unit in the run.
  pub end: u32,
  /// ISO 15924 script tag such as `Arab`; absent when the run holds only
  /// characters common to all scripts.
  pub script: Option<String>,
  /// Resolved bidi level; odd levels read right to left. A line lays its
  /// runs out by level.
  pub level: u32,
  #[napi(ts_type = "\"ltr\" | \"rtl\"")]
  pub direction: String,
  /// Glyphs in visual order; clusters index the paragraph's units.
  pub glyphs: Vec<NapiShapedGlyph>,
}

impl From<ShapedRun> for NapiShapedRun {
  fn from(run: ShapedRun) -> Self {
    Self {
      start: run.units.start,
      end: run.units.end,
      script: run.script,
      level: u32::from(run.level),
      direction: direction_name(run.direction).to_string(),
      glyphs: run.glyphs.into_iter().map(NapiShapedGlyph::from).collect(),
    }
  }
}

/// A problem the compiler found in the font's feature code.
#[napi(object)]
pub struct NapiFeatureDiagnostic {
  #[napi(ts_type = "\"error\" | \"warning\" | \"info\"")]
  pub severity: String,
  pub message: String,
  /// Start of the problem, in UTF-16 code units into the feature code.
  pub from: u32,
  /// End of the problem, in UTF-16 code units into the feature code.
  pub to: u32,
}

impl From<&FeatureDiagnostic> for NapiFeatureDiagnostic {
  fn from(diagnostic: &FeatureDiagnostic) -> Self {
    let severity = match diagnostic.severity {
      DiagnosticSeverity::Error => "error",
      DiagnosticSeverity::Warning => "warning",
      DiagnosticSeverity::Info => "info",
    };
    Self {
      severity: severity.to_string(),
      message: diagnostic.message.clone(),
      from: u32::try_from(diagnostic.range.start).unwrap_or(u32::MAX),
      to: u32::try_from(diagnostic.range.end).unwrap_or(u32::MAX),
    }
  }
}

/// A feature the font's feature code defines.
#[napi(object)]
pub struct NapiFontFeature {
  /// The feature tag, such as `liga` or `ss01`.
  pub tag: String,
  /// The name a `featureNames` block gives a stylistic set or character variant.
  pub name: Option<String>,
}

impl From<FontFeature> for NapiFontFeature {
  fn from(feature: FontFeature) -> Self {
    Self {
      tag: feature.tag,
      name: feature.name,
    }
  }
}

/// A [`NapiParagraphRequest`] with its inputs parsed into the types the
/// shaper takes.
pub(crate) struct ParsedParagraphRequest {
  units: Vec<ShapeUnit>,
  location: ExternalLocation,
  language: Option<String>,
  features: Vec<FeatureSetting>,
}

impl ParsedParagraphRequest {
  pub(crate) fn as_request(&self) -> ParagraphRequest<'_> {
    ParagraphRequest {
      units: &self.units,
      location: &self.location,
      language: self.language.as_deref(),
      features: &self.features,
    }
  }
}

impl TryFrom<NapiParagraphRequest> for ParsedParagraphRequest {
  type Error = BridgeError;

  fn try_from(request: NapiParagraphRequest) -> BridgeResult<Self> {
    let units = request
      .units
      .into_iter()
      .map(shape_unit)
      .collect::<BridgeResult<_>>()?;
    let location = ExternalLocation::from_untyped(crate::bridge::map_location(request.location)?);
    let features = request
      .features
      .unwrap_or_default()
      .iter()
      .map(|setting| FeatureSetting::parse(&setting.tag, setting.value))
      .collect::<Result<_, _>>()?;

    Ok(Self {
      units,
      location,
      language: request.language,
      features,
    })
  }
}

fn shape_unit(unit: NapiShapeUnit) -> BridgeResult<ShapeUnit> {
  match (unit.codepoint, unit.glyph_id) {
    (Some(codepoint), None) => char::from_u32(codepoint)
      .map(ShapeUnit::Character)
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "codepoint",
        value: codepoint.to_string(),
      }),
    (None, Some(glyph_id)) => Ok(ShapeUnit::Glyph(parse::<GlyphId>(&glyph_id)?)),
    _ => Err(BridgeError::InvalidInput {
      kind: "shape unit",
      value: "needs exactly one of codepoint or glyphId".to_string(),
    }),
  }
}

fn direction_name(direction: TextDirection) -> &'static str {
  match direction {
    TextDirection::LeftToRight => "ltr",
    TextDirection::RightToLeft => "rtl",
  }
}
