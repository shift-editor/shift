use napi_derive::napi;
use shift_backends::feature_code::{FeatureEdit, FeatureLint, FeatureSymbol, FeatureSymbolKind};
use shift_backends::shaper_font::{
  DiagnosticSeverity, FeatureDiagnostic, FeatureSetting, FontFeature, ParagraphRequest, ShapeUnit,
  ShapedGlyph, ShapedParagraph, ShapedRun, Substitution, TextDirection,
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
  /// ISO 15924 script tag, such as `Arab`, to shape every run in; each
  /// run's own script when omitted.
  pub script: Option<String>,
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

/// A feature generated from glyph relationships.
#[napi(object)]
pub struct NapiGeneratedFeature {
  pub tag: String,
  /// The complete `feature tag { … } tag;` block.
  pub code: String,
  /// How many substitutions it makes.
  pub rules: u32,
  /// Whether it compiles; switched off, it is listed so it can be switched back on.
  pub on: bool,
}

impl From<shift_font::GeneratedFeature> for NapiGeneratedFeature {
  fn from(feature: shift_font::GeneratedFeature) -> Self {
    Self {
      tag: feature.tag,
      code: feature.code,
      rules: u32::try_from(feature.rules).unwrap_or(u32::MAX),
      on: feature.on,
    }
  }
}

/// A problem the compiler or the linter found in the font's feature code.
#[napi(object)]
pub struct NapiFeatureDiagnostic {
  #[napi(ts_type = "\"error\" | \"warning\" | \"info\"")]
  pub severity: String,
  pub message: String,
  /// Start of the problem, in UTF-16 code units into the feature code.
  pub from: u32,
  /// End of the problem, in UTF-16 code units into the feature code.
  pub to: u32,
  /// The lint rule's code, such as `G001`; absent for the compiler's problems.
  pub rule: Option<String>,
  /// Edits that resolve the problem, best first.
  pub fixes: Vec<NapiFeatureFix>,
  /// The generated feature the problem is in, with `from`/`to` relative to
  /// that feature's code; absent for problems in the authored code.
  pub generated_tag: Option<String>,
}

/// Edits that resolve a [`NapiFeatureDiagnostic`].
#[napi(object)]
pub struct NapiFeatureFix {
  /// What the fix does, for a quick-fix menu.
  pub title: String,
  /// Whether the fix keeps what the compiled font does; unsafe fixes need checking.
  pub safe: bool,
  pub edits: Vec<NapiFeatureEdit>,
}

/// A class, mark class, lookup, or glyph name in feature code, and every
/// place it's written.
#[napi(object)]
pub struct NapiFeatureSymbol {
  #[napi(ts_type = "\"class\" | \"markClass\" | \"lookup\" | \"glyph\"")]
  pub kind: String,
  /// The name as written; classes keep their `@`.
  pub name: String,
  /// Where it's defined: one place for a class or lookup, one per statement
  /// for a mark class, none for a glyph or an undefined name.
  pub definitions: Vec<NapiFeatureRange>,
  pub references: Vec<NapiFeatureRange>,
}

/// A range of feature code, in UTF-16 code units.
#[napi(object)]
pub struct NapiFeatureRange {
  pub from: u32,
  pub to: u32,
}

impl From<FeatureSymbol> for NapiFeatureSymbol {
  fn from(symbol: FeatureSymbol) -> Self {
    let kind = match symbol.kind {
      FeatureSymbolKind::Class => "class",
      FeatureSymbolKind::MarkClass => "markClass",
      FeatureSymbolKind::Lookup => "lookup",
      FeatureSymbolKind::Glyph => "glyph",
    };
    let ranges = |ranges: Vec<std::ops::Range<usize>>| {
      ranges
        .into_iter()
        .map(|range| NapiFeatureRange {
          from: offset(range.start),
          to: offset(range.end),
        })
        .collect()
    };
    Self {
      kind: kind.to_string(),
      name: symbol.name,
      definitions: ranges(symbol.definitions),
      references: ranges(symbol.references),
    }
  }
}

impl From<FeatureEdit> for NapiFeatureEdit {
  fn from(edit: FeatureEdit) -> Self {
    Self {
      from: offset(edit.range.start),
      to: offset(edit.range.end),
      text: edit.text,
    }
  }
}

/// Replaces `from..to` of the linted code, in UTF-16 code units, with `text`.
#[napi(object)]
pub struct NapiFeatureEdit {
  pub from: u32,
  pub to: u32,
  pub text: String,
}

impl From<FeatureLint> for NapiFeatureDiagnostic {
  fn from(lint: FeatureLint) -> Self {
    Self {
      severity: severity_name(lint.severity).to_string(),
      message: lint.message,
      from: offset(lint.range.start),
      to: offset(lint.range.end),
      rule: Some(lint.rule.to_string()),
      generated_tag: None,
      fixes: lint
        .fixes
        .into_iter()
        .map(|fix| NapiFeatureFix {
          title: fix.title,
          safe: fix.safe,
          edits: fix.edits.into_iter().map(NapiFeatureEdit::from).collect(),
        })
        .collect(),
    }
  }
}

fn severity_name(severity: DiagnosticSeverity) -> &'static str {
  match severity {
    DiagnosticSeverity::Error => "error",
    DiagnosticSeverity::Warning => "warning",
    DiagnosticSeverity::Info => "info",
  }
}

fn offset(offset: usize) -> u32 {
  u32::try_from(offset).unwrap_or(u32::MAX)
}

impl From<&FeatureDiagnostic> for NapiFeatureDiagnostic {
  fn from(diagnostic: &FeatureDiagnostic) -> Self {
    Self {
      severity: severity_name(diagnostic.severity).to_string(),
      message: diagnostic.message.clone(),
      from: offset(diagnostic.range.start),
      to: offset(diagnostic.range.end),
      rule: None,
      fixes: Vec::new(),
      generated_tag: None,
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
  script: Option<String>,
  language: Option<String>,
  features: Vec<FeatureSetting>,
}

impl ParsedParagraphRequest {
  pub(crate) fn as_request(&self) -> ParagraphRequest<'_> {
    ParagraphRequest {
      units: &self.units,
      location: &self.location,
      script: self.script.as_deref(),
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
      script: request.script,
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

/// One substitution a feature can make: `input` in the text becomes `output`.
#[napi(object)]
pub struct NapiFeatureSubstitution {
  /// The glyphs replaced; more than one for a ligature.
  #[napi(ts_type = "Array<GlyphId>")]
  pub input: Vec<String>,
  #[napi(ts_type = "GlyphId")]
  pub output: String,
}

impl From<Substitution> for NapiFeatureSubstitution {
  fn from(substitution: Substitution) -> Self {
    Self {
      input: substitution.input.iter().map(ToString::to_string).collect(),
      output: substitution.output.to_string(),
    }
  }
}
