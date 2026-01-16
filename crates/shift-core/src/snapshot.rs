//! Snapshot types for serializing glyph state to TypeScript
//!
//! These types are auto-exported to TypeScript via ts-rs.
//! Run `cargo test` to regenerate the TypeScript bindings in `bindings/`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    contour::Contour,
    edit_session::EditSession,
    entity::PointId,
    glyph::Glyph,
    point::{Point, PointType},
};

// ═══════════════════════════════════════════════════════════
// POINT SNAPSHOT
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/renderer/src/types/generated/")]
pub struct PointSnapshot {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub point_type: PointTypeString,
    pub smooth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/renderer/src/types/generated/")]
pub enum PointTypeString {
    OnCurve,
    OffCurve,
}

impl From<&PointType> for PointTypeString {
    fn from(pt: &PointType) -> Self {
        match pt {
            PointType::OnCurve => PointTypeString::OnCurve,
            PointType::OffCurve => PointTypeString::OffCurve,
        }
    }
}

impl From<&Point> for PointSnapshot {
    fn from(point: &Point) -> Self {
        Self {
            id: point.id().raw().to_string(),
            x: point.x(),
            y: point.y(),
            point_type: point.point_type().into(),
            smooth: point.is_smooth(),
        }
    }
}

// ═══════════════════════════════════════════════════════════
// CONTOUR SNAPSHOT
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/renderer/src/types/generated/")]
pub struct ContourSnapshot {
    pub id: String,
    pub points: Vec<PointSnapshot>,
    pub closed: bool,
}

impl From<&Contour> for ContourSnapshot {
    fn from(contour: &Contour) -> Self {
        Self {
            id: contour.id().raw().to_string(),
            points: contour.points().iter().map(PointSnapshot::from).collect(),
            closed: contour.is_closed(),
        }
    }
}

// ═══════════════════════════════════════════════════════════
// GLYPH SNAPSHOT
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/renderer/src/types/generated/")]
pub struct GlyphSnapshot {
    pub unicode: u32,
    pub name: String,
    #[ts(rename = "xAdvance")]
    pub x_advance: f64,
    pub contours: Vec<ContourSnapshot>,
    #[ts(rename = "activeContourId")]
    pub active_contour_id: Option<String>,
}

impl GlyphSnapshot {
    /// Create a snapshot from a glyph without an active contour
    pub fn from_glyph(glyph: &Glyph) -> Self {
        Self {
            unicode: glyph.unicode(),
            name: glyph.name().to_string(),
            x_advance: glyph.x_advance(),
            contours: glyph.contours_iter().map(ContourSnapshot::from).collect(),
            active_contour_id: None,
        }
    }

    /// Create a snapshot from an edit session (includes active contour)
    pub fn from_edit_session(session: &EditSession) -> Self {
        let glyph = session.glyph();
        Self {
            unicode: glyph.unicode(),
            name: glyph.name().to_string(),
            x_advance: glyph.x_advance(),
            contours: glyph.contours_iter().map(ContourSnapshot::from).collect(),
            active_contour_id: session.active_contour_id().map(|id| id.raw().to_string()),
        }
    }
}

// ═══════════════════════════════════════════════════════════
// COMMAND RESULT
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/renderer/src/types/generated/")]
pub struct CommandResult {
    pub success: bool,
    pub snapshot: Option<GlyphSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(rename = "affectedPointIds")]
    pub affected_point_ids: Option<Vec<String>>,
    #[ts(rename = "canUndo")]
    pub can_undo: bool,
    #[ts(rename = "canRedo")]
    pub can_redo: bool,
}

impl CommandResult {
    /// Create a successful result
    pub fn success(session: &EditSession, affected_point_ids: Vec<PointId>) -> Self {
        Self {
            success: true,
            snapshot: Some(GlyphSnapshot::from_edit_session(session)),
            error: None,
            affected_point_ids: Some(
                affected_point_ids
                    .iter()
                    .map(|id| id.raw().to_string())
                    .collect(),
            ),
            can_undo: false, // TODO: implement undo tracking
            can_redo: false, // TODO: implement redo tracking
        }
    }

    /// Create a successful result without affected points
    pub fn success_simple(session: &EditSession) -> Self {
        Self {
            success: true,
            snapshot: Some(GlyphSnapshot::from_edit_session(session)),
            error: None,
            affected_point_ids: None,
            can_undo: false,
            can_redo: false,
        }
    }

    /// Create an error result
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            snapshot: None,
            error: Some(message.into()),
            affected_point_ids: None,
            can_undo: false,
            can_redo: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contour::Contour;
    use crate::point::PointType;

    #[test]
    fn point_snapshot_from_point() {
        let mut contour = Contour::new();
        let point_id = contour.add_point(100.0, 200.0, PointType::OnCurve, true);
        let point = contour.get_point(point_id).unwrap();

        let snapshot = PointSnapshot::from(point);

        assert_eq!(snapshot.x, 100.0);
        assert_eq!(snapshot.y, 200.0);
        assert!(snapshot.smooth);
        assert!(matches!(snapshot.point_type, PointTypeString::OnCurve));
    }

    #[test]
    fn contour_snapshot_from_contour() {
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(100.0, 0.0, PointType::OffCurve, false);
        contour.add_point(100.0, 100.0, PointType::OnCurve, true);
        contour.close();

        let snapshot = ContourSnapshot::from(&contour);

        assert_eq!(snapshot.points.len(), 3);
        assert!(snapshot.closed);
    }

    #[test]
    fn glyph_snapshot_from_edit_session() {
        let glyph = Glyph::new("A".to_string(), 65, 600.0);
        let mut session = EditSession::new(glyph);
        let contour_id = session.add_empty_contour();
        session
            .add_point(50.0, 50.0, PointType::OnCurve, false)
            .unwrap();

        let snapshot = GlyphSnapshot::from_edit_session(&session);

        assert_eq!(snapshot.unicode, 65);
        assert_eq!(snapshot.name, "A");
        assert_eq!(snapshot.x_advance, 600.0);
        assert_eq!(snapshot.contours.len(), 1);
        assert_eq!(snapshot.contours[0].points.len(), 1);
        assert_eq!(
            snapshot.active_contour_id,
            Some(contour_id.raw().to_string())
        );
    }

    #[test]
    fn command_result_success() {
        let glyph = Glyph::new("B".to_string(), 66, 500.0);
        let session = EditSession::new(glyph);

        let result = CommandResult::success_simple(&session);

        assert!(result.success);
        assert!(result.snapshot.is_some());
        assert!(result.error.is_none());
    }

    #[test]
    fn command_result_error() {
        let result = CommandResult::error("Something went wrong");

        assert!(!result.success);
        assert!(result.snapshot.is_none());
        assert_eq!(result.error, Some("Something went wrong".to_string()));
    }

    #[test]
    fn snapshot_serializes_to_json() {
        let glyph = Glyph::new("C".to_string(), 67, 550.0);
        let mut session = EditSession::new(glyph);
        session.add_empty_contour();
        session
            .add_point(10.0, 20.0, PointType::OnCurve, false)
            .unwrap();

        let snapshot = GlyphSnapshot::from_edit_session(&session);
        let json = serde_json::to_string(&snapshot).unwrap();

        // Verify it contains expected fields
        assert!(json.contains("\"unicode\":67"));
        assert!(json.contains("\"name\":\"C\""));
        assert!(json.contains("\"xAdvance\":550"));
        assert!(json.contains("\"contours\":"));
        assert!(json.contains("\"activeContourId\":"));
    }
}
