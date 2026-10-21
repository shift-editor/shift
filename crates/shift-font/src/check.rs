//! Font checks: problems in sources that make a font build, interpolate, or
//! kern differently from what the designer drew.
//!
//! Checks read an immutable [`Font`] and never change it. Each [`Finding`]
//! names a [`Check`] with a stable code, the glyph and source it concerns
//! when there is one, and a message written for a type designer.
//!
//! The editor runs [`check_glyph`] on the glyph being edited; command-line
//! and CI callers run [`check_font`] over a whole source.

use serde::Serialize;

use crate::{CoreResult, Font, GlyphId, SourceId};

mod coverage;
mod designspace;
mod health;
mod kerning;
mod outline;
mod polygon;
mod roles;

pub use coverage::Charset;
pub use outline::OutlineThresholds;

/// Opt-in checks for one run.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CheckOptions {
    /// Characters every master must map and draw.
    pub charset: Option<Charset>,
    /// Checks the font as monospaced; the cell width is the given advance, or
    /// each master's most common advance when `Some(None)`.
    pub monospace: Option<Option<f64>>,
}

/// How much a finding matters.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    /// The font builds, but may not do what was intended.
    Warning,
    /// The font fails to build, or a glyph renders wrongly at some location.
    Error,
}

/// One kind of problem, with a stable code.
///
/// Codes group by subject: `D` axes and masters, `I` interpolation, `O`
/// outlines, `K` kerning, `C` character set, `M` monospace.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Check {
    /// No master sits at the default location of every axis.
    NoDefaultMaster,
    /// Two masters sit at the same location.
    DuplicateMasterLocation,
    /// A master sits outside the range of an axis.
    MasterOutsideAxis,
    /// An axis mapping turns back on itself, so two values map to the same place.
    MappingNotMonotonic,
    /// An axis runs past its last master, so the font stops changing there.
    AxisBeyondMasters,
    /// A glyph has layers in some masters but none in the default master.
    MissingDefaultLayer,
    /// A master's layer doesn't match the default master's structure.
    IncompatibleMaster,
    /// A master uses components where another draws outlines, or different
    /// components; the decomposed outlines match.
    MixedComponents,
    /// A glyph with compatible layers in several masters can't be interpolated.
    NotInterpolatable,
    /// A contour starts at a different point in one master.
    WrongStartPoint,
    /// A contour runs the opposite direction in one master.
    WrongContourDirection,
    /// Two contours are in a different order in one master.
    WrongContourOrder,
    /// A contour turns inside out between two masters.
    ContourInsideOut,
    /// A contour of two or more points is open, so it won't fill.
    OpenContour,
    /// A closed contour has fewer than three points, so it draws nothing.
    DegenerateContour,
    /// A point's coordinate isn't a number.
    NonFinitePoint,
    /// An advance width is negative, not a number, or zero for a spacing glyph.
    InvalidAdvance,
    /// A contour lies wholly inside another and winds the same way, so it adds
    /// nothing: a hole drawn the wrong way, or a redundant shape.
    ContourDirection,
    /// An encoded glyph draws nothing in the default master.
    EmptyOutline,
    /// A glyph can't be drawn, for example because of a component cycle.
    UnresolvedGlyph,
    /// A kerning group has no members, so its pairs do nothing.
    EmptyKerningGroup,
    /// A pair names a glyph or group that isn't in the font, or a group on the wrong side, so it never applies.
    UnresolvedKerning,
    /// The font doesn't map a character of the required character set.
    CharsetMissingGlyph,
    /// A required character's glyph has no layer in a master.
    CharsetMissingLayer,
    /// A glyph's advance differs from the monospace cell width.
    MonoWidthMismatch,
    /// A glyph's ink is wider than its monospace cell.
    MonoInkOverflow,
}

impl Check {
    /// Every check, in code order.
    pub const ALL: [Check; 26] = [
        Check::NoDefaultMaster,
        Check::DuplicateMasterLocation,
        Check::MasterOutsideAxis,
        Check::MappingNotMonotonic,
        Check::AxisBeyondMasters,
        Check::MissingDefaultLayer,
        Check::IncompatibleMaster,
        Check::MixedComponents,
        Check::NotInterpolatable,
        Check::WrongStartPoint,
        Check::WrongContourDirection,
        Check::WrongContourOrder,
        Check::ContourInsideOut,
        Check::OpenContour,
        Check::DegenerateContour,
        Check::NonFinitePoint,
        Check::InvalidAdvance,
        Check::ContourDirection,
        Check::EmptyOutline,
        Check::UnresolvedGlyph,
        Check::EmptyKerningGroup,
        Check::UnresolvedKerning,
        Check::CharsetMissingGlyph,
        Check::CharsetMissingLayer,
        Check::MonoWidthMismatch,
        Check::MonoInkOverflow,
    ];

