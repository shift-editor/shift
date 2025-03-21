use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Clone,Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FontLoadedEvent {
    pub file_name: String,
}
