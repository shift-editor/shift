use serde::Serialize;
use ts_rs::TS;

type Ident = usize;

#[derive(Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EntityId {
    parent_id: Ident,
    id: Ident,
}
