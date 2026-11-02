//! Values the editor and the native addon pass as text or by name: ids,
//! which parse into shift-font's typed ids, and component alignments. The edits themselves cross as shift-font's own intents.

use std::str::FromStr;

use crate::{
    AnchorId, AxisId, AxisLabelId, AxisMappingId, ComponentAlignment, ComponentId, ContourId,
    GlyphId, GuidelineId, KerningGroupId, LayerId, MetricId, NamedInstanceId, PointId, SourceId,
};

crate::string_enum! {
    /// Which kind of id the editor sent, for errors that name it.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum IdKind {
        Contour => "contour ID",
        Glyph => "glyph ID",
        Point => "point ID",
        Anchor => "anchor ID",
        Axis => "axis ID",
        AxisMapping => "axis mapping ID",
        KerningGroup => "kerning group ID",
        AxisLabel => "axis label ID",
        NamedInstance => "named instance ID",
        Metric => "metric ID",
        Component => "component ID",
        Guideline => "guideline ID",
        Layer => "layer ID",
        Source => "source ID",
    }
    parse_error: String = |text| format!("unknown id kind {text:?}");
}

/// Why text the editor sent does not name an id.
#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error("invalid {kind}: {value}")]
    InvalidId { kind: IdKind, value: String },
}

pub type WireResult<T> = Result<T, WireError>;

/// Reads a wire component alignment; anything else is `Unset`.
pub fn parse_alignment(name: Option<&str>) -> ComponentAlignment {
    match name {
        Some("anchored") => ComponentAlignment::Anchored,
        Some("free") => ComponentAlignment::Free,
        _ => ComponentAlignment::Unset,
    }
}

/// An id the editor sends as text.
pub trait WireParse: Sized + FromStr {
    /// What the id is, for its error.
    const KIND: IdKind;
}

/// Parses one id the editor sent.
///
/// # Errors
///
/// Returns [`WireError::InvalidId`] naming the id's kind when `value` is not one.
pub fn parse<T: WireParse>(value: &str) -> WireResult<T> {
    value.parse().map_err(|_| WireError::InvalidId {
        kind: T::KIND,
        value: value.to_string(),
    })
}

/// Parses every id in `ids`.
///
/// # Errors
///
/// As [`parse`], for the first id that is not one.
pub fn parse_id_list<T: WireParse>(ids: &[String]) -> WireResult<Vec<T>> {
    ids.iter().map(|id| parse::<T>(id)).collect()
}

impl WireParse for ContourId {
    const KIND: IdKind = IdKind::Contour;
}

impl WireParse for GlyphId {
    const KIND: IdKind = IdKind::Glyph;
}

impl WireParse for PointId {
    const KIND: IdKind = IdKind::Point;
}

impl WireParse for AnchorId {
    const KIND: IdKind = IdKind::Anchor;
}

impl WireParse for AxisId {
    const KIND: IdKind = IdKind::Axis;
}

impl WireParse for AxisMappingId {
    const KIND: IdKind = IdKind::AxisMapping;
}

impl WireParse for KerningGroupId {
    const KIND: IdKind = IdKind::KerningGroup;
}

impl WireParse for AxisLabelId {
    const KIND: IdKind = IdKind::AxisLabel;
}

impl WireParse for NamedInstanceId {
    const KIND: IdKind = IdKind::NamedInstance;
}

impl WireParse for MetricId {
    const KIND: IdKind = IdKind::Metric;
}

impl WireParse for ComponentId {
    const KIND: IdKind = IdKind::Component;
}

impl WireParse for GuidelineId {
    const KIND: IdKind = IdKind::Guideline;
}

impl WireParse for LayerId {
    const KIND: IdKind = IdKind::Layer;
}

impl WireParse for SourceId {
    const KIND: IdKind = IdKind::Source;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_malformed_id_names_its_kind() {
        let error = parse::<LayerId>("not a layer").unwrap_err();

        assert!(matches!(
            error,
            WireError::InvalidId {
                kind: IdKind::Layer,
                ..
            }
        ));
        assert_eq!(error.to_string(), "invalid layer ID: not a layer");
    }
}