    /// Returns the stable code, such as `D001`.
    pub fn code(self) -> &'static str {
        self.describe().0
    }

    /// Returns the kebab-case name, such as `wrong-start-point`.
    pub fn name(self) -> &'static str {
        self.describe().1
    }

    /// Returns how much a finding of this kind matters.
    pub fn severity(self) -> Severity {
        self.describe().2
    }

    fn describe(self) -> (&'static str, &'static str, Severity) {
        match self {
            Check::NoDefaultMaster => ("D001", "no-default-master", Severity::Error),
            Check::DuplicateMasterLocation => {
                ("D002", "duplicate-master-location", Severity::Error)
            }
            Check::MasterOutsideAxis => ("D003", "master-outside-axis", Severity::Error),
            Check::MappingNotMonotonic => ("D004", "mapping-not-monotonic", Severity::Error),
            Check::AxisBeyondMasters => ("D005", "axis-beyond-masters", Severity::Warning),
            Check::MissingDefaultLayer => ("I001", "missing-default-layer", Severity::Error),
            Check::IncompatibleMaster => ("I002", "incompatible-master", Severity::Error),
            Check::MixedComponents => ("I008", "mixed-components", Severity::Warning),
            Check::NotInterpolatable => ("I003", "not-interpolatable", Severity::Warning),
            Check::WrongStartPoint => ("I004", "wrong-start-point", Severity::Error),
            Check::WrongContourDirection => ("I005", "wrong-contour-direction", Severity::Error),
            Check::WrongContourOrder => ("I006", "wrong-contour-order", Severity::Error),
            Check::ContourInsideOut => ("I007", "contour-inside-out", Severity::Error),
            Check::OpenContour => ("O001", "open-contour", Severity::Warning),
            Check::DegenerateContour => ("O002", "degenerate-contour", Severity::Warning),
            Check::NonFinitePoint => ("O003", "non-finite-point", Severity::Error),
            Check::InvalidAdvance => ("O004", "invalid-advance", Severity::Error),
            Check::ContourDirection => ("O005", "contour-direction", Severity::Warning),
            Check::EmptyOutline => ("O006", "empty-outline", Severity::Error),
            Check::UnresolvedGlyph => ("O007", "unresolved-glyph", Severity::Error),
            Check::EmptyKerningGroup => ("K001", "empty-kerning-group", Severity::Warning),
            Check::UnresolvedKerning => ("K002", "unresolved-kerning", Severity::Warning),
            Check::CharsetMissingGlyph => ("C001", "charset-missing-glyph", Severity::Error),
            Check::CharsetMissingLayer => ("C002", "charset-missing-layer", Severity::Error),
            Check::MonoWidthMismatch => ("M001", "mono-width-mismatch", Severity::Error),
            Check::MonoInkOverflow => ("M002", "mono-ink-overflow", Severity::Warning),
        }
    }
}

/// One problem found in a font.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub check: Check,
    /// The glyph concerned, when the problem is in one glyph.
    pub glyph: Option<GlyphId>,
    /// The master concerned, when the problem is in one master.
    pub source: Option<SourceId>,
    /// Zero-based contour index, when the problem is in one contour.
    pub contour: Option<usize>,
    pub message: String,
}

impl Finding {
    fn font(check: Check, message: impl Into<String>) -> Self {
        Self {
            check,
            glyph: None,
            source: None,
            contour: None,
            message: message.into(),
        }
    }

    fn glyph(check: Check, glyph: GlyphId, message: impl Into<String>) -> Self {
        Self {
            glyph: Some(glyph),
            ..Self::font(check, message)
        }
    }

    fn in_source(mut self, source: SourceId) -> Self {
        self.source = Some(source);
        self
    }

    fn in_contour(mut self, contour: usize) -> Self {
        self.contour = Some(contour);
        self
    }
}

/// Runs every check over `font`.
///
/// Findings come in a stable order: font-wide problems first, then glyphs in
/// font order, then kerning and the opt-in checks.
///
/// # Errors
///
/// Returns an axis-mapping error when an authored mapping cannot compile.
pub fn check_font(font: &Font) -> CoreResult<Vec<Finding>> {
    check_font_with(font, &CheckOptions::default())
}

/// Runs every check over `font`, plus the opt-in checks in `options`.
///
/// # Errors
///
/// Returns an axis-mapping error when an authored mapping cannot compile.
pub fn check_font_with(font: &Font, options: &CheckOptions) -> CoreResult<Vec<Finding>> {
    let mut findings = designspace::check(font)?;
    let thresholds = OutlineThresholds::default();
    for glyph in font.glyphs() {
        findings.extend(health::check(font, glyph));
        findings.extend(outline::check(font, &glyph.id(), &thresholds)?);
    }
    findings.extend(kerning::check(font));
    if let Some(charset) = &options.charset {
        findings.extend(coverage::charset(font, charset));
    }
    if let Some(width) = options.monospace {
        findings.extend(coverage::monospace(font, width));
    }
    Ok(findings)
}

/// Runs the checks that concern one glyph.
///
/// This is cheap enough to run after every edit of that glyph.
///
/// # Errors
///
/// Returns [`crate::CoreError::GlyphNotFound`] when `glyph_id` is not in the
/// font, or an axis-mapping error when an authored mapping cannot compile.
pub fn check_glyph(font: &Font, glyph_id: &GlyphId) -> CoreResult<Vec<Finding>> {
    let glyph = font.require_glyph(glyph_id)?;
    let mut findings = health::check(font, glyph);
    findings.extend(outline::check(
        font,
        glyph_id,
        &OutlineThresholds::default(),
    )?);
    Ok(findings)
}

#[cfg(test)]
mod tests;
