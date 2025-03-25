use serde::{Deserialize, Serialize};
use shift_font::entity::EntityId;
use ts_rs::TS;

#[derive(Serialize, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FontLoadedEvent {
    pub file_name: String,
}

#[derive(Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PointsAddedEvent {
    pub point_ids: Vec<EntityId>,
}

#[derive(Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MovedPoint {
    pub point_id: EntityId,
    pub dx: f32,
    pub dy: f32,
}

#[derive(Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PointsMovedEvent {
    pub points: Vec<MovedPoint>,
}
