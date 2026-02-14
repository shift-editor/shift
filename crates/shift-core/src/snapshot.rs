use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{edit_session::EditSession, Anchor, Contour, Point, PointId, PointType as IrPointType};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct PointSnapshot {
    #[ts(type = "PointId")]
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub enum PointType {
    OnCurve,
    OffCurve,
}

impl From<IrPointType> for PointType {
    fn from(pt: IrPointType) -> Self {
        match pt {
            IrPointType::OnCurve => PointType::OnCurve,
            IrPointType::OffCurve => PointType::OffCurve,
            IrPointType::QCurve => PointType::OnCurve,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct ContourSnapshot {
    #[ts(type = "ContourId")]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct AnchorSnapshot {
    #[ts(type = "AnchorId")]
    pub id: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

impl From<&Anchor> for AnchorSnapshot {
    fn from(anchor: &Anchor) -> Self {
        Self {
            id: anchor.id().raw().to_string(),
            name: anchor.name().map(|name| name.to_string()),
            x: anchor.x(),
            y: anchor.y(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct RenderPointSnapshot {
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

impl From<&Point> for RenderPointSnapshot {
    fn from(point: &Point) -> Self {
        Self {
            x: point.x(),
            y: point.y(),
            point_type: point.point_type().into(),
            smooth: point.is_smooth(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct RenderContourSnapshot {
    pub points: Vec<RenderPointSnapshot>,
    pub closed: bool,
}

impl From<&Contour> for RenderContourSnapshot {
    fn from(contour: &Contour) -> Self {
        Self {
            points: contour
                .points()
                .iter()
                .map(RenderPointSnapshot::from)
                .collect(),
            closed: contour.is_closed(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct GlyphSnapshot {
    pub unicode: u32,
    pub name: String,
    #[ts(rename = "xAdvance")]
    pub x_advance: f64,
    pub contours: Vec<ContourSnapshot>,
    pub anchors: Vec<AnchorSnapshot>,
    #[serde(default)]
    pub composite_contours: Vec<RenderContourSnapshot>,
    #[ts(rename = "activeContourId", type = "ContourId | null")]
    pub active_contour_id: Option<String>,
}

impl GlyphSnapshot {
    pub fn from_edit_session(session: &EditSession) -> Self {
        Self {
            unicode: session.unicode(),
            name: session.glyph_name().to_string(),
            x_advance: session.width(),
            contours: session.contours_iter().map(ContourSnapshot::from).collect(),
            anchors: session
                .layer()
                .anchors_iter()
                .map(AnchorSnapshot::from)
                .collect(),
            composite_contours: Vec::new(),
            active_contour_id: session.active_contour_id().map(|id| id.raw().to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct CommandResult {
    pub success: bool,
    pub snapshot: Option<GlyphSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(rename = "affectedPointIds", type = "Array<PointId> | null")]
    pub affected_point_ids: Option<Vec<String>>,
    #[ts(rename = "canUndo")]
    pub can_undo: bool,
    #[ts(rename = "canRedo")]
    pub can_redo: bool,
}

impl CommandResult {
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
            can_undo: false,
            can_redo: false,
        }
    }

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
    use crate::{Contour, GlyphLayer, PointType as IrPointType};

    #[test]
    fn point_snapshot_from_point() {
        let mut contour = Contour::new();
        let point_id = contour.add_point(100.0, 200.0, IrPointType::OnCurve, true);
        let point = contour.get_point(point_id).unwrap();

        let snapshot = PointSnapshot::from(point);

        assert_eq!(snapshot.x, 100.0);
        assert_eq!(snapshot.y, 200.0);
        assert!(snapshot.smooth);
        assert!(matches!(snapshot.point_type, PointType::OnCurve));
    }

    #[test]
    fn contour_snapshot_from_contour() {
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, IrPointType::OnCurve, false);
        contour.add_point(100.0, 0.0, IrPointType::OffCurve, false);
        contour.add_point(100.0, 100.0, IrPointType::OnCurve, true);
        contour.close();

        let snapshot = ContourSnapshot::from(&contour);

        assert_eq!(snapshot.points.len(), 3);
        assert!(snapshot.closed);
    }

    #[test]
    fn glyph_snapshot_from_edit_session() {
        let mut session = EditSession::new("A".to_string(), 65, GlyphLayer::with_width(600.0));
        let contour_id = session.add_empty_contour();
        session
            .add_point(50.0, 50.0, IrPointType::OnCurve, false)
            .unwrap();
        session
            .layer_mut()
            .add_anchor(crate::Anchor::new(Some("top".to_string()), 250.0, 700.0));

        let snapshot = GlyphSnapshot::from_edit_session(&session);

        assert_eq!(snapshot.unicode, 65);
        assert_eq!(snapshot.name, "A");
        assert_eq!(snapshot.x_advance, 600.0);
        assert_eq!(snapshot.contours.len(), 1);
        assert_eq!(snapshot.contours[0].points.len(), 1);
        assert_eq!(snapshot.anchors.len(), 1);
        assert_eq!(snapshot.anchors[0].name.as_deref(), Some("top"));
        assert!(snapshot.composite_contours.is_empty());
        assert_eq!(
            snapshot.active_contour_id,
            Some(contour_id.raw().to_string())
        );
    }

    #[test]
    fn command_result_success() {
        let session = EditSession::new("B".to_string(), 66, GlyphLayer::with_width(500.0));

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
        let mut session = EditSession::new("C".to_string(), 67, GlyphLayer::with_width(550.0));
        session.add_empty_contour();
        session
            .add_point(10.0, 20.0, IrPointType::OnCurve, false)
            .unwrap();

        let snapshot = GlyphSnapshot::from_edit_session(&session);
        let json = serde_json::to_string(&snapshot).unwrap();

        assert!(json.contains("\"unicode\":67"));
        assert!(json.contains("\"name\":\"C\""));
        assert!(json.contains("\"xAdvance\":550"));
        assert!(json.contains("\"contours\":"));
        assert!(json.contains("\"compositeContours\":"));
        assert!(json.contains("\"activeContourId\":"));
    }
}
