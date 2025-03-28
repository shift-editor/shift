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
pub struct FontCompiledEvent {
    pub file_name: String,
    pub font_path: String,
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
    pub from_x: f32,
    pub from_y: f32,
    pub to_x: f32,
    pub to_y: f32,
}

#[derive(Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PointsMovedEvent {
    pub points: Vec<MovedPoint>,
}
